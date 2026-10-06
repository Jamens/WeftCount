import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 系数自学习：规格加「实测校准系数」
 *
 * learned_loss_factor = 领用当量米数 / 报工产出米数（实际耗纱比设计多出的倍数）。
 * 算快照时按 (1+设计损耗)×factor−1 折成有效损耗率，不改设计基准、避免反复学习漂移。
 */
export class SpecLearnedLoss1731500000000 implements MigrationInterface {
  name = 'SpecLearnedLoss1731500000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `greige_specs` ' +
        'ADD COLUMN `learned_loss_factor` decimal(6,4) DEFAULT NULL COMMENT ' +
        "'实测校准系数(领用米/报工米),算快照时折算有效损耗' AFTER `weft_loss_rate`" +
        ', ADD COLUMN `learned_at` datetime DEFAULT NULL COMMENT ' +
        "'系数最近学习时间' AFTER `learned_loss_factor`" +
        ', ADD COLUMN `learned_sample_size` int DEFAULT NULL COMMENT ' +
        "'学习时样本笔数' AFTER `learned_at`",
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `greige_specs` DROP COLUMN `learned_sample_size`, DROP COLUMN `learned_at`, DROP COLUMN `learned_loss_factor`',
    )
  }
}
