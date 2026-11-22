import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `tenantId` to `api_keys` — the tenant a key belongs to (NULL = global/platform key). A key
 * with a tenantId is auto-scoped FAIL-CLOSED to that tenant's sessions, independently of the
 * fail-open `allowedSessions`. Runs on the **main** connection (auth), which is always SQLite; the
 * postgres branch in `hasColumn` is kept for parity with the other migrations and is harmless here.
 * Idempotent: the column is probed before the ALTER, so a database previously created by
 * `synchronize` (which already has the column) is safe to adopt.
 */
export class AddApiKeyTenantId1792000100000 implements MigrationInterface {
  name = 'AddApiKeyTenantId1792000100000';

  private async hasColumn(queryRunner: QueryRunner, name: string): Promise<boolean> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'api_keys' AND column_name = '${name}'`,
      )) as unknown[];
      return rows.length > 0;
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("api_keys")`)) as Array<{ name: string }>;
    return rows.some(r => r.name === name);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner, 'tenantId'))) {
      await queryRunner.query(`ALTER TABLE "api_keys" ADD COLUMN "tenantId" varchar(36) NULL`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_api_keys_tenantId" ON "api_keys" ("tenantId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_api_keys_tenantId"`);
    if (await this.hasColumn(queryRunner, 'tenantId')) {
      await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "tenantId"`);
    }
  }
}
