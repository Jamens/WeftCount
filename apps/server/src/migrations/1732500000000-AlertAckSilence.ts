import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 预警确认静默期可配置（按公司）
 *
 * 原先是硬编码 7 天。不同厂子的处理节奏差别很大：织造厂每天报工、仓管当天处理，
 * 7 天合适；而某些小厂一周只盘一次货，7 天静默会把真实问题压太久。
 * 故按公司存��可配。
 *
 * 存`companies` 表而非新建 settings 表：目前只有这一个参数，
 * 为它单造一套键值配置框架是过度设计；等参数超过三个再抽表。
 */
export class AlertAckSilence1732500000000 implements MigrationInterface {
  name = 'AlertAckSilence1732500000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`companies\`
        ADD COLUMN \`alert_ack_silence_days\` int NOT NULL DEFAULT 7
          COMMENT '预警确认后静默天数(按公司,0=不静默)'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`companies\` DROP COLUMN \`alert_ack_silence_days\`
    `)
  }
}