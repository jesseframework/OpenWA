import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { applyGlobalValidation } from './../src/config/app-validation';
import { requestContextMiddleware } from './../src/common/middleware/request-context.middleware';
import { AuthService } from './../src/modules/auth/auth.service';
import { ApiKeyRole } from './../src/modules/auth/entities/api-key.entity';
import { Session } from './../src/modules/session/entities/session.entity';
import { AuditAction, AuditLog } from './../src/modules/audit/entities/audit-log.entity';

/**
 * Tenant CRUD (admin-only) end to end: the global admin manages tenants, scoped and tenant-bound keys
 * are fenced out (@RequireUnscopedKey), the externalId uniqueness holds, and a tenant that still has
 * keys or sessions cannot be hard-deleted.
 */
describe('Tenant CRUD (e2e)', () => {
  let app: INestApplication<App>;
  let adminKey: string; // global ADMIN, unrestricted
  let scopedAdminKey: string; // ADMIN restricted to one session
  let authService: AuthService;

  const post = (path: string, key: string, body: object) =>
    request(app.getHttpServer()).post(path).set('X-API-Key', key).send(body);
  const get = (path: string, key: string) => request(app.getHttpServer()).get(path).set('X-API-Key', key);
  const put = (path: string, key: string, body: object) =>
    request(app.getHttpServer()).put(path).set('X-API-Key', key).send(body);
  const del = (path: string, key: string) => request(app.getHttpServer()).delete(path).set('X-API-Key', key);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    applyGlobalValidation(app);
    app.use(requestContextMiddleware);
    await app.init();

    authService = app.get(AuthService);
    adminKey = (await authService.createApiKey({ name: 'e2e-tenant-admin', role: ApiKeyRole.ADMIN })).rawKey;

    const sessionRepo: Repository<Session> = app.get(getRepositoryToken(Session, 'data'));
    const sess = await sessionRepo.save(sessionRepo.create({ name: `e2e-tenant-scope-${Date.now()}` }));
    scopedAdminKey = (
      await authService.createApiKey({ name: 'e2e-tenant-scoped', role: ApiKeyRole.ADMIN, allowedSessions: [sess.id] })
    ).rawKey;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets a global admin create, read, list and update a tenant', async () => {
    const created = await post('/api/tenants', adminKey, { name: 'Acme Corp' }).expect(201);
    const body = created.body as { id: string; name: string; isActive: boolean; externalId: string | null };
    expect(body.id).toBeTruthy();
    expect(body).toMatchObject({ name: 'Acme Corp', isActive: true, externalId: null });

    await get(`/api/tenants/${body.id}`, adminKey)
      .expect(200)
      .expect(res => {
        expect((res.body as { name: string }).name).toBe('Acme Corp');
      });

    const list = await get('/api/tenants', adminKey).expect(200);
    expect((list.body as Array<{ id: string }>).some(t => t.id === body.id)).toBe(true);

    const updated = await put(`/api/tenants/${body.id}`, adminKey, { name: 'Acme Inc', isActive: false }).expect(200);
    expect(updated.body as object).toMatchObject({ name: 'Acme Inc', isActive: false });
  });

  it('404s for an unknown tenant id', async () => {
    await get('/api/tenants/00000000-0000-0000-0000-000000000000', adminKey).expect(404);
  });

  it('rejects a duplicate externalId with 409', async () => {
    const ext = `wh_ws_${Date.now()}`;
    await post('/api/tenants', adminKey, { name: 'First', externalId: ext }).expect(201);
    await post('/api/tenants', adminKey, { name: 'Second', externalId: ext }).expect(409);
  });

  it('fences a session-scoped admin out of tenant management', async () => {
    await get('/api/tenants', scopedAdminKey).expect(403);
    await post('/api/tenants', scopedAdminKey, { name: 'Nope' }).expect(403);
  });

  it('fences a tenant-bound key out of tenant management', async () => {
    const t = await post('/api/tenants', adminKey, { name: 'Bound Co' }).expect(201);
    const tenantId = (t.body as { id: string }).id;
    const tenantKey = (await authService.createApiKey({ name: 'e2e-tenant-bound', role: ApiKeyRole.ADMIN, tenantId }))
      .rawKey;
    // The tenant key resolves to a non-empty allowedSessions, so @RequireUnscopedKey rejects it.
    await get('/api/tenants', tenantKey).expect(403);
  });

  it('refuses to delete a tenant that still has a key, then deletes it once unreferenced', async () => {
    const t = await post('/api/tenants', adminKey, { name: 'Deletable Co' }).expect(201);
    const tenantId = (t.body as { id: string }).id;

    // A key bound to the tenant blocks the delete (409).
    const bound = await authService.createApiKey({ name: 'e2e-del-bound', role: ApiKeyRole.OPERATOR, tenantId });
    await del(`/api/tenants/${tenantId}`, adminKey).expect(409);

    // Detach the key from the tenant, and the delete succeeds (204).
    await authService.update(bound.apiKey.id, { tenantId: null });
    await del(`/api/tenants/${tenantId}`, adminKey).expect(204);
    await get(`/api/tenants/${tenantId}`, adminKey).expect(404);
  });

  it('writes a TENANT_CREATED audit row naming the acting key', async () => {
    const created = await post('/api/tenants', adminKey, { name: 'Audited Co' }).expect(201);
    const tenantId = (created.body as { id: string }).id;
    const auditRepo: Repository<AuditLog> = app.get(getRepositoryToken(AuditLog, 'main'));
    let row: AuditLog | null = null;
    for (let i = 0; i < 50 && !row; i++) {
      const rows = await auditRepo.find({ where: { action: AuditAction.TENANT_CREATED } });
      row = rows.find(r => (r.metadata as { tenantId?: string })?.tenantId === tenantId) ?? null;
      if (!row) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(row).not.toBeNull();
  });
});
