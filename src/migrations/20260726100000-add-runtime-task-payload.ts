import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddRuntimeTaskPayload20260726100000 implements MigrationInterface {
  name = 'AddRuntimeTaskPayload20260726100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasColumn('app_runtime_tasks', 'payload_json')) {
      await queryRunner.addColumn('app_runtime_tasks', new TableColumn({
        name: 'payload_json', type: 'text', isNullable: false, default: "'{}'",
      }))
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('app_runtime_tasks', 'payload_json')) {
      await queryRunner.dropColumn('app_runtime_tasks', 'payload_json')
    }
  }
}
