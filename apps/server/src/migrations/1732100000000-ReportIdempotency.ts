import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 报工幂等键（防重复计量）
 *
 * 问题：报工是**车间高频写操作**，且经常在网络不稳的现场发生。原来的接口每调一次就
 * 记一次产量，于是「超时后重试」「手快双击」「Electron 重连补发」都会**重复计量**——
 * 产量虚高、件卡翻倍、成本跟着错。这类脏数据很难事后纠正。
 *
 * 方案：客户端为每次报工生成唯一 `clientRequestId`（重试时**复用同一个 id**），
 * 服务端按 `(company_id, client_request_id)` 唯一：重复提交直接返回首次结果，
 * 不再重复计量。
 *
 * 唯一键含company_id：多公司/多租户下不同公司可用同一个 id。
 */
export class ReportIdempotency1732100000000 implements MigrationInterface {
  name = 'ReportIdempotency1732100000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`production_reports\`
        ADD COLUMN \`client_request_id\` varchar(64) DEFAULT NULL
          COMMENT '客户端幂等键(重试复用同值,防重复计量)' AFTER \`id\`
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX \`uq_prod_reports_client_req\`
        ON \`production_reports\` (\`company_id\`, \`client_request_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `uq_prod_reports_client_req` ON `production_reports`')
    await queryRunner.query(`
      ALTER TABLE \`production_reports\` DROP COLUMN \`client_request_id\`
    `)
  }
}