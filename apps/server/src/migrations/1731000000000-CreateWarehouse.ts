import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 仓库主数据 + 库存批次归属仓库
 *
 * 1) warehouses 表：仓库主数据（编码 W+流水，类型 raw/greige/finished/auxiliary/scrap/other）
 * 2) inventory_batches 加 warehouse_id：每个批次归属一个仓库，调拨即批次在仓间移动。
 *    存量批次先置 NULL（未指定仓库），调拨/新批次按指定或默认仓归位。
 */
export class CreateWarehouse1731000000000 implements MigrationInterface {
  name = 'CreateWarehouse1731000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`warehouses\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(64) NOT NULL,
        \`type\` enum('raw','greige','finished','auxiliary','scrap','other') NOT NULL DEFAULT 'other',
        \`address\` varchar(255) DEFAULT NULL,
        \`keeper\` varchar(64) DEFAULT NULL,
        \`status\` enum('active','disabled') NOT NULL DEFAULT 'active',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_warehouses_code_company\` (\`code\`,\`company_id\`),
        KEY \`idx_warehouses_company\` (\`company_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库主数据'
    `)

    await queryRunner.query(`
      ALTER TABLE \`inventory_batches\`
        ADD COLUMN \`warehouse_id\` char(36) DEFAULT NULL COMMENT '所属仓库' AFTER \`spec_id\`,
        ADD KEY \`idx_batches_warehouse\` (\`company_id\`,\`warehouse_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `inventory_batches` DROP KEY `idx_batches_warehouse`, DROP COLUMN `warehouse_id`')
    await queryRunner.query('DROP TABLE IF EXISTS `warehouses`')
  }
}
