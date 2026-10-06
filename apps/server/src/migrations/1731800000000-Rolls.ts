import { MigrationInterface, QueryRunner } from 'typeorm'

/** 件卡(逐匹)：入库逐匹扫码计数，rollNo 公司内唯一防重扫 */
export class Rolls1731800000000 implements MigrationInterface {
  name = 'Rolls1731800000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`rolls\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`batch_id\` char(36) NOT NULL COMMENT '所属批次',
        \`roll_no\` varchar(64) NOT NULL COMMENT '件卡序列号(公司内唯一,防重扫)',
        \`meters\` decimal(14,3) NOT NULL COMMENT '该匹米数',
        \`weight_kg\` decimal(14,3) DEFAULT NULL,
        \`status\` enum('in_stock','consumed','sold') NOT NULL DEFAULT 'in_stock',
        \`source_doc_id\` char(36) DEFAULT NULL,
        \`outbound_doc_id\` char(36) DEFAULT NULL COMMENT '出库单(发货/领用写入)',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_rolls_rollno\` (\`company_id\`,\`roll_no\`),
        KEY \`idx_rolls_batch\` (\`company_id\`,\`batch_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='件卡(逐匹)'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `rolls`')
  }
}
