import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 往来单位（供应商 / 客户）
 *
 * 采购与销售单据的 counterparty 指向此表。隔离维度与物料一致：tenant_id + company_id。
 * 编码在公司内唯一（uk_partners_code_company），类型/状态用枚举约束。
 */
export class CreatePartner1730400000000 implements MigrationInterface {
  name = 'CreatePartner1730400000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`partners\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`type\` enum('supplier','customer','both') NOT NULL DEFAULT 'supplier',
        \`contact\` varchar(64) DEFAULT NULL,
        \`phone\` varchar(32) DEFAULT NULL,
        \`tax_no\` varchar(32) DEFAULT NULL,
        \`address\` varchar(255) DEFAULT NULL,
        \`bank_name\` varchar(128) DEFAULT NULL,
        \`bank_account\` varchar(64) DEFAULT NULL,
        \`status\` enum('active','disabled') NOT NULL DEFAULT 'active',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_partners_code_company\` (\`code\`,\`company_id\`),
        KEY \`idx_partners_company\` (\`company_id\`),
        KEY \`idx_partners_tenant\` (\`tenant_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='往来单位，供应商/客户共用'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `partners`')
  }
}
