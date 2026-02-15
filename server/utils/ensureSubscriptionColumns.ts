import { isPgsql } from '@server/datasource';
import logger from '@server/logger';
import type { DataSource } from 'typeorm';

export const ensureSubscriptionColumns = async (
  dbConnection: DataSource
): Promise<void> => {
  if (isPgsql) {
    return;
  }

  const columns: Array<{ name: string }> = await dbConnection.query(
    `PRAGMA table_info("user")`
  );
  const existing = new Set(columns.map((column) => column.name));

  const statements: string[] = [];
  if (!existing.has('subscriptionStatus')) {
    statements.push(
      `ALTER TABLE "user" ADD COLUMN "subscriptionStatus" varchar`
    );
  }
  if (!existing.has('subscriptionExpirationDate')) {
    statements.push(
      `ALTER TABLE "user" ADD COLUMN "subscriptionExpirationDate" datetime`
    );
  }
  if (!existing.has('notifiedAboutExpiration')) {
    statements.push(
      `ALTER TABLE "user" ADD COLUMN "notifiedAboutExpiration" boolean NOT NULL DEFAULT (0)`
    );
  }

  for (const statement of statements) {
    await dbConnection.query(statement);
  }

  if (statements.length > 0) {
    logger.info(
      `Applied subscription schema guard (${statements.length} column(s) added)`,
      { label: 'Database' }
    );
  }
};
