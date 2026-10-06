import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 供应商条码映射
 *
 * 到货商品带的是供应商自己的条码，系统不认识；建立「供应商条码 → 我方物料+规格」映射，
 * 扫码入库时扫供应商条码查映射即可识别。唯一约束(company,supplier,code)。
 */
export class SupplierCodeMappings1731600000000 implements MigrationInterface {
  name = 'SupplierCodeMappings1731600000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`supplier_code_mappings\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`supplier_id\` char(36) NOT NULL,
        \`supplier_code\` varchar(128) NOT NULL COMMENT '供应商条码(收货时扫到的码)',
        \`material_id\` char(36) NOT NULL,
        \`spec_id\` char(36) NOT NULL,
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_scm\` (\`company_id\`,\`supplier_id\`,\`supplier_code\`),
        KEY \`idx_scm_company\` (\`company_id\`),
        KEY \`idx_scm_code\` (\`company_id\`,\`supplier_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商条码→物料/规格映射(扫码入库)'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `supplier_code_mappings`')
  }
}
