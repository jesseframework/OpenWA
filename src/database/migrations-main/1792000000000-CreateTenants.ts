import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `tenants` table on the **main** connection (auth; always SQLite, run every boot by the
 * main migration chain). A tenant groups WhatsApp sessions for isolation: an API key carrying a
 * matching `tenantId` sees and manages only that tenant's sessions (fail-closed). `externalId` holds
 * the WorkHub workspace id so "Sign in with WorkHub" can map a workspace to the same tenant on every
 * login. `IF NOT EXISTS` keeps it idempotent and safe to adopt a DB an earlier release created by
 * synchronize. The unique index on `externalId` is partial so many tenants may stay unmapped (NULL)
 * while a mapped workspace id is unique.
 */
export class CreateTenants1792000000000 implements MigrationInterface {
  name = 'CreateTenants1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "tenants" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"name" varchar(100) NOT NULL, ` +
        `"externalId" varchar(190), ` +
        `"isActive" boolean NOT NULL DEFAULT (1), ` +
        `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenants_externalId" ON "tenants" ("externalId") WHERE "externalId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_externalId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenants"`);
  }
}
