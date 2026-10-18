import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 设备维保
 *
 * ## 现状
 * `machines` 只有主数据 CRUD（编码/名称/型号/状态），没有保养计划、维保执行、故障停机、备件。
 * 织造厂的机台是典型的「买得起养不起」资产：电费占织造成本 25~40%，停机一小时就是真金白银，
 * 所以保养计划 + 故障统计（MTBF/MTTR）对排产与成本都直接有意义。
 *
 * ## 这次落的四类东西
 * 1. `machines` 加 `last_maintenance_date`（最近一次维保日期），机台主数据可直接看到保养状态。
 * 2. `maintenance_plans`（保养计划）：每台的周期性保养任务（巡检/润滑/维修/大修），按「天」或
 *    「运转小时」循环，推算 `next_due_date`；执行后回写 `last_done_date` 并顺延 `next_due_date`。
 * 3. `maintenance_records`（维保执行 / 故障停机）：一条记录对应一次保养或一次故障，故障带停机时长，
 *    是 MTBF 的口径来源。写记录在一个事务里：扣减备件库存 + 回写计划 / 机台的最近维保日期。
 * 4. `spare_parts`（备件）+ `maintenance_spare_parts`（备件耗用）：备件库存与低库存预警，
 *    维保记录可挂多个耗用备件，耗用即出库（减库存）。
 *
 * ## 权限
 * 读复用 `production.view`，写复用 `production.order.edit`（机台是生产资源，保养是生产动作；
 * 厂长/工艺员持 `production.*`、仓管持 `production.view`，无需新增权限码，也不触发角色重播）。
 */
export class MachineMaintenance1732900000000 implements MigrationInterface {
  name = 'MachineMaintenance1732900000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`machines\`
        ADD COLUMN \`last_maintenance_date\` date NULL COMMENT '最近一次维保日期,由 maintenance_records 回写'
    `)

    await queryRunner.query(`
      CREATE TABLE \`maintenance_plans\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`plan_no\` varchar(32) NOT NULL,
        \`machine_id\` char(36) NOT NULL,
        \`plan_name\` varchar(128) NOT NULL,
        \`type\` enum('inspect','lubricate','repair','overhaul') NOT NULL DEFAULT 'inspect' COMMENT '保养类型:巡检/润滑/维修/大修',
        \`cycle_type\` enum('day','run_hour') NOT NULL DEFAULT 'day' COMMENT '循环依据:按天/按运转小时',
        \`cycle_value\` int NOT NULL DEFAULT 1 COMMENT '循环值:cycle_type=day 为天数,=run_hour 为运转小时',
        \`last_done_date\` date NULL COMMENT '上次执行日',
        \`next_due_date\` date NULL COMMENT '下次到期日,由 last_done_date+cycle_value 推算',
        \`responsible\` varchar(64) NULL COMMENT '责任人',
        \`status\` enum('active','paused') NOT NULL DEFAULT 'active' COMMENT '启用/暂停',
        \`remark\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_plans_no_company\` (\`plan_no\`, \`company_id\`),
        KEY \`idx_plans_company\` (\`company_id\`),
        KEY \`idx_plans_machine\` (\`company_id\`, \`machine_id\`),
        KEY \`idx_plans_due\` (\`company_id\`, \`next_due_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`maintenance_records\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`record_no\` varchar(32) NOT NULL,
        \`machine_id\` char(36) NOT NULL,
        \`plan_id\` char(36) NULL COMMENT '关联的保养计划,故障停机为NULL',
        \`type\` enum('planned','breakdown') NOT NULL DEFAULT 'planned' COMMENT '计划保养/故障停机',
        \`category\` varchar(128) NOT NULL COMMENT '保养项目或故障描述',
        \`date\` date NOT NULL COMMENT '执行日期',
        \`operator_id\` char(36) NULL,
        \`operator_name\` varchar(64) NULL COMMENT '操作人(冗余姓名,便于历史追溯)',
        \`duration_min\` int NULL COMMENT '作业时长(分钟)',
        \`downtime_min\` int NULL COMMENT '停机时长(分钟),仅故障停机有意义',
        \`cost\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '费用(元)',
        \`result\` enum('ok','pending','failed') NOT NULL DEFAULT 'ok' COMMENT '结果:正常/待跟进/失败',
        \`remark\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_records_no_company\` (\`record_no\`, \`company_id\`),
        KEY \`idx_records_company\` (\`company_id\`),
        KEY \`idx_records_machine\` (\`company_id\`, \`machine_id\`),
        KEY \`idx_records_plan\` (\`plan_id\`),
        KEY \`idx_records_date\` (\`company_id\`, \`date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`spare_parts\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`part_code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`spec\` varchar(128) NULL COMMENT '规格',
        \`unit\` varchar(16) NOT NULL DEFAULT '个' COMMENT '单位',
        \`stock\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '当前库存',
        \`min_stock\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '安全库存,低于即预警',
        \`location\` varchar(64) NULL COMMENT '存放位置',
        \`remark\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_parts_code_company\` (\`part_code\`, \`company_id\`),
        KEY \`idx_parts_company\` (\`company_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`maintenance_spare_parts\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`record_id\` char(36) NOT NULL COMMENT '关联 maintenance_records.id',
        \`part_id\` char(36) NOT NULL COMMENT '关联 spare_parts.id',
        \`qty\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '耗用数量',
        \`cost\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '耗用金额(元)',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_msp_record\` (\`record_id\`),
        KEY \`idx_msp_part\` (\`company_id\`, \`part_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`maintenance_spare_parts\``)
    await queryRunner.query(`DROP TABLE \`spare_parts\``)
    await queryRunner.query(`DROP TABLE \`maintenance_records\``)
    await queryRunner.query(`DROP TABLE \`maintenance_plans\``)
    await queryRunner.query(`ALTER TABLE \`machines\` DROP COLUMN \`last_maintenance_date\``)
  }
}
