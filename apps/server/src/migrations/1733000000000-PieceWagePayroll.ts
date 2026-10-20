import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 计件工资（PieceWagePayroll）
 *
 * ## 现状
 * 挡车工报工数据完备（`production_reports.outputM` / `stoppageMinutes`、报工人 = 登录用户
 * `operatorId = ctx.userId`），但到此为止——没人知道上个月刘挡车该拿多少钱。
 * 织造厂计件工资是常态：按产出米数 × 单价，加底薪/补贴。工资算不出 = 挡车工留不住。
 *
 * ## 三张表
 * 1. `wage_profiles`（计件档案）：按「系统用户」建档——报工人就是登录账号，
 *    不另建员工表（再建一张要把人员信息抄两遍，停用/离职状态两处漂移）。
 *    单价 `unit_price`（元/米）+ 底薪 `base_wage`，姓名 `real_name` 冗余快照（历史单可追溯）。
 * 2. `wage_slips`（工资单）：一个工人在一个结算周期一张单。表头合计全部由明细累加，
 *    前端传不了金额。唯一键 (company_id, user_id, period_start, period_end) 防重复生成。
 * 3. `wage_slip_items`（计件明细）：按工单聚合（不逐条贴报工——一张单贴几十条没人看），
 *    amount = 该工单产出米数 × 本人单价；逐条可追溯性靠 (order_id + 周期) 反查报工表保住。
 *
 * ## 状态推进
 * draft → confirmed（核算确认，锁明细）→ paid（发放，记 paid_at）。
 * draft 可删（连同明细），confirmed / paid 不可删——资金凭据不留「删了又生成的洞账」。
 *
 * ## 权限
 * 读写全部 `cost.manage`：会计（cost.*）核算、厂长（cost.*）审批发放。
 * 挡车工持 production.report/self.view 不可见自己工资单（发放前保密是常态）；
 * 访客 `*.view` 通配不命中非 .view 后缀码（与应收 `report.sales` 同一匹配机制）。
 */
export class PieceWagePayroll1733000000000 implements MigrationInterface {
  name = 'PieceWagePayroll1733000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`wage_profiles\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`user_id\` char(36) NOT NULL COMMENT '关联 users.id,报工人即登录账号',
        \`real_name\` varchar(64) NOT NULL COMMENT '姓名快照(建档案时冗余,改名不影响历史)',
        \`job_type\` varchar(32) NOT NULL DEFAULT '挡车工' COMMENT '工种',
        \`base_wage\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '底薪/固定补贴(元/周期)',
        \`unit_price\` decimal(12,4) NOT NULL DEFAULT '0.0000' COMMENT '计件单价(元/米)',
        \`remark\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_profiles_user_company\` (\`user_id\`, \`company_id\`),
        KEY \`idx_profiles_company\` (\`company_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`wage_slips\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`slip_no\` varchar(32) NOT NULL COMMENT '工资单号 GZ+日期+4位序',
        \`user_id\` char(36) NOT NULL,
        \`real_name\` varchar(64) NOT NULL COMMENT '姓名快照',
        \`period_start\` date NOT NULL COMMENT '结算周期起',
        \`period_end\` date NOT NULL COMMENT '结算周期止',
        \`total_output_m\` decimal(14,3) NOT NULL DEFAULT '0.000' COMMENT '周期产出合计(米)',
        \`report_count\` int NOT NULL DEFAULT 0 COMMENT '报工次数',
        \`stoppage_min\` int NOT NULL DEFAULT 0 COMMENT '停机分钟合计',
        \`base_amount\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '底薪快照(建单时取档案)',
        \`piece_amount\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '计件额=Σ明细amount',
        \`bonus\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '奖金(确认前draft可改)',
        \`deduction\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '扣款(确认前draft可改)',
        \`net_amount\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '实发=底薪+计件+奖-扣',
        \`status\` enum('draft','confirmed','paid') NOT NULL DEFAULT 'draft' COMMENT '草稿/已确认/已发放',
        \`paid_at\` datetime(6) NULL COMMENT '发放时间',
        \`remark\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_slips_no_company\` (\`slip_no\`, \`company_id\`),
        UNIQUE KEY \`idx_slips_user_period\` (\`company_id\`, \`user_id\`, \`period_start\`, \`period_end\`),
        KEY \`idx_slips_company\` (\`company_id\`),
        KEY \`idx_slips_user\` (\`company_id\`, \`user_id\`),
        KEY \`idx_slips_period\` (\`company_id\`, \`period_start\`, \`period_end\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`wage_slip_items\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`slip_id\` char(36) NOT NULL COMMENT '关联 wage_slips.id',
        \`order_id\` char(36) NOT NULL COMMENT '关联生产工单,按工单聚合',
        \`order_no\` varchar(32) NOT NULL COMMENT '工单号快照',
        \`machine_id\` char(36) NOT NULL COMMENT '机台快照(冗余,避免查生产库)',
        \`machine_name\` varchar(128) NOT NULL COMMENT '机台名快照',
        \`output_m\` decimal(14,3) NOT NULL DEFAULT '0.000' COMMENT '该工单元产出(米)',
        \`report_count\` int NOT NULL DEFAULT 0 COMMENT '报工次数',
        \`amount\` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '计件额=该行米数×单价',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_slip_items_slip\` (\`slip_id\`),
        KEY \`idx_slip_items_company\` (\`company_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`wage_slip_items\``)
    await queryRunner.query(`DROP TABLE \`wage_slips\``)
    await queryRunner.query(`DROP TABLE \`wage_profiles\``)
  }
}
