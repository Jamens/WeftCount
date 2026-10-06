import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 坯布规格加「加工费（元/米）」
 *
 * 制造成本 = 纱线成本 + 加工费。加工费按规格配置（不同织物工序/工时不同），
 * 是可核算成本项，与工艺参数(系数)无关。默认 0。
 */
export class AddSpecOverhead1730900000000 implements MigrationInterface {
  name = 'AddSpecOverhead1730900000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`greige_specs\`
        ADD COLUMN \`overhead_cost_per_meter\` decimal(10,4) NOT NULL DEFAULT 0 COMMENT '加工费(元/米)'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `greige_specs` DROP COLUMN `overhead_cost_per_meter`')
  }
}
