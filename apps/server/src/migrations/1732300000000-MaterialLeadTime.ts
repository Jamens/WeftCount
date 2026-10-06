import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 物料加采购提前期/采购周期（补货建议用）
 *
 * 预警原先只能报「库存低于安全库存」，采购员还得自己判断该补多少。
 * 要算出**建议补货量**，必须知道采购的提前期与采购周期（天数）——
 * 否则补货点无从谈起（提前期内的消耗必须提前备货）。
 */
export class MaterialLeadTime1732300000000 implements MigrationInterface {
  name = 'MaterialLeadTime1732300000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`materials\`
        ADD COLUMN \`lead_time_days\` decimal(6,2) DEFAULT NULL
          COMMENT '采购提前期/采购周期(天),补货点计算用' AFTER \`safety_stock\`
    `)
    // 预警带结构化补货建议（建议量/补货点/日均用量/依据），不再只是一句话
    await queryRunner.query(`
      ALTER TABLE \`alerts\`
        ADD COLUMN \`data\` json DEFAULT NULL
          COMMENT '结构化附加数据(低库存预警带补货建议)'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`alerts\` DROP COLUMN \`data\`
    `)
    await queryRunner.query(`
      ALTER TABLE \`materials\` DROP COLUMN \`lead_time_days\`
    `)
  }
}