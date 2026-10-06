import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 采购订单可由补货预警一键生成
 *
 * `source_alert_id` 记录「这张采购单是哪条补货预警生成的」，用于
 * ①**防重复生成**（同一预警不允许产生第二张采购单）
 * ② 回溯：点开订单能看到建议来源，采购员能核对「为什么买这个量」
 */
export class OrderFromAlert1732400000000 implements MigrationInterface {
  name = 'OrderFromAlert1732400000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`trade_orders\`
        ADD COLUMN \`source_alert_id\` char(36) DEFAULT NULL
          COMMENT '来源补货预警id(防重复生成+回溯建议来源)' AFTER \`contract_id\`
    `)
    await queryRunner.query(`
      CREATE INDEX \`idx_orders_source_alert\` ON \`trade_orders\` (\`company_id\`,\`source_alert_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `idx_orders_source_alert` ON `trade_orders`')
    await queryRunner.query(`
      ALTER TABLE \`trade_orders\` DROP COLUMN \`source_alert_id\`
    `)
  }
}
