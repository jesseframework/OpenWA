import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../session/entities/session.entity';
import { TenantScopeService } from './tenant-scope.service';

/**
 * Tenant isolation. `TenantScopeService` resolves a tenant key's effective session allowlist from the
 * data connection's `sessions`, so it registers only that repository (no SessionModule import, so no
 * dependency cycle with AuthModule, which imports this). Tenant management (the Tenant repository on
 * the main connection + the CRUD controller) is added alongside the tenant endpoints.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Session], 'data')],
  providers: [TenantScopeService],
  exports: [TenantScopeService],
})
export class TenantModule {}
