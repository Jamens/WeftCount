import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 盘点（stocktake）
 *
 * stocktakes 盘点单(仓库/日期/状态) + stocktake_items 明细(批次快照账面量 + 实盘量)。
 * 完成盘点时按差异把批次剩余调平并记 count_gain(盘盈)/count_loss(盘亏) 流水。
 */
export class CreateStocktake1731100000000 implements MigrationInterface {
  name = 'CreateStocktake1731100000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`stocktakes\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`stocktake_no\` varchar(32) NOT NULL COMMENT 'PD+日期+流水',
        \`warehouse_id\` char(36) NOT NULL,
        \`stocktake_date\` date NOT NULL,
        \`status\` enum('draft','completed','cancelled') NOT NULL DEFAULT 'draft',
        \`operator_id\` char(36) NOT NULL,
        \`remark\` varchar(255) DEFAULT NULL,
        \`version\` int NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_st_no_company\` (\`stocktake_no\`,\`company_id\`),
        KEY \`idx_st_company\` (\`company_id\`),
        KEY \`idx_st_warehouse\` (\`company_id\`,\`warehouse_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点单'
    `)

    await queryRunner.query(`
      CREATE TABLE \`stocktake_items\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`stocktake_id\` char(36) NOT NULL,
        \`batch_id\` char(36) NOT NULL,
        \`batch_no\` varchar(32) NOT NULL COMMENT '批次号快照',
        \`book_quantity_m\` decimal(14,3) NOT NULL COMMENT '账面剩余量快照(米)',
        \`counted_quantity_m\` decimal(14,3) DEFAULT NULL COMMENT '实盘量(米)',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_sti_stocktake\` (\`stocktake_id\`),
        KEY \`idx_sti_batch\` (\`stocktake_id\`,\`batch_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点明细'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `stocktake_items`')
    await queryRunner.query('DROP TABLE IF EXISTS `stocktakes`')
  }
}
