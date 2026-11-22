import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { ActiveKeyIndex } from './active-key-index';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { TenantScopeService, TENANT_NO_SESSION_SENTINEL } from '../tenant/tenant-scope.service';
import { Session } from '../session/entities/session.entity';

/**
 * End-to-end tenant isolation through the REAL validateApiKey + the REAL TenantScopeService: a key
 * carrying a tenantId is confined to its tenant's sessions at authentication time, so the per-session
 * fence (and, through the overwritten allowedSessions, every downstream scope check) refuses a session
 * the tenant does not own. A global (no-tenant) key is unaffected. Only the two repositories are
 * mocked; the resolution + fence logic under test is the production code.
 */
describe('AuthService tenant confinement (validateApiKey)', () => {
  let service: AuthService;
  let sessions: Array<Pick<Session, 'id' | 'tenantId'>>;
  let apiKeys: ApiKey[];

  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

  function mkKey(rawKey: string, overrides: Partial<ApiKey> = {}): ApiKey {
    return {
      id: `id-${rawKey}`,
      name: rawKey,
      keyHash: sha256(rawKey),
      keyPrefix: rawKey.slice(0, 12),
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
    // No pepper → hashApiKey == sha256, matching mkKey's stored keyHash.
    delete process.env.API_KEY_PEPPER;
    sessions = [];
    apiKeys = [];

    const apiKeyRepo = {
      findOne: jest.fn((opts: { where: { keyHash: string } }) =>
        Promise.resolve(apiKeys.find(k => k.keyHash === opts.where.keyHash) ?? null),
      ),
    };
    const sessionRepo = {
      find: jest.fn((opts: { where: { tenantId: string } }) =>
        Promise.resolve(
          sessions.filter(s => s.tenantId === opts.where.tenantId).map(s => ({ id: s.id }) as Session),
        ),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        TenantScopeService,
        { provide: getRepositoryToken(ApiKey, 'main'), useValue: apiKeyRepo },
        { provide: getRepositoryToken(Session, 'data'), useValue: sessionRepo },
        { provide: ApiKeyUsageTracker, useValue: { record: jest.fn(), forget: jest.fn() } },
        { provide: ActiveKeyIndex, useValue: { refreshSoon: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('lets a tenant key act on a session its tenant owns', async () => {
    apiKeys = [mkKey('tenant-a-key', { tenantId: 'tenant-A' })];
    sessions = [{ id: 's-own', tenantId: 'tenant-A' }];

    const result = await service.validateApiKey('tenant-a-key', '1.1.1.1', 's-own');
    expect(result.id).toBe('id-tenant-a-key');
    // allowedSessions was overwritten with the tenant's resolved set, so downstream list/stats
    // enforcement confines the key too — not just this per-session fence.
    expect(result.allowedSessions).toEqual(['s-own']);
  });

  it("refuses a tenant key on another tenant's session (fail-closed)", async () => {
    apiKeys = [mkKey('tenant-a-key', { tenantId: 'tenant-A' })];
    sessions = [
      { id: 's-own', tenantId: 'tenant-A' },
      { id: 's-foreign', tenantId: 'tenant-B' },
    ];

    await expect(service.validateApiKey('tenant-a-key', '1.1.1.1', 's-foreign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a tenant key whose tenant owns no session, on any session (sentinel confines to nothing)', async () => {
    apiKeys = [mkKey('empty-tenant-key', { tenantId: 'tenant-EMPTY' })];
    sessions = [{ id: 's-foreign', tenantId: 'tenant-B' }];

    await expect(service.validateApiKey('empty-tenant-key', '1.1.1.1', 's-foreign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // And with no session named, the resolved scope is the sentinel — so a list route sees nothing.
    const result = await service.validateApiKey('empty-tenant-key', '1.1.1.1');
    expect(result.allowedSessions).toEqual([TENANT_NO_SESSION_SENTINEL]);
  });

  it('leaves a global (no-tenant) key unconfined — any session, allowedSessions stays null', async () => {
    apiKeys = [mkKey('global-key', { tenantId: null })];
    sessions = [
      { id: 's-x', tenantId: 'tenant-A' },
      { id: 's-y', tenantId: 'tenant-B' },
    ];

    const onX = await service.validateApiKey('global-key', '1.1.1.1', 's-x');
    expect(onX.allowedSessions).toBeNull();
    // A different tenant's session is equally reachable by a global key.
    await expect(service.validateApiKey('global-key', '1.1.1.1', 's-y')).resolves.toMatchObject({
      id: 'id-global-key',
    });
  });

  it('narrows a tenant key further by its own allowedSessions, never past the tenant', async () => {
    apiKeys = [mkKey('scoped-tenant-key', { tenantId: 'tenant-A', allowedSessions: ['s-own-1'] })];
    sessions = [
      { id: 's-own-1', tenantId: 'tenant-A' },
      { id: 's-own-2', tenantId: 'tenant-A' },
    ];

    // s-own-2 is in the tenant but outside the key's own scope → refused.
    await expect(service.validateApiKey('scoped-tenant-key', '1.1.1.1', 's-own-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // s-own-1 is in both → allowed.
    await expect(service.validateApiKey('scoped-tenant-key', '1.1.1.1', 's-own-1')).resolves.toMatchObject({
      allowedSessions: ['s-own-1'],
    });
  });
});
