import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ApiKey } from './entities/api-key.entity';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { ChatScopeService } from './chat-scope.service';
import { ActiveKeyIndex } from './active-key-index';
import { AuthController } from './auth.controller';
import { AuthValidateController } from './auth-validate.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ProxyAwareThrottlerGuard } from '../../common/security/proxy-aware-throttler.guard';
import { TenantModule } from '../tenant/tenant.module';

@Global()
@Module({
  // TenantModule provides TenantScopeService, which validateApiKey uses to confine a tenant key to
  // its tenant's sessions. TenantModule depends only on the data Session repo (no auth import), so
  // importing it here introduces no dependency cycle.
  imports: [TypeOrmModule.forFeature([ApiKey], 'main'), TenantModule],
  controllers: [AuthController, AuthValidateController],
  providers: [
    AuthService,
    ApiKeyUsageTracker,
    ChatScopeService,
    ActiveKeyIndex,
    {
      provide: APP_GUARD,
      useClass: ProxyAwareThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [AuthService, ChatScopeService, ActiveKeyIndex],
})
export class AuthModule {}
