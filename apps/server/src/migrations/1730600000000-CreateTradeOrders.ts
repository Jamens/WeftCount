import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 采购 / 销售订单（trade_orders）
 *
 * 采购与销售共用一表，用 order_type 区分。订单是「意向/计划」层，
 * 后续与 inventory_documents（实际收发）通过订单号/订单 id 关联。
 * 同样存 partner_name / spec_snapshot 名称与规格快照 + 三个计量视图，防历史漂移。
 */
export class CreateTradeOrders1730600000000 implements MigrationInterface {
  name = 'CreateTradeOrders1730600000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`trade_orders\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`order_no\` varchar(32) NOT NULL COMMENT 'PO/SO + 日期 + 流水',
        \`order_type\` enum('purchase','sales') NOT NULL,
        \`partner_id\` char(36) NOT NULL,
        \`partner_name\` varchar(128) NOT NULL COMMENT '往来单位名称快照',
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`spec_snapshot\` json NOT NULL,
        \`ordered_unit\` varchar(8) NOT NULL COMMENT '录入单位 kg/m/m2',
        \`ordered_value\` decimal(14,4) NOT NULL,
        \`quantity_m\` decimal(14,3) NOT NULL COMMENT '折算主单位(米)',
        \`weight_kg\` decimal(14,3) NOT NULL,
        \`area_m2\` decimal(14,4) NOT NULL,
        \`unit_price\` decimal(14,4) DEFAULT NULL,
        \`total_amount\` decimal(16,2) DEFAULT NULL,
        \`status\` enum('draft','confirmed','completed','cancelled') NOT NULL DEFAULT 'draft',
        \`expected_date\` date DEFAULT NULL COMMENT '交期',
        \`remark\` varchar(255) DEFAULT NULL,
        \`version\` int NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_orders_no_company\` (\`order_no\`,\`company_id\`),
        KEY \`idx_orders_company\` (\`company_id\`),
        KEY \`idx_orders_type\` (\`company_id\`,\`order_type\`),
        KEY \`idx_orders_partner\` (\`company_id\`,\`partner_id\`),
        KEY \`idx_orders_status\` (\`company_id\`,\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购/销售订单，计划层'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `trade_orders`')
  }
}
