import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 库存：批次、流水、单据（采购入库/生产领用/销售出库）
 *
 * 三张表共同支撑「一件事三算」闭环：
 *   - inventory_batches  批次，以米为主单位，冗余 kg / m² 视图
 *   - inventory_transactions  流水，每次移动三视图齐全
 *   - inventory_documents  单据，三种类型共用一表
 */
export class CreateInventory1730300000000 implements MigrationInterface {
  name = 'CreateInventory1730300000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`inventory_batches\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`batch_no\` varchar(32) NOT NULL,
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`width_cm\` decimal(8,2) NOT NULL,
        \`spec_snapshot\` json NOT NULL,
        \`quantity\` decimal(14,3) NOT NULL COMMENT '入库数量(米)',
        \`weight_kg\` decimal(14,3) NOT NULL COMMENT '入库重量 kg',
        \`area_m2\` decimal(14,4) NOT NULL COMMENT '入库面积 m²',
        \`remaining_quantity\` decimal(14,3) NOT NULL,
        \`remaining_weight_kg\` decimal(14,3) NOT NULL,
        \`remaining_area_m2\` decimal(14,4) NOT NULL,
        \`unit_cost\` decimal(14,4) DEFAULT NULL,
        \`source_type\` enum('purchase_inbound','production_in','stock_transfer','stock_adjust','count_gain') NOT NULL,
        \`source_doc_id\` char(36) NOT NULL,
        \`status\` enum('normal','frozen','depleted') NOT NULL DEFAULT 'normal',
        \`inbound_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_batches_company\` (\`company_id\`),
        KEY \`idx_batches_material\` (\`company_id\`,\`material_id\`),
        KEY \`idx_batches_spec\` (\`company_id\`,\`spec_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存批次，主单位米，冗余kg/m2视图'
    `)

    await queryRunner.query(`
      CREATE TABLE \`inventory_transactions\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`batch_id\` char(36) NOT NULL,
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`direction\` enum('in','out') NOT NULL,
        \`txn_type\` enum('purchase_in','production_in','material_issue','sales_out','stock_adjust','stock_transfer','count_gain','count_loss','scrap') NOT NULL,
        \`change_quantity\` decimal(14,3) NOT NULL COMMENT '变化量(米)',
        \`change_weight_kg\` decimal(14,3) NOT NULL,
        \`change_area_m2\` decimal(14,4) NOT NULL,
        \`after_quantity\` decimal(14,3) NOT NULL,
        \`after_weight_kg\` decimal(14,3) NOT NULL,
        \`after_area_m2\` decimal(14,4) NOT NULL,
        \`unit_price\` decimal(14,4) DEFAULT NULL,
        \`doc_id\` char(36) NOT NULL,
        \`operator_id\` char(36) NOT NULL,
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_txn_company\` (\`company_id\`),
        KEY \`idx_txn_batch\` (\`company_id\`,\`batch_id\`),
        KEY \`idx_txn_doc\` (\`company_id\`,\`doc_id\`),
        KEY \`idx_txn_created\` (\`company_id\`,\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存事务流水，三视图齐全'
    `)

    await queryRunner.query(`
      CREATE TABLE \`inventory_documents\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`doc_no\` varchar(32) NOT NULL,
        \`doc_type\` enum('purchase_inbound','production_issue','sales_outbound') NOT NULL,
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`width_cm\` decimal(8,2) NOT NULL,
        \`spec_snapshot\` json NOT NULL,
        \`entered_unit\` varchar(8) NOT NULL COMMENT '录入单位 kg/m/m2',
        \`entered_value\` decimal(14,4) NOT NULL,
        \`quantity_m\` decimal(14,3) NOT NULL COMMENT '折算主单位(米)',
        \`weight_kg\` decimal(14,3) NOT NULL COMMENT '折算重量 kg',
        \`area_m2\` decimal(14,4) NOT NULL COMMENT '折算面积 m²',
        \`unit_price\` decimal(14,4) DEFAULT NULL,
        \`total_amount\` decimal(16,2) DEFAULT NULL,
        \`counterparty\` varchar(128) DEFAULT NULL,
        \`operator_id\` char(36) NOT NULL,
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_docs_no_company\` (\`doc_no\`,\`company_id\`),
        KEY \`idx_docs_company\` (\`company_id\`),
        KEY \`idx_docs_type\` (\`company_id\`,\`doc_type\`),
        KEY \`idx_docs_spec\` (\`company_id\`,\`spec_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存单据，采购/领用/销售共用'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `inventory_documents`')
    await queryRunner.query('DROP TABLE IF EXISTS `inventory_transactions`')
    await queryRunner.query('DROP TABLE IF EXISTS `inventory_batches`')
  }
}
