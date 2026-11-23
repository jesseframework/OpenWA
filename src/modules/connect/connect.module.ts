import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { ConnectService } from './connect.service';
import { ConnectController } from './connect.controller';

/**
 * "Sign in with WorkHub" for the dashboard. Imports AuthModule (to mint a tenant-scoped api key via
 * AuthService.createApiKey) and TenantModule (to resolve the WorkHub company to an OpenWA tenant via
 * TenantService.findOrCreateByExternalId). Off at runtime unless configured — see connect.config.ts.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [ConnectController],
  providers: [ConnectService],
})
export class ConnectModule {}
