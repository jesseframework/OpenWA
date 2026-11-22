import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `tenantId` to `sessions` (the **data** connection) — the tenant that owns a session. A
 * tenant-scoped API key sees and acts on only the sessions whose tenantId matches its own
 * (fail-closed); NULL predates tenancy and is visible only to a global (no-tenant) key. Indexed for
 * the scoped list/stats `WHERE tenantId = ...` filter.
 *
 * The data connection may be SQLite or PostgreSQL and runs with `synchronize` off on PostgreSQL, so
 * this is hand-authored and idempotent: the column and index are each probed / guarded before DDL,
 * so a run interrupted between statements still completes and a DB previously created by synchronize
 * is safe to adopt.
 */
export class AddSessionTenantId1792000200000 implements MigrationInterface {
  name = 'AddSessionTenantId1792000200000';

  private async hasColumn(queryRunner: QueryRunner, name: string): Promise<boolean> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'sessions' AND column_name = '${name}'`,
      )) as unknown[];
      return rows.length > 0;
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("sessions")`)) as Array<{ name: string }>;
    return rows.some(r => r.name === name);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner, 'tenantId'))) {
      await queryRunner.query(`ALTER TABLE "sessions" ADD COLUMN "tenantId" varchar(36) NULL`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessions_tenantId" ON "sessions" ("tenantId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessions_tenantId"`);
    if (await this.hasColumn(queryRunner, 'tenantId')) {
      await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "tenantId"`);
    }
  }
}
