import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 生产工单模块：机台 + 生产工单 + 报工
 *
 * 机台(织机)是生产资源；生产工单是织造任务(计划米)并指派机台；
 * 挡车工报工累计实际产出米，满额工单自动完成。
 */
export class CreateProduction1730800000000 implements MigrationInterface {
  name = 'CreateProduction1730800000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`machines\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(64) NOT NULL,
        \`model\` varchar(64) DEFAULT NULL,
        \`status\` enum('idle','running','maintenance','retired') NOT NULL DEFAULT 'idle',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_machines_code_company\` (\`code\`,\`company_id\`),
        KEY \`idx_machines_company\` (\`company_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机台(织机)主数据'
    `)

    await queryRunner.query(`
      CREATE TABLE \`production_orders\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`order_no\` varchar(32) NOT NULL COMMENT 'SC+日期+流水',
        \`material_id\` char(36) NOT NULL COMMENT '产出物料(坯布)',
        \`spec_id\` char(36) NOT NULL,
        \`spec_snapshot\` json NOT NULL,
        \`planned_quantity_m\` decimal(14,3) NOT NULL COMMENT '计划产量(米)',
        \`produced_quantity_m\` decimal(14,3) NOT NULL DEFAULT 0 COMMENT '累计产出(米)',
        \`machine_id\` char(36) DEFAULT NULL COMMENT '指派机台',
        \`status\` enum('draft','scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'draft',
        \`planned_start_date\` date DEFAULT NULL,
        \`due_date\` date DEFAULT NULL,
        \`remark\` varchar(255) DEFAULT NULL,
        \`version\` int NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_prod_no_company\` (\`order_no\`,\`company_id\`),
        KEY \`idx_prod_company\` (\`company_id\`),
        KEY \`idx_prod_machine\` (\`company_id\`,\`machine_id\`),
        KEY \`idx_prod_status\` (\`company_id\`,\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单，织造任务'
    `)

    await queryRunner.query(`
      CREATE TABLE \`production_reports\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`order_id\` char(36) NOT NULL,
        \`machine_id\` char(36) NOT NULL,
        \`report_date\` date NOT NULL,
        \`output_m\` decimal(14,3) NOT NULL COMMENT '实际产出(米)',
        \`stoppage_minutes\` int DEFAULT NULL,
        \`stop_reason\` varchar(255) DEFAULT NULL,
        \`operator_id\` char(36) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_reports_order\` (\`company_id\`,\`order_id\`),
        KEY \`idx_reports_machine_date\` (\`company_id\`,\`machine_id\`,\`report_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='挡车工报工记录'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `production_reports`')
    await queryRunner.query('DROP TABLE IF EXISTS `production_orders`')
    await queryRunner.query('DROP TABLE IF EXISTS `machines`')
  }
}
