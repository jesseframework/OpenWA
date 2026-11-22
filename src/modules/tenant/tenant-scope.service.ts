import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { ApiKey } from '../auth/entities/api-key.entity';

/**
 * Placeholder session id used as a tenant key's allowlist when its tenant owns NO session it may act
 * on. It is the nil UUID — a value the session id generator (`@PrimaryGeneratedColumn('uuid')`, random
 * v4) never produces — so the existing `allowedSessions.includes(id)` / `IN (...)` scope checks match
 * nothing. The tenant key is confined to nothing (fail-closed) instead of widened to everything, which
 * is what an EMPTY allowlist means to the fail-open allowedSessions machinery.
 */
export const TENANT_NO_SESSION_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Resolves tenant membership into the session-id allowlist OpenWA's scope machinery already enforces,
 * so tenant isolation reuses the battle-tested `allowedSessions` enforcement (the guard session fence,
 * `SessionService.findAll`/`getStats`, `resolveSessionScope`) with no new per-route checks to miss.
 */
@Injectable()
export class TenantScopeService {
  constructor(
    @InjectRepository(Session, 'data')
    private readonly sessionRepository: Repository<Session>,
  ) {}

  /**
   * The effective `allowedSessions` a key may act on for THIS request.
   *
   * - Global key (tenantId null/undefined): its own `allowedSessions`, unchanged — fail-OPEN, exactly
   *   as before tenancy existed.
   * - Tenant key: the ids of its tenant's sessions, intersected with its own `allowedSessions` when it
   *   also carries one (narrowing WITHIN the tenant). FAIL-CLOSED — an empty result resolves to the
   *   nil-UUID sentinel, confining the key to nothing rather than widening it to everything.
   *
   * Callers overwrite `apiKey.allowedSessions` with this before the scope checks run; the key object
   * is a fresh per-request DB load (see AuthService.validateApiKey), so the mutation never leaks
   * across requests and the stored row is untouched.
   */
  async effectiveAllowedSessions(apiKey: ApiKey): Promise<string[] | null> {
    if (!apiKey.tenantId) {
      return apiKey.allowedSessions ?? null;
    }

    const rows = await this.sessionRepository.find({
      where: { tenantId: apiKey.tenantId },
      select: { id: true },
    });
    let ids = rows.map(row => row.id);

    const own = apiKey.allowedSessions;
    if (own && own.length > 0) {
      const permitted = new Set(own);
      ids = ids.filter(id => permitted.has(id));
    }

    return ids.length > 0 ? ids : [TENANT_NO_SESSION_SENTINEL];
  }
}
