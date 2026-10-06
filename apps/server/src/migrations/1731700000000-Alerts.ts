import { MigrationInterface, QueryRunner } from 'typeorm'

/** 预警中心：规则扫描生成交期逾期/库存低位/呆滞批次预警 */
export class Alerts1731700000000 implements MigrationInterface {
  name = 'Alerts1731700000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`alerts\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`type\` enum('order_overdue','low_stock','stale_batch') NOT NULL COMMENT '预警类型',
        \`severity\` enum('info','warning','critical') NOT NULL,
        \`title\` varchar(128) NOT NULL,
        \`message\` varchar(500) NOT NULL,
        \`ref_type\` varchar(32) NOT NULL,
        \`ref_id\` char(36) NOT NULL,
        \`acknowledged\` tinyint(1) NOT NULL DEFAULT 0,
        \`acknowledged_by\` char(36) DEFAULT NULL,
        \`acknowledged_at\` datetime(6) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_alerts_company_ack\` (\`company_id\`,\`acknowledged\`),
        KEY \`idx_alerts_dedup\` (\`company_id\`,\`type\`,\`ref_id\`,\`acknowledged\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预警中心'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `alerts`')
  }
}
