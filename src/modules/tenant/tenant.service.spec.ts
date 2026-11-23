import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantService } from './tenant.service';
import { Tenant } from './entities/tenant.entity';
import { ApiKey } from '../auth/entities/api-key.entity';
import { Session } from '../session/entities/session.entity';

/** A driver error shaped like the unique-violation `isUniqueViolation` recognizes (sqlite). */
const uniqueViolation = () =>
  Object.assign(new Error('UNIQUE constraint failed: tenants.externalId'), {
    name: 'QueryFailedError',
    driverError: { code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'UNIQUE constraint failed: tenants.externalId' },
  });

describe('TenantService', () => {
  let service: TenantService;
  let tenantRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let apiKeyRepo: { count: jest.Mock };
  let sessionRepo: { count: jest.Mock };

  beforeEach(() => {
    tenantRepo = {
      create: jest.fn((partial: Partial<Tenant>) => ({ ...partial }) as Tenant),
      save: jest.fn((t: Tenant) =>
        Promise.resolve(Object.assign({ id: 't-1', createdAt: new Date(), updatedAt: new Date() }, t)),
      ),
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    apiKeyRepo = { count: jest.fn(() => Promise.resolve(0)) };
    sessionRepo = { count: jest.fn(() => Promise.resolve(0)) };
    service = new TenantService(
      tenantRepo as unknown as Repository<Tenant>,
      apiKeyRepo as unknown as Repository<ApiKey>,
      sessionRepo as unknown as Repository<Session>,
    );
  });

  describe('create', () => {
    it('creates an active tenant, trimming the name', async () => {
      await service.create({ name: '  Acme Corp  ', externalId: 'wh_ws_1' });
      expect(tenantRepo.create).toHaveBeenCalledWith({ name: 'Acme Corp', externalId: 'wh_ws_1', isActive: true });
    });

    it('normalizes a blank externalId to null (unmapped)', async () => {
      await service.create({ name: 'Acme', externalId: '   ' });
      expect(tenantRepo.create).toHaveBeenCalledWith({ name: 'Acme', externalId: null, isActive: true });
    });

    it('normalizes an omitted externalId to null', async () => {
      await service.create({ name: 'Acme' });
      expect(tenantRepo.create).toHaveBeenCalledWith({ name: 'Acme', externalId: null, isActive: true });
    });

    it('maps a duplicate externalId to 409 Conflict', async () => {
      tenantRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.create({ name: 'Acme', externalId: 'dup' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a non-unique DB error unchanged', async () => {
      const boom = new Error('disk full');
      tenantRepo.save.mockRejectedValueOnce(boom);
      await expect(service.create({ name: 'Acme' })).rejects.toBe(boom);
    });
  });

  describe('findOne', () => {
    it('throws 404 when the tenant does not exist', async () => {
      tenantRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('clears externalId when passed null', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({
        id: 't-1',
        name: 'Acme',
        externalId: 'wh_1',
        isActive: true,
      });
      await service.update('t-1', { externalId: null });
      expect(tenantRepo.save).toHaveBeenCalledWith(expect.objectContaining({ externalId: null }));
    });

    it('trims a renamed tenant and leaves unspecified fields untouched', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({
        id: 't-1',
        name: 'Old',
        externalId: 'wh_1',
        isActive: true,
      });
      await service.update('t-1', { name: '  New  ' });
      expect(tenantRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', externalId: 'wh_1' }));
    });

    it('maps a duplicate externalId to 409 Conflict', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({ id: 't-1', name: 'Acme', externalId: null, isActive: true });
      tenantRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.update('t-1', { externalId: 'dup' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove (fail-safe reference guard)', () => {
    beforeEach(() => {
      tenantRepo.findOne.mockResolvedValue({ id: 't-1', name: 'Acme', externalId: null, isActive: true });
    });

    it('deletes a tenant with no keys and no sessions', async () => {
      await service.remove('t-1');
      expect(tenantRepo.delete).toHaveBeenCalledWith({ id: 't-1' });
    });

    it('refuses (409) while API keys still reference the tenant', async () => {
      apiKeyRepo.count.mockResolvedValueOnce(2);
      await expect(service.remove('t-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tenantRepo.delete).not.toHaveBeenCalled();
    });

    it('refuses (409) while sessions still reference the tenant', async () => {
      sessionRepo.count.mockResolvedValueOnce(1);
      await expect(service.remove('t-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tenantRepo.delete).not.toHaveBeenCalled();
    });

    it('throws 404 for a tenant that does not exist (before any reference check)', async () => {
      tenantRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(apiKeyRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('findOrCreateByExternalId', () => {
    it('returns the existing tenant when the external id already maps to one (no create)', async () => {
      const existing = { id: 't-existing', externalId: 'wh-co-1', name: 'Acme' } as Tenant;
      tenantRepo.findOne.mockResolvedValueOnce(existing);
      await expect(service.findOrCreateByExternalId('wh-co-1', 'Acme Renamed')).resolves.toBe(existing);
      expect(tenantRepo.create).not.toHaveBeenCalled(); // existing tenant: never renamed on sign-in
    });

    it('creates an active tenant on first sight, keyed on the external id', async () => {
      tenantRepo.findOne.mockResolvedValueOnce(null);
      await service.findOrCreateByExternalId('wh-co-2', '  Globex  ');
      expect(tenantRepo.create).toHaveBeenCalledWith({ name: 'Globex', externalId: 'wh-co-2', isActive: true });
    });

    it('falls back to the external id as the name when none is given', async () => {
      tenantRepo.findOne.mockResolvedValueOnce(null);
      await service.findOrCreateByExternalId('wh-co-3', '   ');
      expect(tenantRepo.create).toHaveBeenCalledWith({ name: 'wh-co-3', externalId: 'wh-co-3', isActive: true });
    });

    it('resolves the first-login race to the winner: a unique violation re-reads and returns it', async () => {
      const winner = { id: 't-winner', externalId: 'wh-co-4', name: 'Race' } as Tenant;
      tenantRepo.findOne
        .mockResolvedValueOnce(null) // first look: not there yet
        .mockResolvedValueOnce(winner); // re-read after the losing insert
      tenantRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.findOrCreateByExternalId('wh-co-4', 'Race')).resolves.toBe(winner);
    });

    it('refuses a blank external id', async () => {
      await expect(service.findOrCreateByExternalId('   ', 'x')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
