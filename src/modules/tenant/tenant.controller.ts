import { Controller, Get, Post, Put, Delete, Body, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantService } from './tenant.service';
import { CreateTenantDto, UpdateTenantDto, TenantResponseDto } from './dto/tenant.dto';
import { Tenant } from './entities/tenant.entity';
import { RequireRole, CurrentApiKey, RequireUnscopedKey } from '../auth/decorators/auth.decorators';
import { type ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';

@ApiTags('tenants')
@Controller('tenants')
// Tenant management has no session dimension, so — like the api-key lifecycle routes — a session- or
// tenant-scoped key must not reach it. @RequireUnscopedKey fences out any key that resolves to a
// non-empty scope, which a tenant key always does, so only a global admin can manage tenants.
@RequireUnscopedKey()
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly auditService: AuditService,
  ) {}

  private auditContext(
    req: Request,
    actor?: ApiKey,
  ): { apiKey?: ApiKey; ipAddress?: string; method?: string; path?: string } {
    return {
      apiKey: actor,
      ipAddress: (req as Request & { clientIp?: string }).clientIp ?? undefined,
      method: req.method,
      path: req.path,
    };
  }

  private toResponse(t: Tenant): TenantResponseDto {
    return {
      id: t.id,
      name: t.name,
      externalId: t.externalId ?? null,
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  @Post()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Create a tenant (global admin only)' })
  @ApiResponse({ status: 201, description: 'Tenant created', type: TenantResponseDto })
  @ApiResponse({ status: 409, description: 'A tenant with that externalId already exists.' })
  async create(
    @Body() dto: CreateTenantDto,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<TenantResponseDto> {
    const tenant = await this.tenantService.create(dto);
    await this.auditService.logInfo(AuditAction.TENANT_CREATED, {
      ...this.auditContext(req, actor),
      metadata: { tenantId: tenant.id, name: tenant.name, externalId: tenant.externalId },
    });
    return this.toResponse(tenant);
  }

  @Get()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'List all tenants (global admin only)' })
  @ApiResponse({ status: 200, description: 'Tenants', type: [TenantResponseDto] })
  async findAll(): Promise<TenantResponseDto[]> {
    const tenants = await this.tenantService.findAll();
    return tenants.map(t => this.toResponse(t));
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get one tenant (global admin only)' })
  @ApiResponse({ status: 200, description: 'Tenant', type: TenantResponseDto })
  @ApiResponse({ status: 404, description: 'Tenant not found.' })
  async findOne(@Param('id') id: string): Promise<TenantResponseDto> {
    return this.toResponse(await this.tenantService.findOne(id));
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update a tenant (global admin only)' })
  @ApiResponse({ status: 200, description: 'Tenant updated', type: TenantResponseDto })
  @ApiResponse({ status: 404, description: 'Tenant not found.' })
  @ApiResponse({ status: 409, description: 'A tenant with that externalId already exists.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<TenantResponseDto> {
    const tenant = await this.tenantService.update(id, dto);
    await this.auditService.logInfo(AuditAction.TENANT_UPDATED, {
      ...this.auditContext(req, actor),
      metadata: { tenantId: tenant.id, name: tenant.name, externalId: tenant.externalId, isActive: tenant.isActive },
    });
    return this.toResponse(tenant);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tenant (global admin only); refused while keys/sessions reference it' })
  @ApiResponse({ status: 204, description: 'Tenant deleted' })
  @ApiResponse({ status: 404, description: 'Tenant not found.' })
  @ApiResponse({ status: 409, description: 'Tenant still has API keys or sessions; retarget/remove them or deactivate instead.' })
  async remove(@Param('id') id: string, @Req() req: Request, @CurrentApiKey() actor?: ApiKey): Promise<void> {
    await this.tenantService.remove(id);
    await this.auditService.logInfo(AuditAction.TENANT_DELETED, {
      ...this.auditContext(req, actor),
      metadata: { tenantId: id },
    });
  }
}
