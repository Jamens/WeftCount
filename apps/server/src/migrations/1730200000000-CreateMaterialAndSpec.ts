import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 物料主数据与坯布规格
 *
 * 金额与数量用 decimal 而非 float：float 的二进制表示无法精确表达小数，
 * 累计误差会让「三算对不上」变成常态。
 */
export class CreateMaterialAndSpec1730200000000 implements MigrationInterface {
  name = 'CreateMaterialAndSpec1730200000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`materials\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`category\` enum('yarn','greige','finished','auxiliary','spare') NOT NULL,
        \`specification\` varchar(255) NOT NULL,
        \`measure_mode\` enum('weight','length','area','count') NOT NULL,
        \`primary_unit\` varchar(16) NOT NULL,
        \`allowed_units\` json NOT NULL,
        \`batch_managed\` tinyint(1) NOT NULL DEFAULT '1',
        \`safety_stock\` decimal(14,4) DEFAULT NULL,
        \`standard_price\` decimal(14,4) DEFAULT NULL,
        \`status\` enum('active','discontinued') NOT NULL DEFAULT 'active',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_materials_code_company\` (\`code\`, \`company_id\`),
        KEY \`idx_materials_company\` (\`company_id\`),
        KEY \`idx_materials_category\` (\`category\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物料主数据'
    `)

    await queryRunner.query(`
      CREATE TABLE \`greige_specs\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`finished_width\` decimal(8,2) NOT NULL COMMENT '成品门幅 cm',
        \`warp_density\` decimal(8,2) NOT NULL COMMENT '经密 根/英寸',
        \`weft_density\` decimal(8,2) NOT NULL COMMENT '纬密 根/英寸',
        \`weave_type\` enum('plain','twill','satin','jacquard','leno','pile') NOT NULL DEFAULT 'plain',
        \`warp_count_value\` decimal(10,2) NOT NULL,
        \`warp_count_system\` enum('NeS','Nm','Tex','D') NOT NULL,
        \`weft_count_value\` decimal(10,2) NOT NULL,
        \`weft_count_system\` enum('NeS','Nm','Tex','D') NOT NULL,
        \`warp_material_id\` char(36) DEFAULT NULL,
        \`weft_material_id\` char(36) DEFAULT NULL,
        \`loom_width\` decimal(8,2) DEFAULT NULL,
        \`width_allowance\` decimal(6,2) NOT NULL DEFAULT '10.00',
        \`warp_loss_rate\` decimal(6,4) NOT NULL DEFAULT '0.0550',
        \`weft_loss_rate\` decimal(6,4) NOT NULL DEFAULT '0.0500',
        \`picks_per_minute\` int DEFAULT NULL,
        \`machine_run_rate\` decimal(5,4) NOT NULL DEFAULT '0.8500',
        \`calculated_gsm\` decimal(8,2) NOT NULL COMMENT '内核计算克重，业务不得手填',
        \`measured_gsm\` decimal(8,2) DEFAULT NULL COMMENT '出厂实测克重，用于校准',
        \`last_snapshot\` json DEFAULT NULL,
        \`status\` enum('active','discontinued') NOT NULL DEFAULT 'active',
        \`remark\` varchar(255) DEFAULT NULL,
        \`spec_version\` int NOT NULL DEFAULT '1',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_greige_specs_code_company\` (\`code\`, \`company_id\`),
        KEY \`idx_greige_specs_company\` (\`company_id\`),
        KEY \`idx_greige_specs_warp_material\` (\`warp_material_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='坯布规格，克重由工艺内核计算'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `greige_specs`')
    await queryRunner.query('DROP TABLE IF EXISTS `materials`')
  }
}
