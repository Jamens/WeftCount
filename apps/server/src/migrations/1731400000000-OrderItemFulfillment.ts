import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 订单履约按行追踪
 *
 * 单据挂订单时记录「履约了订单的哪一行」(order_item_id)，使多明细订单能按行算到货/发货进度。
 * 历史单据按「单据规格 = 订单行规格」回填到首个匹配行，使存量数据也能按行归集。
 */
export class OrderItemFulfillment1731400000000 implements MigrationInterface {
  name = 'OrderItemFulfillment1731400000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `inventory_documents` ADD COLUMN `order_item_id` char(36) DEFAULT NULL COMMENT ' +
        "'履约的订单明细行(多明细订单按行算进度)' AFTER `order_id`",
    )
    // 回填：单据已挂订单的，按规格匹配订单行(取首个)写入 order_item_id
    await queryRunner.query(`
      UPDATE \`inventory_documents\` d
      JOIN \`trade_orders\` o ON o.id = d.order_id
      JOIN \`trade_order_items\` i ON i.order_id = o.id AND i.spec_id = d.spec_id AND i.material_id = d.material_id
      SET d.order_item_id = (
        SELECT i2.id FROM \`trade_order_items\` i2
        WHERE i2.order_id = o.id AND i2.spec_id = d.spec_id AND i2.material_id = d.material_id
        ORDER BY i2.created_at ASC LIMIT 1
      )
      WHERE d.order_id IS NOT NULL
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `inventory_documents` DROP COLUMN `order_item_id`')
  }
}
