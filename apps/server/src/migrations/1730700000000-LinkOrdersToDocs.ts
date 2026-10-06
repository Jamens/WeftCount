import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 单据关联订单
 *
 * inventory_documents 加可空 order_id：采购入库/销售出库可挂到「已确认」订单，
 * 系统按关联单据累加履约量，满额订单自动转已完成。生产领用不挂订单。
 */
export class LinkOrdersToDocs1730700000000 implements MigrationInterface {
  name = 'LinkOrdersToDocs1730700000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        ADD COLUMN \`order_id\` char(36) DEFAULT NULL COMMENT '关联订单(trade_orders.id)' AFTER \`partner_name\`,
        ADD KEY \`idx_docs_order\` (\`company_id\`,\`order_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `inventory_documents` DROP KEY `idx_docs_order`, DROP COLUMN `order_id`')
  }
}
