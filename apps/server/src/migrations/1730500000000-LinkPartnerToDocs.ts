import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 单据关联往来单位
 *
 * 把 inventory_documents.counterparty（自由文本）升级为 partner_id 外键 +
 * partner_name 名称快照：
 *   - partner_id   关联 partners.id，采购入库=供应商，销售出库=客户
 *   - partner_name 开单时的单位名称快照，partner 改名不影响历史单据
 * 生产领用为内部转移，两者均置 null。
 * 原 counterparty 列一并删除，避免与 partner_id 形成两个真相来源。
 */
export class LinkPartnerToDocs1730500000000 implements MigrationInterface {
  name = 'LinkPartnerToDocs1730500000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        ADD COLUMN \`partner_id\` char(36) DEFAULT NULL COMMENT '往来单位(供应商/客户) id' AFTER \`total_amount\`,
        ADD COLUMN \`partner_name\` varchar(128) DEFAULT NULL COMMENT '往来单位名称快照' AFTER \`partner_id\`,
        ADD KEY \`idx_docs_partner\` (\`company_id\`,\`partner_id\`)
    `)
    // 老数据无 partner 关联，counterparty 仅是文本，直接丢弃（pre-prod，无历史包袱）
    await queryRunner.query('ALTER TABLE `inventory_documents` DROP COLUMN `counterparty`')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `inventory_documents` ADD COLUMN `counterparty` varchar(128) DEFAULT NULL')
    await queryRunner.query(
      'ALTER TABLE `inventory_documents` DROP KEY `idx_docs_partner`, DROP COLUMN `partner_id`, DROP COLUMN `partner_name`',
    )
  }
}
