import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TenantScopeService, TENANT_NO_SESSION_SENTINEL } from './tenant-scope.service';
import { Session } from '../session/entities/session.entity';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';

/**
 * The core of tenant isolation: TenantScopeService.effectiveAllowedSessions turns a key's tenant
 * membership into the `allowedSessions` list the rest of OpenWA already enforces. These tests pin the
 * two properties that make the isolation safe — a tenant key is confined to its tenant's sessions, and
 * a tenant that owns no (reachable) session confines the key to NOTHING (the nil-UUID sentinel), never
 * widens it to everything the way an empty allowlist would.
 */
describe('TenantScopeService.effectiveAllowedSessions', () => {
  let service: TenantScopeService;
  /** In-memory `sessions` table. The repo mock answers find({where:{tenantId}}) from it. */
  let sessions: Array<Pick<Session, 'id' | 'tenantId'>>;

  function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
    return {
      id: 'key-1',
      name: 'k',
      keyHash: 'h',
      keyPrefix: 'p',
      role: ApiKeyRole.OPERATOR,
      allowedIps: null,
      allowedSessions: null,
      allowedChats: null,
      tenantId: null,
      isActive: true,
      expiresAt: null,
      lastUsedAt: null,
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    sessions = [];
    const sessionRepo = {
      find: jest.fn((opts: { where: { tenantId: string } }) =>
        Promise.resolve(
          sessions.filter(s => s.tenantId === opts.where.tenantId).map(s => ({ id: s.id }) as Session),
        ),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantScopeService, { provide: getRepositoryToken(Session, 'data'), useValue: sessionRepo }],
    }).compile();
    service = module.get(TenantScopeService);
  });

  // ── global (no-tenant) keys: untouched, fail-OPEN exactly as before tenancy ──

  it('returns null for a global key with no session scope (sees every session)', async () => {
    await expect(service.effectiveAllowedSessions(apiKey({ tenantId: null }))).resolves.toBeNull();
  });

  it("returns a global key's own allowedSessions unchanged", async () => {
    const own = ['s-a', 's-b'];
    await expect(service.effectiveAllowedSessions(apiKey({ tenantId: null, allowedSessions: own }))).resolves.toEqual(
      own,
    );
  });

  it('treats an empty-string tenantId as global (no confinement)', async () => {
    // '' is what the create/update stamp collapses a blank tenant to; the resolver reads truthiness.
    await expect(service.effectiveAllowedSessions(apiKey({ tenantId: '' }))).resolves.toBeNull();
  });

  // ── tenant keys: confined to their tenant's sessions ──

  it("confines a tenant key to exactly its tenant's session ids", async () => {
    sessions = [
      { id: 's-own-1', tenantId: 'tenant-A' },
      { id: 's-own-2', tenantId: 'tenant-A' },
      { id: 's-foreign', tenantId: 'tenant-B' },
    ];
    const result = await service.effectiveAllowedSessions(apiKey({ tenantId: 'tenant-A' }));
    expect(result).toEqual(expect.arrayContaining(['s-own-1', 's-own-2']));
    expect(result).toHaveLength(2);
    expect(result).not.toContain('s-foreign');
  });

  it("intersects a tenant key's own allowedSessions with the tenant (narrow WITHIN the tenant)", async () => {
    sessions = [
      { id: 's-own-1', tenantId: 'tenant-A' },
      { id: 's-own-2', tenantId: 'tenant-A' },
    ];
    // The key is additionally restricted to s-own-1, so s-own-2 — though in the tenant — is excluded.
    const result = await service.effectiveAllowedSessions(
      apiKey({ tenantId: 'tenant-A', allowedSessions: ['s-own-1'] }),
    );
    expect(result).toEqual(['s-own-1']);
  });

  // ── fail-closed: no reachable session → the nil-UUID sentinel, never [] (which means "all") ──

  it('confines a tenant that owns no session to the sentinel (nothing), not everything', async () => {
    sessions = [{ id: 's-foreign', tenantId: 'tenant-B' }];
    await expect(service.effectiveAllowedSessions(apiKey({ tenantId: 'tenant-A' }))).resolves.toEqual([
      TENANT_NO_SESSION_SENTINEL,
    ]);
  });

  it('confines a tenant key whose own scope is disjoint from its tenant to the sentinel', async () => {
    sessions = [{ id: 's-own-1', tenantId: 'tenant-A' }];
    // Own scope names only a session that is NOT in the tenant: the intersection is empty → sentinel.
    await expect(
      service.effectiveAllowedSessions(apiKey({ tenantId: 'tenant-A', allowedSessions: ['s-elsewhere'] })),
    ).resolves.toEqual([TENANT_NO_SESSION_SENTINEL]);
  });

  it('never resolves a tenant key to an empty array (the fail-open "all sessions" shape)', async () => {
    sessions = [];
    const result = await service.effectiveAllowedSessions(apiKey({ tenantId: 'tenant-A' }));
    expect(result).not.toEqual([]);
    expect(result && result.length).toBeGreaterThan(0);
  });
});
