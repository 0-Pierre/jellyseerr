import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveSuspiciousActivityCount1772000000000
  implements MigrationInterface
{
  name = 'RemoveSuspiciousActivityCount1772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `ALTER TABLE "user" DROP COLUMN IF EXISTS "suspiciousActivityCount"`
      );
      return;
    }

    const columns: Array<{ name: string }> = await queryRunner.query(
      `PRAGMA table_info("user")`
    );
    const hasColumn = columns.some(
      (column) => column.name === 'suspiciousActivityCount'
    );

    if (hasColumn) {
      await queryRunner.query(
        `ALTER TABLE "user" DROP COLUMN "suspiciousActivityCount"`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "suspiciousActivityCount" integer NOT NULL DEFAULT 0`
      );
      return;
    }

    const columns: Array<{ name: string }> = await queryRunner.query(
      `PRAGMA table_info("user")`
    );
    const hasColumn = columns.some(
      (column) => column.name === 'suspiciousActivityCount'
    );

    if (!hasColumn) {
      await queryRunner.query(
        `ALTER TABLE "user" ADD COLUMN "suspiciousActivityCount" integer NOT NULL DEFAULT (0)`
      );
    }
  }
}
