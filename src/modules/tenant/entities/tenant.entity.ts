import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * A tenant groups WhatsApp sessions for isolation. An API key carrying this tenant's id is
 * auto-scoped (fail-closed) to only this tenant's sessions. Lives on the **main** (auth) connection
 * alongside `api_keys`; a session's `tenantId` (on the data connection) references this id in
 * application logic, not through a cross-database foreign key.
 */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /**
   * External identity this tenant maps to — the WorkHub workspace id for "Sign in with WorkHub", so
   * a workspace resolves to the same tenant on every login. NULL for a tenant created directly in
   * OpenWA. Unique when set (enforced by the partial unique index in the CreateTenants migration).
   */
  @Column({ type: 'varchar', length: 190, nullable: true })
  externalId!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
