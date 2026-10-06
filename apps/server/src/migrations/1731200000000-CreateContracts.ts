import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 合同 / 价格层
 *
 * contracts(合同头：采购/销售、往来单位、状态、总量总金额冗余) +
 * contract_items(明细行：物料+规格、协议单价元/米、协议数量米、行金额)。
 * 多行结构承载「合同多明细 + 协议价」，订单可在生效合同下取价。
 */
export class CreateContracts1731200000000 implements MigrationInterface {
  name = 'CreateContracts1731200000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`contracts\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`contract_no\` varchar(32) NOT NULL COMMENT 'HT+日期+流水',
        \`contract_type\` enum('purchase','sales') NOT NULL,
        \`partner_id\` char(36) NOT NULL,
        \`partner_name\` varchar(128) NOT NULL COMMENT '往来单位名称快照',
        \`status\` enum('draft','active','completed','cancelled') NOT NULL DEFAULT 'draft',
        \`total_quantity_m\` decimal(16,3) NOT NULL DEFAULT 0 COMMENT '协议总数量(米)=明细合计',
        \`total_amount\` decimal(18,2) NOT NULL DEFAULT 0 COMMENT '协议总金额(元)=明细合计',
        \`start_date\` date DEFAULT NULL,
        \`end_date\` date DEFAULT NULL,
        \`remark\` varchar(255) DEFAULT NULL,
        \`version\` int NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_ct_no_company\` (\`contract_no\`,\`company_id\`),
        KEY \`idx_ct_company\` (\`company_id\`),
        KEY \`idx_ct_partner\` (\`company_id\`,\`partner_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购/销售合同(框架协议)'
    `)

    await queryRunner.query(`
      CREATE TABLE \`contract_items\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`contract_id\` char(36) NOT NULL,
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`agreed_price\` decimal(14,4) NOT NULL COMMENT '协议单价(元/米)',
        \`agreed_quantity_m\` decimal(16,3) NOT NULL COMMENT '协议数量(米)',
        \`amount\` decimal(18,2) NOT NULL COMMENT '行金额=单价*数量',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_cti_contract\` (\`contract_id\`),
        KEY \`idx_cti_spec\` (\`company_id\`,\`spec_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同明细行(物料+规格+协议价)'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `contract_items`')
    await queryRunner.query('DROP TABLE IF EXISTS `contracts`')
  }
}
