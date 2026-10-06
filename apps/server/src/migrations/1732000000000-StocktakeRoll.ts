import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 盘点支持件卡逐匹核销
 *
 * 背景：盘点原为**纯批次级**（只填米数）。但拆匹发货后同一批次里混着
 * 「已发过的匹」与「在库残匹」，只知道总米数对不上，**无法指认是哪一匹丢失**。
 * 例：3 匹各 100m 发了一匹 30m → 账面 270m；实物少了一整匹，实盘 170m，
 * 只能记 100m 盘亏，但账上说不清缺的是哪一匹。
 *
 * 本迁移给盘点明细加 `roll_id`：非空=件卡级明细（按件卡核销，能定位到匹），
 * 为空=原有批次级明细（按米数核销）。两者并存，不破坏既有流程与历史数据。
 */
export class StocktakeRoll1732000000000 implements MigrationInterface {
  name = 'StocktakeRoll1732000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`stocktake_items\`
        ADD COLUMN \`roll_id\` char(36) DEFAULT NULL COMMENT '件卡(非空=件卡级盘点,可定位到匹)' AFTER \`batch_id\`,
        ADD COLUMN \`roll_no\` varchar(64) DEFAULT NULL COMMENT '件卡号(冗余,便于打印/核对)' AFTER \`roll_id\`
    `)
    await queryRunner.query(`
      CREATE INDEX \`idx_stocktake_items_roll\` ON \`stocktake_items\` (\`company_id\`,\`roll_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `idx_stocktake_items_roll` ON `stocktake_items`')
    await queryRunner.query(`
      ALTER TABLE \`stocktake_items\`
        DROP COLUMN \`roll_id\`,
        DROP COLUMN \`roll_no\`
    `)
  }
}