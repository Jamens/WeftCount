import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 设备能耗（抄表 + 单位产量电耗）
 *
 * ## 现状
 * **README 此前写「能耗数据已在报工表里只差聚合」是错的**——报工只有 outputM / stoppageMinutes，
 * 全库没有任何 kWh 字段；`greige_spec.overhead_per_meter` 只是把电费摊进加工费的一个合计数，
 * 不可拆、也不可归因到机台。所以电耗得按真实口径建模，不能假装它已经在那儿。
 *
 * ## 真实口径是「电表抄表」
 * 织造厂电耗不来自挡车工估算（他不记电），而来自每台机/每车间独立电表**按期抄表**。
 * 因此本表存的是**累计表底读数**，不是用量：
 *
 * - `meter_no`（电表号）参与序列键：换表就开新表号，新表从 0 起算天然正确，
 *   不必给「读数回退」开例外——回退只可能是抄错或改表，直接拒绝。
 * - **用量 = 本期读数 − 同 (机台, 电表) 上期读数**，读时现算、**不落库**：
 *   落库会与「补录上期读数」失配（补录后历史期的差值变了，冗余列就成了脏数据）。
 * - 首条读数**只建基线不出量**（没有上期就没有用量），它不是「用量为 0 的那一天」。
 * - `tariff`（元/kWh）逐条记录当期电价，不用「当前电价回算历史」——电价分峰分季，
 *   用现价回算历史会凭空造出偏差。
 *
 * ## 聚合层（真正「只差聚合」的部分）
 * 单位产量电耗 = 期间总 kWh /（期间总产量米 ÷ 100），即 kWh/百米。
 * 三个易错点：
 * 1. **公司合计用总量算，不是各机台单耗的平均**——平均的平均会把高耗机台的异常摊平掉。
 * 2. **0 产量时单耗返回 null**，不返回 Infinity/NaN（除零的经典坑，前端会显示 "Infinity kWh"）。
 * 3. 产量口径取 `production_reports` 按报工日聚合，与工资、成本核算同源，不另设一套产量。
 *
 * ## 权限
 * 读 `cost.view`、写 `cost.manage`（与 /cost 同源）：会计录抄表与核算，厂长可读；
 * 仓管/工艺员无 cost 域进不来。能耗不是工资那种敏感凭据，只读访客可见可接受。
 */
export class MachineEnergy1733100000000 implements MigrationInterface {
  name = 'MachineEnergy1733100000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`machine_energy_readings\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`machine_id\` char(36) NOT NULL COMMENT '机台 id',
        \`meter_no\` varchar(32) NOT NULL COMMENT '电表编号;同机台可多块表(换表开新号)',
        \`reading_date\` date NOT NULL COMMENT '抄表日期',
        \`reading\` decimal(14,2) NOT NULL COMMENT '当期累计表底读数(kWh),非用量',
        \`tariff\` decimal(10,4) NOT NULL COMMENT '当期电价(元/kWh),逐条记不回算历史',
        \`remark\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_energy_reading_key\` (\`company_id\`, \`machine_id\`, \`meter_no\`, \`reading_date\`),
        KEY \`idx_energy_machine\` (\`company_id\`, \`machine_id\`),
        KEY \`idx_energy_date\` (\`company_id\`, \`reading_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`machine_energy_readings\``)
  }
}