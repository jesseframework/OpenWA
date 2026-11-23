import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { ApiKey } from '../auth/entities/api-key.entity';
import { Session } from '../session/entities/session.entity';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { isUniqueViolation } from '../../common/utils/db-errors';

/**
 * CRUD for tenants — the groups a tenant-scoped API key is confined to (see TenantScopeService). All
 * routes are global-admin only (TenantController is @RequireUnscopedKey), since a tenant-scoped key
 * resolves to a non-empty allowedSessions and is fenced out of these management routes.
 *
 * The Tenant repository is on the **main** connection (alongside api_keys); the ApiKey (main) and
 * Session (data) repositories are injected only for the delete reference-guard below.
 */
@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant, 'main')
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(ApiKey, 'main')
    private readonly apiKeyRepository: Repository<ApiKey>,
    @InjectRepository(Session, 'data')
    private readonly sessionRepository: Repository<Session>,
  ) {}

  /** '' / whitespace → NULL, so a blank externalId is "unmapped", matching the partial unique index. */
  private static normalizeExternalId(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const tenant = this.tenantRepository.create({
      name: dto.name.trim(),
      externalId: TenantService.normalizeExternalId(dto.externalId),
      isActive: true,
    });
    try {
      return await this.tenantRepository.save(tenant);
    } catch (err) {
      // The partial unique index on externalId is the authoritative guard against two tenants
      // mapping to the same external identity (a check-then-insert would race).
      if (isUniqueViolation(err)) {
        throw new ConflictException(`A tenant with externalId '${tenant.externalId}' already exists`);
      }
      throw err;
    }
  }

  /**
   * Resolve the tenant an external identity maps to, creating it on first sight. "Sign in with
   * WorkHub" calls this with the WorkHub company id as externalId, so the same company always lands
   * on the same OpenWA tenant. The partial-unique index on externalId is the authority: on the
   * first-login race (two sign-ins for a brand-new company at once) the losing INSERT throws a unique
   * violation, and we re-read and return the winner — so the caller always gets exactly one stable
   * tenant, never a duplicate. An existing tenant's name is left as-is (renames happen through the
   * admin CRUD, not silently on every login).
   */
  async findOrCreateByExternalId(externalId: string, name: string): Promise<Tenant> {
    const normalized = TenantService.normalizeExternalId(externalId);
    if (!normalized) throw new ConflictException('externalId is required to resolve a tenant');
    const existing = await this.tenantRepository.findOne({ where: { externalId: normalized } });
    if (existing) return existing;
    const tenant = this.tenantRepository.create({
      name: name.trim() || normalized,
      externalId: normalized,
      isActive: true,
    });
    try {
      return await this.tenantRepository.save(tenant);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const won = await this.tenantRepository.findOne({ where: { externalId: normalized } });
        if (won) return won;
      }
      throw err;
    }
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant with id '${id}' not found`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findOne(id);
    if (dto.name !== undefined) tenant.name = dto.name.trim();
    if (dto.externalId !== undefined) tenant.externalId = TenantService.normalizeExternalId(dto.externalId);
    if (dto.isActive !== undefined) tenant.isActive = dto.isActive;
    try {
      return await this.tenantRepository.save(tenant);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`A tenant with externalId '${tenant.externalId}' already exists`);
      }
      throw err;
    }
  }

  /**
   * Delete a tenant, but refuse (409) while any API key or session still references it: hard-deleting
   * a referenced tenant would strand its keys (each then resolves to the nil-UUID sentinel — confined
   * to nothing) and leave its sessions reachable only by a global key. The admin must retarget or
   * remove those first, or deactivate the tenant instead (PUT isActive:false). Fail-safe, in the same
   * spirit as the last-admin guard.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id); // 404 if it does not exist
    const [keyCount, sessionCount] = await Promise.all([
      this.apiKeyRepository.count({ where: { tenantId: id } }),
      this.sessionRepository.count({ where: { tenantId: id } }),
    ]);
    if (keyCount > 0 || sessionCount > 0) {
      throw new ConflictException(
        `Cannot delete tenant '${id}': it still has ${keyCount} API key(s) and ${sessionCount} session(s). ` +
          'Retarget or remove them first, or deactivate the tenant instead (PUT isActive:false).',
      );
    }
    await this.tenantRepository.delete({ id });
  }
}
