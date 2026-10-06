import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 拆匹发货（一匹可分多次出库）
 *
 * 背景：原先件卡是**原子**的——`meters` 即全部、`status` 三态、`outbound_doc_id` 一对一，
 * 只能整匹发货。真实场景有「卖尾布/零头」：70m 的匹卖 30m，剩 40m 继续在库。
 *
 * 本迁移：
 *  1) `rolls` 加 `remaining_m` / `remaining_kg`（剩余量，**新不变式**：
 *     Σ批内所有件卡 remaining_m == batch.remaining_quantity）
 *  2) 新建 `roll_outbounds` 关联表（roll_id + doc_id + 数量），一匹可对应多个出库单；
 *     原 `outbound_doc_id` 表达不了「一匹多单」。
 *  3) **历史数据保全**：把原 `outbound_doc_id` 非空的件卡转成关联行（meters=该匹全量），
 *     并把 remaining_m 置 0、status 置 sold——使新旧追溯等价，不丢历史链路。
 */
export class RollSplitOutbound1731900000000 implements MigrationInterface {
  name = 'RollSplitOutbound1731900000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 剩余量列
    await queryRunner.query(`
      ALTER TABLE \`rolls\`
        ADD COLUMN \`remaining_m\` decimal(14,3) DEFAULT NULL COMMENT '剩余米数(拆匹后递减,0=已发完)' AFTER \`meters\`,
        ADD COLUMN \`remaining_kg\` decimal(14,3) DEFAULT NULL COMMENT '剩余重量(kg)' AFTER \`weight_kg\`
    `)
    // 2) 关联表
    await queryRunner.query(`
      CREATE TABLE \`roll_outbounds\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`roll_id\` char(36) NOT NULL COMMENT '件卡',
        \`doc_id\` char(36) NOT NULL COMMENT '出库单(发货/领用)',
        \`meters\` decimal(14,3) NOT NULL COMMENT '本次出库米数',
        \`weight_kg\` decimal(14,3) DEFAULT NULL,
        \`area_m2\` decimal(14,3) DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_roll_outbounds_roll\` (\`company_id\`,\`roll_id\`),
        KEY \`idx_roll_outbounds_doc\` (\`company_id\`,\`doc_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='件卡出库流水(一匹可多次)'
    `)
    // 3) 历史保全：已发货件卡 → remaining 0 + sold + 写关联行
    await queryRunner.query(`
      UPDATE \`rolls\` SET \`remaining_m\` = \`meters\`, \`remaining_kg\` = \`weight_kg\`
    `)
    await queryRunner.query(`
      INSERT INTO \`roll_outbounds\`
        (\`id\`, \`tenant_id\`, \`company_id\`, \`roll_id\`, \`doc_id\`, \`meters\`, \`weight_kg\`, \`created_at\`)
      SELECT
        UUID(), r.\`tenant_id\`, r.\`company_id\`, r.\`id\`, r.\`outbound_doc_id\`, r.\`meters\`, r.\`weight_kg\`, r.\`created_at\`
      FROM \`rolls\` r
      WHERE r.\`outbound_doc_id\` IS NOT NULL AND r.\`status\` IN ('sold','consumed')
    `)
    await queryRunner.query(`
      UPDATE \`rolls\` SET \`remaining_m\` = 0, \`remaining_kg\` = 0
      WHERE \`outbound_doc_id\` IS NOT NULL AND \`status\` IN ('sold','consumed')
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 还原：多单出库无法还原为单 outbound_doc_id，保留最后一次（取最大 created_at）
    await queryRunner.query(`
      UPDATE \`rolls\` r
      LEFT JOIN (
        SELECT \`roll_id\`, MAX(\`doc_id\`) AS \`doc_id\`
        FROM \`roll_outbounds\` GROUP BY \`roll_id\`
      ) x ON x.\`roll_id\` = r.\`id\`
      SET r.\`outbound_doc_id\` = x.\`doc_id\`
    `)
    await queryRunner.query(`
      UPDATE \`rolls\` SET \`remaining_m\` = \`meters\`, \`remaining_kg\` = \`weight_kg\`
    `)
    await queryRunner.query('DROP TABLE IF EXISTS `roll_outbounds`')
    await queryRunner.query(`
      ALTER TABLE \`rolls\`
        DROP COLUMN \`remaining_m\`,
        DROP COLUMN \`remaining_kg\`
    `)
  }
}
