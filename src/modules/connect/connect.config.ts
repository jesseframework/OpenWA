import { ApiKeyRole } from '../auth/entities/api-key.entity';

/**
 * Config for "Sign in with WorkHub" — the WorkHub platform's Connected-apps / app-connect flow, used
 * here as a web sign-in for the dashboard. Read straight from env and kept in this module (not the
 * shared configuration.ts) so the feature is self-contained and easy to switch off.
 *
 * The flow is OFF unless WORKHUB_SIGNIN_ENABLED=true AND both the WorkHub API base and this
 * deployment's own public base (BASE_URL) are set — the redirect_uri handed to WorkHub is
 * `${BASE_URL}/api/connect/callback`, which must be the exact https address registered for the
 * `openwa` client on WorkHub (platform migration 306), so a missing BASE_URL can never send a wrong one.
 */
export interface ConnectConfig {
  enabled: boolean;
  /** WorkHub platform API base, no trailing slash (the /v1/public/connect/* + /v1/connect/me host). */
  apiUrl: string;
  /** The client id registered on WorkHub (migration 306 seeds 'openwa'). */
  clientId: string;
  /** This OpenWA deployment's public base (BASE_URL), no trailing slash. */
  baseUrl: string;
  /** Role a minted key gets, confined to the resolved tenant (operator = manage that tenant's sessions). */
  signInRole: ApiKeyRole;
  /** Minted-key lifetime in minutes (a browser session, not a durable credential). */
  keyTtlMinutes: number;
}

const WEEK_MINUTES = 7 * 24 * 60;
const DEFAULT_TTL_MINUTES = 720; // 12h

function resolveRole(raw: string | undefined): ApiKeyRole {
  const v = (raw || '').trim().toLowerCase();
  // Default OPERATOR: an auto-provisioned web sign-in can manage its tenant's WhatsApp sessions, but
  // does not auto-hold admin (key/tenant management) unless a deployment opts in via WORKHUB_SIGNIN_ROLE.
  return (Object.values(ApiKeyRole) as string[]).includes(v) ? (v as ApiKeyRole) : ApiKeyRole.OPERATOR;
}

export function computeConnectConfig(env: NodeJS.ProcessEnv = process.env): ConnectConfig {
  const apiUrl = (env.WORKHUB_API_URL || '').trim().replace(/\/+$/, '');
  const baseUrl = (env.BASE_URL || '').trim().replace(/\/+$/, '');
  const ttl = parseInt(env.WORKHUB_SIGNIN_KEY_TTL_MINUTES || String(DEFAULT_TTL_MINUTES), 10);
  return {
    enabled: env.WORKHUB_SIGNIN_ENABLED === 'true' && apiUrl.length > 0 && baseUrl.length > 0,
    apiUrl,
    clientId: (env.WORKHUB_CONNECT_CLIENT_ID || 'openwa').trim(),
    baseUrl,
    signInRole: resolveRole(env.WORKHUB_SIGNIN_ROLE),
    keyTtlMinutes: Number.isFinite(ttl) && ttl >= 5 && ttl <= WEEK_MINUTES ? ttl : DEFAULT_TTL_MINUTES,
  };
}

/**
 * The exact return address registered on WorkHub for this client. OpenWA serves every controller
 * under the `/api` global prefix (setGlobalPrefix in app-validation.ts), so the callback is
 * /api/connect/callback — and allowedRedirect on WorkHub matches byte-for-byte, so this must agree
 * with migration 306's registered redirect_uris exactly.
 */
export function connectRedirectUri(c: ConnectConfig): string {
  return `${c.baseUrl}/api/connect/callback`;
}
