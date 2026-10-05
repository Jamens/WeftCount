import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 初始表结构：租户 / 公司 / 用户 / 角色
 *
 * 设计要点：
 * - 所有业务维度以 tenant_id + company_id 隔离，索引按此建立
 * - 角色按租户隔离（tenant_id + code 唯一），内置角色按租户复制而非全局共享
 * - 用户 companyIds / roleCodes 用 JSON 存多值关系，登录时展开；
 *   数据量大后可拆关联表，当前阶段用户数与公司数都在百级以内，JSON 更简单
 */
export class InitSchema1730000000000 implements MigrationInterface {
  name = 'InitSchema1730000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`tenants\` (
        \`id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`plan\` enum('basic','professional','flagship') NOT NULL DEFAULT 'basic',
        \`status\` enum('active','suspended','expired') NOT NULL DEFAULT 'active',
        \`max_companies\` int NOT NULL DEFAULT '1',
        \`max_users\` int NOT NULL DEFAULT '5',
        \`default_coefficients\` json DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenants_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`companies\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`tax_no\` varchar(32) DEFAULT NULL,
        \`address\` varchar(255) DEFAULT NULL,
        \`phone\` varchar(32) DEFAULT NULL,
        \`status\` enum('active','closed') NOT NULL DEFAULT 'active',
        \`coefficients\` json DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_companies_code_tenant\` (\`code\`, \`tenant_id\`),
        KEY \`idx_companies_tenant\` (\`tenant_id\`),
        CONSTRAINT \`fk_companies_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`roles\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(64) NOT NULL,
        \`description\` varchar(255) DEFAULT NULL,
        \`permissions\` json NOT NULL,
        \`builtin\` tinyint(1) NOT NULL DEFAULT '0',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_roles_code_tenant\` (\`code\`, \`tenant_id\`),
        KEY \`idx_roles_tenant\` (\`tenant_id\`),
        CONSTRAINT \`fk_roles_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`username\` varchar(64) NOT NULL,
        \`password_hash\` varchar(100) NOT NULL,
        \`real_name\` varchar(64) NOT NULL,
        \`phone\` varchar(32) DEFAULT NULL,
        \`email\` varchar(128) DEFAULT NULL,
        \`status\` enum('active','disabled','locked') NOT NULL DEFAULT 'active',
        \`company_ids\` json NOT NULL,
        \`role_codes\` json NOT NULL,
        \`last_login_at\` datetime DEFAULT NULL,
        \`password_changed_at\` datetime DEFAULT NULL,
        \`failed_attempts\` int NOT NULL DEFAULT '0',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_users_username\` (\`username\`),
        KEY \`idx_users_tenant\` (\`tenant_id\`),
        CONSTRAINT \`fk_users_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `users`')
    await queryRunner.query('DROP TABLE IF EXISTS `roles`')
    await queryRunner.query('DROP TABLE IF EXISTS `companies`')
    await queryRunner.query('DROP TABLE IF EXISTS `tenants`')
  }
}
