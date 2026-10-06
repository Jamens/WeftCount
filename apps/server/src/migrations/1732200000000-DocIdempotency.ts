import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 单据幂等键（防重复出入库）
 *
 * 背景：桌面端要做**离线队列**（断网时暂存、恢复后重放）。但重放若没有幂等保护，
 * 会把同一笔出入库**重复执行**——重复扣库存、重复生成批次、重复记账，
 * 后果比报工重复计量更严重（库存直接错）。
 *
 * 方案与报工一致：客户端为一次单据生成唯一 `clientRequestId`，重放时复用同一个；
 * 服务端按 `(company_id, client_request_id)` 唯一去重，命中即返回首次的单据，
 * 不重复过账。
 */
export class DocIdempotency1732200000000 implements MigrationInterface {
  name = 'DocIdempotency1732200000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        ADD COLUMN \`client_request_id\` varchar(64) DEFAULT NULL
          COMMENT '客户端幂等键(重放复用同值,防重复出入库)' AFTER \`id\`
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX \`uq_inv_docs_client_req\`
        ON \`inventory_documents\` (\`company_id\`,\`client_request_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `uq_inv_docs_client_req` ON `inventory_documents`')
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\` DROP COLUMN \`client_request_id\`
    `)
  }
}