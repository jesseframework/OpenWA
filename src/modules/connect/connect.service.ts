import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '../../common/services/logger.service';
import { AuthService } from '../auth/auth.service';
import { TenantService } from '../tenant/tenant.service';
import { computeConnectConfig, connectRedirectUri, type ConnectConfig } from './connect.config';

/** A started-but-not-returned flow: the PKCE verifier waiting for its code. Keyed by `state`. */
interface PendingFlow {
  codeVerifier: string;
  createdAt: number;
}
/** A minted key waiting to be redeemed by the SPA. Keyed by a one-time handoff id. */
interface Handoff {
  rawKey: string;
  createdAt: number;
}

/** Long enough to read a consent page and switch company; short enough that a leaked state is stale. */
const STATE_TTL_MS = 10 * 60_000;
/** The SPA redeems the handoff on the very next page load, so this is deliberately tight. */
const HANDOFF_TTL_MS = 60_000;

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * "Sign in with WorkHub" for the dashboard. The browser round-trips to WorkHub's consent page and
 * returns with a one-time code; this service exchanges it (PKCE), reads who the person is and which
 * WorkHub company via /v1/connect/me, maps that company to an OpenWA tenant (find-or-create by the
 * company id as externalId), and mints a SHORT-LIVED, tenant-scoped api key. The raw key is never put
 * in a URL: it is stashed under a one-time handoff id that the SPA redeems over POST (connect.claim).
 *
 * replicaCount=1 is mandated for OpenWA, so the in-process state/handoff maps are safe — nothing here
 * needs to be shared across replicas, and both entries are single-use and short-lived.
 */
@Injectable()
export class ConnectService {
  private readonly logger = createLogger('ConnectService');
  readonly config: ConnectConfig = computeConnectConfig();
  private readonly flows = new Map<string, PendingFlow>();
  private readonly handoffs = new Map<string, Handoff>();

  constructor(
    private readonly auth: AuthService,
    private readonly tenants: TenantService,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Begin a flow: a fresh PKCE pair + state, and the WorkHub authorize URL to send the browser to. */
  startFlow(): { authorizeUrl: string; state: string } {
    this.sweep();
    const codeVerifier = b64url(randomBytes(48)); // 64 url-safe chars — within RFC 7636's 43–128
    const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
    const state = b64url(randomBytes(24));
    this.flows.set(state, { codeVerifier, createdAt: Date.now() });
    const u = new URL(`${this.config.apiUrl}/v1/public/connect/authorize`);
    u.searchParams.set('client_id', this.config.clientId);
    u.searchParams.set('redirect_uri', connectRedirectUri(this.config));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('state', state);
    u.searchParams.set('device_name', 'OpenWA dashboard');
    return { authorizeUrl: u.toString(), state };
  }

  /**
   * Handle the return from WorkHub: consume the state (single-use), exchange the code for a whc_ token,
   * read the person's company via /v1/connect/me, resolve it to a tenant, mint a tenant-scoped key, and
   * return a one-time handoff id the SPA can redeem for that key. Throws BadRequest on any misstep.
   */
  async handleCallback(code: string, state: string): Promise<string> {
    const flow = state ? this.flows.get(state) : undefined;
    if (flow) this.flows.delete(state); // single-use, even on failure below
    if (!flow || Date.now() - flow.createdAt > STATE_TTL_MS) throw new BadRequestException('connect_state_invalid');
    if (!code) throw new BadRequestException('connect_code_missing');

    const accessToken = await this.exchangeCode(code, flow.codeVerifier);
    const me = await this.fetchMe(accessToken);
    const tenant = await this.tenants.findOrCreateByExternalId(me.tenantId, me.tenantName);
    const { rawKey } = await this.auth.createApiKey({
      name: `WorkHub · ${me.userEmail}`.slice(0, 100),
      role: this.config.signInRole,
      tenantId: tenant.id,
      expiresAt: new Date(Date.now() + this.config.keyTtlMinutes * 60_000).toISOString(),
    });
    const handoffId = b64url(randomBytes(24));
    this.handoffs.set(handoffId, { rawKey, createdAt: Date.now() });
    this.logger.log(`WorkHub sign-in minted a ${this.config.signInRole} key for tenant ${tenant.id}`);
    return handoffId;
  }

  /** Redeem a one-time handoff for the minted key. Returns null for an unknown/expired/used id. */
  claim(handoffId: string): string | null {
    this.sweep();
    const h = handoffId ? this.handoffs.get(handoffId) : undefined;
    if (!h) return null;
    this.handoffs.delete(handoffId); // single-use
    if (Date.now() - h.createdAt > HANDOFF_TTL_MS) return null;
    return h.rawKey;
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: connectRedirectUri(this.config),
      client_id: this.config.clientId,
    });
    const res = await fetch(`${this.config.apiUrl}/v1/public/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) {
      this.logger.warn(`WorkHub token exchange failed: ${res.status}`);
      throw new BadRequestException('connect_token_exchange_failed');
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new BadRequestException('connect_token_missing');
    return json.access_token;
  }

  private async fetchMe(accessToken: string): Promise<{ tenantId: string; tenantName: string; userEmail: string }> {
    const res = await fetch(`${this.config.apiUrl}/v1/connect/me`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!res.ok) {
      this.logger.warn(`WorkHub /connect/me failed: ${res.status}`);
      throw new BadRequestException('connect_me_failed');
    }
    const j = (await res.json()) as { tenantId?: string; tenantName?: string; user?: { email?: string } };
    if (!j.tenantId) throw new BadRequestException('connect_me_incomplete');
    return { tenantId: j.tenantId, tenantName: j.tenantName ?? j.tenantId, userEmail: j.user?.email ?? 'unknown' };
  }

  /** Drop expired flows/handoffs so the maps cannot grow without bound between restarts. */
  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.flows) if (now - v.createdAt > STATE_TTL_MS) this.flows.delete(k);
    for (const [k, v] of this.handoffs) if (now - v.createdAt > HANDOFF_TTL_MS) this.handoffs.delete(k);
  }
}
