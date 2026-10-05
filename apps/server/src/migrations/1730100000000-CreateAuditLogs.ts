import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 审计日志表
 *
 * 索引策略：
 * - (tenant_id, company_id, created_at)：最常用的「本厂近期操作」列表
 * - (tenant_id, target_type, target_id)：单据的完整变更史
 * - (tenant_id, user_id, created_at)：某人的操作轨迹
 */
export class CreateAuditLogs1730100000000 implements MigrationInterface {
  name = 'CreateAuditLogs1730100000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`audit_logs\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`user_id\` char(36) NOT NULL,
        \`username\` varchar(64) NOT NULL,
        \`real_name\` varchar(64) NOT NULL,
        \`action\` varchar(16) NOT NULL,
        \`module\` varchar(64) NOT NULL,
        \`summary\` varchar(128) DEFAULT NULL,
        \`target_type\` varchar(64) DEFAULT NULL,
        \`target_id\` varchar(64) DEFAULT NULL,
        \`http_method\` varchar(8) NOT NULL,
        \`path\` varchar(255) NOT NULL,
        \`ip\` varchar(64) DEFAULT NULL,
        \`user_agent\` varchar(255) DEFAULT NULL,
        \`diff\` json DEFAULT NULL,
        \`duration_ms\` int DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_logs_tenant_company\` (\`tenant_id\`, \`company_id\`, \`created_at\`),
        KEY \`idx_audit_logs_target\` (\`tenant_id\`, \`target_type\`, \`target_id\`),
        KEY \`idx_audit_logs_user\` (\`tenant_id\`, \`user_id\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志，只增不改不删'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS \`audit_logs\`')
  }
}
