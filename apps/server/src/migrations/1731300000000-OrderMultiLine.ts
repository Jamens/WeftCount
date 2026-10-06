import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 订单多明细重构
 *
 * trade_orders 由「单行」改为「订单头 + 明细行」：
 *   1) 新建 trade_order_items 明细行表
 *   2) trade_orders 加冗余汇总 total_quantity_m / contract_id
 *   3) 把原单行数据(物料/规格/数量/单价)搬成一条明细行，表头总量取原 quantity_m / total_amount
 *   4) 删掉 trade_orders 上的单行列(material_id/spec_id/规格快照/单位/数量/三视图/单价)
 */
export class OrderMultiLine1731300000000 implements MigrationInterface {
  name = 'OrderMultiLine1731300000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`trade_order_items\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`order_id\` char(36) NOT NULL,
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`spec_snapshot\` json NOT NULL,
        \`ordered_unit\` varchar(8) NOT NULL,
        \`ordered_value\` decimal(14,4) NOT NULL,
        \`quantity_m\` decimal(14,3) NOT NULL,
        \`weight_kg\` decimal(14,3) NOT NULL,
        \`area_m2\` decimal(14,4) NOT NULL,
        \`unit_price\` decimal(14,4) DEFAULT NULL,
        \`line_amount\` decimal(18,2) DEFAULT NULL,
        \`contract_item_id\` char(36) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_oti_order\` (\`order_id\`),
        KEY \`idx_oti_spec\` (\`company_id\`,\`spec_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单明细行'
    `)

    // 订单头加汇总总量 + 合同关联
    await queryRunner.query(`
      ALTER TABLE \`trade_orders\`
        ADD COLUMN \`total_quantity_m\` decimal(16,3) NOT NULL DEFAULT 0 COMMENT '汇总数量(米)=明细合计' AFTER \`partner_name\`,
        ADD COLUMN \`contract_id\` char(36) DEFAULT NULL COMMENT '来源合同(可选)' AFTER \`total_amount\`
    `)

    // 搬迁：把每个原单行订单变成一条明细行
    await queryRunner.query(`
      INSERT INTO \`trade_order_items\`
        (id, tenant_id, company_id, order_id, material_id, spec_id, spec_snapshot, ordered_unit, ordered_value,
         quantity_m, weight_kg, area_m2, unit_price, line_amount, contract_item_id, created_at)
      SELECT
        UUID(), tenant_id, company_id, id, material_id, spec_id, spec_snapshot, ordered_unit, ordered_value,
        quantity_m, weight_kg, area_m2, unit_price, total_amount, NULL, created_at
      FROM \`trade_orders\`
    `)

    // 订单头总量取原单行值
    await queryRunner.query('UPDATE `trade_orders` SET `total_quantity_m` = `quantity_m`')

    // 删除订单头上的单行列
    await queryRunner.query(`
      ALTER TABLE \`trade_orders\`
        DROP COLUMN \`material_id\`,
        DROP COLUMN \`spec_id\`,
        DROP COLUMN \`spec_snapshot\`,
        DROP COLUMN \`ordered_unit\`,
        DROP COLUMN \`ordered_value\`,
        DROP COLUMN \`quantity_m\`,
        DROP COLUMN \`weight_kg\`,
        DROP COLUMN \`area_m2\`,
        DROP COLUMN \`unit_price\`
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 简化回滚：仅保留第一个明细行回填到订单头单行列（多明细无法无损回退）
    await queryRunner.query(`
      ALTER TABLE \`trade_orders\`
        ADD COLUMN \`material_id\` char(36) DEFAULT NULL AFTER \`partner_name\`,
        ADD COLUMN \`spec_id\` char(36) DEFAULT NULL AFTER \`material_id\`,
        ADD COLUMN \`spec_snapshot\` json DEFAULT NULL AFTER \`spec_id\`,
        ADD COLUMN \`ordered_unit\` varchar(8) DEFAULT NULL AFTER \`spec_snapshot\`,
        ADD COLUMN \`ordered_value\` decimal(14,4) DEFAULT NULL AFTER \`ordered_unit\`,
        ADD COLUMN \`quantity_m\` decimal(14,3) DEFAULT NULL AFTER \`ordered_value\`,
        ADD COLUMN \`weight_kg\` decimal(14,3) DEFAULT NULL AFTER \`quantity_m\`,
        ADD COLUMN \`area_m2\` decimal(14,4) DEFAULT NULL AFTER \`weight_kg\`,
        ADD COLUMN \`unit_price\` decimal(14,4) DEFAULT NULL AFTER \`area_m2\`
    `)
    await queryRunner.query(`
      UPDATE trade_orders t
      JOIN trade_order_items i ON i.order_id = t.id
      SET t.material_id=i.material_id, t.spec_id=i.spec_id, t.spec_snapshot=i.spec_snapshot,
          t.ordered_unit=i.ordered_unit, t.ordered_value=i.ordered_value, t.quantity_m=i.quantity_m,
          t.weight_kg=i.weight_kg, t.area_m2=i.area_m2, t.unit_price=i.unit_price
    `)
    await queryRunner.query(
      'ALTER TABLE `trade_orders` DROP COLUMN `contract_id`, DROP COLUMN `total_quantity_m`',
    )
    await queryRunner.query('DROP TABLE IF EXISTS `trade_order_items`')
  }
}
