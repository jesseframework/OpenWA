import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../session/entities/session.entity';
import { Tenant } from './entities/tenant.entity';
import { ApiKey } from '../auth/entities/api-key.entity';
import { TenantScopeService } from './tenant-scope.service';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';

/**
 * Tenant isolation + management.
 *
 * - `TenantScopeService` resolves a tenant key's effective session allowlist from the data
 *   connection's `sessions` (no SessionModule import, so no dependency cycle with AuthModule, which
 *   imports this for the resolver).
 * - `TenantService` + `TenantController` are global-admin CRUD for the `tenants` table on the main
 *   connection. The ApiKey (main) and Session (data) repos are registered only for the delete
 *   reference-guard. The controller is @RequireUnscopedKey, enforced by the global ApiKeyGuard; it
 *   uses the global AuditService, so no AuthModule import is needed here and no cycle is created.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ApiKey], 'main'), TypeOrmModule.forFeature([Session], 'data')],
  controllers: [TenantController],
  providers: [TenantScopeService, TenantService],
  exports: [TenantScopeService, TenantService],
})
export class TenantModule {}
