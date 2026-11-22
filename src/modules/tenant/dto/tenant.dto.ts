import { IsString, IsOptional, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ToStrictString, ToStrictBoolean } from '../../../common/utils/strict-boolean';
import { MaxCodePoints } from '../../../common/validation/max-code-points';

export class CreateTenantDto {
  @ApiProperty({
    description: 'Human-readable tenant name.',
    example: 'Acme Corp',
    minLength: 1,
    maxLength: 100,
  })
  @ToStrictString()
  @IsString()
  @MinLength(1)
  @MaxCodePoints(100)
  name!: string;

  @ApiPropertyOptional({
    description:
      'External identity this tenant maps to — e.g. the WorkHub workspace id for "Sign in with ' +
      'WorkHub", so the workspace resolves to the same tenant on every login. Unique across tenants ' +
      'when set; omit for a tenant managed only inside OpenWA.',
    example: 'wh_ws_4f1c2d',
    maxLength: 190,
  })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MaxCodePoints(190)
  externalId?: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MinLength(1)
  @MaxCodePoints(100)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Reassign the external id, or null to clear it. Unique across tenants when set.',
    maxLength: 190,
  })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MaxCodePoints(190)
  externalId?: string | null;

  @ApiPropertyOptional({
    description:
      'Deactivate (false) or reactivate (true) the tenant. Deactivation is advisory metadata — it ' +
      'does not by itself change session visibility; a key stays bound to the tenant until retargeted.',
  })
  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  externalId?: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
