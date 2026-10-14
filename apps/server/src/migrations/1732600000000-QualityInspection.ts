import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 坯布检验分等 + 分等计价
 *
 * 背景：`rolls` 原本**没有品等字段**，同规格所有匹被视为同质。
 * 于是成本报表、合同价、毛利全部基于「平均质量」在算——
 * 一等布和等外布按同一个价卖，等级价差 5~15% 白白让掉。
 *
 * 本迁移建四张表：
 * - `defect_types`        疵点类型主数据（扣分流派：按长度 / 固定分）
 * - `inspections`         检验单（谁、何时、按什么标准、全检还是抽检）
 * - `inspection_rolls`    逐匹结果（实测匹长/门幅 → 扣分密度 → 定等）
 * - `inspection_defects`  逐条疵点（**含距匹头米数**，裁剪排料要用）
 * 外加一张价目表：
 * - `grade_prices`        分等价目（品等 → 固定价 / 折扣 / 加减）
 *
 * 并给 `rolls` 加 `grade` / `inspected_at` / `last_inspection_id`：
 * 等级是**检验单定出来的**，但要冗余回写到匹上，
 * 出库选匹、追溯、打印标签都要直接读匹，不可能每次 join 检验单。
 */
export class QualityInspection1732600000000 implements MigrationInterface {
  name = 'QualityInspection1732600000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`defect_types\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`code\` varchar(32) NOT NULL COMMENT '疵点代码(公司内唯一)',
        \`name\` varchar(64) NOT NULL COMMENT '疵点名称(检验员看到的名字)',
        \`category\` enum('warp','weft','stain','broken','other') NOT NULL DEFAULT 'other' COMMENT '经向/纬向/污渍/破损/其他',
        \`penalty_mode\` enum('by_length','fixed') NOT NULL DEFAULT 'by_length' COMMENT '计分方式:按长度四档/固定分',
        \`fixed_penalty\` int NOT NULL DEFAULT 4 COMMENT '固定扣分(仅fixed生效,上限由shared控制)',
        \`sort_order\` int NOT NULL DEFAULT 0 COMMENT '检验台排序',
        \`enabled\` tinyint(1) NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_defect_types_code\` (\`company_id\`,\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='疵点类型'
    `)

    await queryRunner.query(`
      CREATE TABLE \`inspections\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`inspection_no\` varchar(32) NOT NULL COMMENT '检验单号(公司内唯一)',
        \`batch_id\` char(36) DEFAULT NULL COMMENT '被检批次(散匹检验可空)',
        \`warehouse_id\` char(36) DEFAULT NULL,
        \`inspector_id\` char(36) NOT NULL COMMENT '检验人',
        \`inspected_at\` date NOT NULL,
        \`standard\` enum('four_point') NOT NULL DEFAULT 'four_point' COMMENT '检验标准',
        \`mode\` enum('full','sampling') NOT NULL DEFAULT 'full' COMMENT '全检/抽检',
        \`sample_rate\` decimal(5,2) DEFAULT NULL COMMENT '抽检比例(%)',
        \`grade_rule_snapshot\` json DEFAULT NULL COMMENT '定等规则快照(规则改了也能复核历史单)',
        \`status\` enum('draft','done','void') NOT NULL DEFAULT 'draft',
        \`roll_count\` int NOT NULL DEFAULT 0 COMMENT '匹数(冗余,列表不join明细)',
        \`total_points\` int NOT NULL DEFAULT 0,
        \`total_sq_yd\` decimal(14,4) NOT NULL DEFAULT 0 COMMENT '总面积(平方码)',
        \`avg_penalty_density\` decimal(10,4) NOT NULL DEFAULT 0 COMMENT '按总面积加权,非各匹算术平均',
        \`pass_rate\` decimal(5,2) DEFAULT NULL COMMENT '合格率(%):未超收货红线的匹占比',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_inspections_no\` (\`company_id\`,\`inspection_no\`),
        KEY \`idx_inspections_batch\` (\`company_id\`,\`batch_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='检验单(验布单)'
    `)

    await queryRunner.query(`
      CREATE TABLE \`inspection_rolls\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`inspection_id\` char(36) NOT NULL,
        \`roll_id\` char(36) NOT NULL,
        \`roll_no\` varchar(64) NOT NULL COMMENT '件卡号(冗余)',
        \`meters\` decimal(14,3) NOT NULL COMMENT '实测匹长(与件卡登记值可不同:短匹/回缩)',
        \`width_inch\` decimal(8,2) NOT NULL COMMENT '实测门幅(英寸)',
        \`sq_yards\` decimal(14,4) NOT NULL COMMENT '面积(平方码)冗余存,便于复核',
        \`total_points\` int NOT NULL DEFAULT 0,
        \`penalty_density\` decimal(10,4) NOT NULL COMMENT '扣分密度',
        \`over_receiving_limit\` tinyint(1) NOT NULL DEFAULT 0 COMMENT '超收货红线(>4分/100平方码)',
        \`grade\` enum('A','B','C','D') DEFAULT NULL COMMENT '定等结果',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_inspection_rolls_uniq\` (\`inspection_id\`,\`roll_id\`),
        KEY \`idx_inspection_rolls_insp\` (\`company_id\`,\`inspection_id\`),
        KEY \`idx_inspection_rolls_roll\` (\`company_id\`,\`roll_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='检验单-匹明细'
    `)

    await queryRunner.query(`
      CREATE TABLE \`inspection_defects\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`inspection_roll_id\` char(36) NOT NULL,
        \`defect_type_id\` char(36) NOT NULL,
        \`defect_code\` varchar(32) NOT NULL COMMENT '疵点代码(冗余)',
        \`position_m\` decimal(10,3) DEFAULT NULL COMMENT '距匹头米数(裁剪排料要避开)',
        \`length_inch\` decimal(8,2) DEFAULT NULL COMMENT '疵点长度(英寸)',
        \`penalty\` int NOT NULL COMMENT '当时扣分(快照,规则变也不改历史)',
        \`photo_id\` char(36) DEFAULT NULL COMMENT '疵点照片(附件模块)',
        \`remark\` varchar(255) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_inspection_defects_roll\` (\`inspection_roll_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='疵点记录(逐条)'
    `)

    await queryRunner.query(`
      CREATE TABLE \`grade_prices\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`scope\` enum('contract_item','spec') NOT NULL COMMENT '挂合同明细/挂规格挂牌',
        \`ref_id\` char(36) NOT NULL COMMENT 'contract_item.id 或 greige_spec.id',
        \`grade\` enum('A','B','C','D') NOT NULL,
        \`mode\` enum('fixed','discount','delta') NOT NULL COMMENT '固定价/折扣率/加减金额',
        \`value\` decimal(14,4) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_grade_prices_uniq\` (\`scope\`,\`ref_id\`,\`grade\`),
        KEY \`idx_grade_prices_ref\` (\`company_id\`,\`scope\`,\`ref_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分等价目'
    `)

    await queryRunner.query(`
      ALTER TABLE \`rolls\`
        ADD COLUMN \`grade\` enum('A','B','C','D') DEFAULT NULL COMMENT '品等(由检验单定等后回写;未检验为空)' AFTER \`status\`,
        ADD COLUMN \`inspected_at\` datetime DEFAULT NULL COMMENT '最近定等时间' AFTER \`grade\`,
        ADD COLUMN \`last_inspection_id\` char(36) DEFAULT NULL COMMENT '最近定等的检验单(作废时据此回退)' AFTER \`inspected_at\`
    `)
    await queryRunner.query(`
      CREATE INDEX \`idx_rolls_grade\` ON \`rolls\` (\`company_id\`,\`grade\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `idx_rolls_grade` ON `rolls`')
    await queryRunner.query(`
      ALTER TABLE \`rolls\`
        DROP COLUMN \`grade\`,
        DROP COLUMN \`inspected_at\`,
        DROP COLUMN \`last_inspection_id\`
    `)
    await queryRunner.query('DROP TABLE IF EXISTS `grade_prices`')
    await queryRunner.query('DROP TABLE IF EXISTS `inspection_defects`')
    await queryRunner.query('DROP TABLE IF EXISTS `inspection_rolls`')
    await queryRunner.query('DROP TABLE IF EXISTS `inspections`')
    await queryRunner.query('DROP TABLE IF EXISTS `defect_types`')
  }
}
