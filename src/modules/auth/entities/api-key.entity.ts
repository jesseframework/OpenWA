import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum ApiKeyRole {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  VIEWER = 'viewer',
}

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  keyHash!: string;

  // 12 to fit the 12-char prefix that auth.service writes (was varchar(8); harmless on the
  // hardcoded-SQLite `main` connection, but kept consistent with the code).
  @Column({ type: 'varchar', length: 12 })
  keyPrefix!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: ApiKeyRole.OPERATOR,
  })
  role!: ApiKeyRole;

  @Column({ type: 'simple-array', nullable: true })
  allowedIps!: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  allowedSessions!: string[] | null;

  // Chat-level allowlist, independent of allowedSessions and the same fail-open semantic: NULL or
  // empty means "every chat". Entries are WhatsApp chat ids (a group `<id>@g.us`, a contact
  // `<phone>@c.us` / `<lid>@lid`, or a bare phone number). Enforced on the read surface and on
  // sends; see src/common/security/chat-scope.ts.
  @Column({ type: 'simple-array', nullable: true })
  allowedChats!: string[] | null;

  // Tenant this key belongs to, or NULL for a global/platform key. A key with a tenantId is
  // auto-scoped FAIL-CLOSED to only the sessions of that tenant (see validateApiKey + the session
  // list/stats queries + create-stamp), independently of allowedSessions — which stays fail-open and
  // may narrow further WITHIN the tenant. A NULL tenantId is the pre-tenancy global key: it sees
  // every session and is the only kind that manages tenants and other keys. Indexed with the SAME
  // name the AddApiKeyTenantId migration uses, so the migration (prod) and a MAIN_DATABASE_SYNCHRONIZE
  // boot (dev/e2e) agree and neither leaves the other's index as drift.
  // Optional at the type level (null in the DB when unset) so enforcement branches on truthiness.
  @Index('IDX_api_keys_tenantId')
  @Column({ type: 'varchar', length: 36, nullable: true })
  tenantId?: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  usageCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
