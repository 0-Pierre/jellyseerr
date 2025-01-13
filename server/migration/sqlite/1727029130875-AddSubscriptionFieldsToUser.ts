import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableColumn } from 'typeorm';

export class AddSubscriptionFieldsToUser1727029130875
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('user', [
      new TableColumn({
        name: 'subscriptionStatus',
        type: 'varchar',
        isNullable: true,
      }),
      new TableColumn({
        name: 'subscriptionExpirationDate',
        type: 'datetime',
        isNullable: true,
      }),
      new TableColumn({
        name: 'suspiciousActivityCount',
        type: 'integer',
        default: 0,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user', 'subscriptionStatus');
    await queryRunner.dropColumn('user', 'subscriptionExpirationDate');
    await queryRunner.dropColumn('user', 'suspiciousActivityCount');
  }
}
