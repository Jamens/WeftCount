import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 销售出库按品等计价：落价格快照
 *
 * ## 为什么必须快照，而不能事后重算
 * 单价可以从件卡等级重算，但**件卡等级是会变的**——复验后 `rolls.grade` 会被覆盖。
 * 不存快照，三个月后这单为什么是这个价就说不清了，客户对账时无法自证。
 * 所以定这一单的当口，把「基准价 + 加权价 + 各等级明细」一并冻结。
 *
 * 内容形如：
 * ```json
 * {
 *   "source": "contract_item",
 *   "basePrice": 12.5,
 *   "weightedPrice": 11.93,
 *   "breakdown": [{ "grade": "A", "meters": 60, "price": 12.5 },
 *                 { "grade": "B", "meters": 40, "price": 11.5 }]
 * }
 * ```
 */
export class SalesOutboundGradePrice1732700000000 implements MigrationInterface {
  name = 'SalesOutboundGradePrice1732700000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        ADD COLUMN \`price_snapshot\` json DEFAULT NULL COMMENT '分等计价快照(基准价/加权价/各品等明细),等级会因复验变故此单必须冻结'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        DROP COLUMN \`price_snapshot\`
    `)
  }
}
