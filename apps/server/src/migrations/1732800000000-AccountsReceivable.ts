import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 应收账款 / 客户对账
 *
 * ## 应收从哪来
 * 销售出库单（`inventory_documents` 中 `sales_outbound`）每一张就是一张应收 invoice，
 * 字段 `totalAmount` 是应收总额。此前它只是个金额，没有「收了多少、还欠多少、哪天到期」。
 *
 * ## 这次落的三类东西
 * 1. `inventory_documents` 加 `settled_amount`（已核销额）+ `due_date`（到期日）。
 *    核销时按明细累加 `settled_amount`，等于 `totalAmount` 即结清；`due_date` 建单时按客户账期推算。
 * 2. `partners` 加 `credit_days`（信用账期），是 `due_date` 的推算基准；现金客户填 0。
 * 3. 新建 `receipts`（收款单）+ `receipt_applications`（核销明细）。核销在一个事务里
 *    写收款单、写每一条核销、并回写对应出库单的 `settled_amount`——三者必须同时成立或同时不成立。
 *
 * ## 为什么核销是「回写单据」而不是「另起一本应收账」
 * 应收的源头就是出库单，金额/客户/品名都在那张单上。另建一张应收表就要把这些信息再抄一遍，
 * 抄错抄漏都会让对账对不上。直接让出库单记「已收多少」，台账/账龄/对账单都是对它的派生查询，
 * 单一事实源，不会漂移。
 */
export class AccountsReceivable1732800000000 implements MigrationInterface {
  name = 'AccountsReceivable1732800000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`partners\`
        ADD COLUMN \`credit_days\` int NULL COMMENT '信用账期(天),推算销售出库到期日;现金客户填0'
    `)

    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        ADD COLUMN \`settled_amount\` decimal(16,2) NOT NULL DEFAULT '0.00' COMMENT '已核销金额(元),仅销售出库有意义',
        ADD COLUMN \`due_date\` date NULL COMMENT '到期日,账龄分析基准;采购/领用为NULL'
    `)

    await queryRunner.query(`
      CREATE TABLE \`receipts\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`receipt_no\` varchar(32) NOT NULL,
        \`partner_id\` char(36) NOT NULL,
        \`partner_name\` varchar(128) NOT NULL,
        \`receipt_date\` date NOT NULL,
        \`amount\` decimal(16,2) NOT NULL,
        \`method\` enum('cash','bank','acceptance','other') NOT NULL DEFAULT 'bank' COMMENT '收款方式:现金/银行/承兑/其他',
        \`remark\` varchar(255) NULL,
        \`operator_id\` char(36) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_receipts_no_company\` (\`receipt_no\`, \`company_id\`),
        KEY \`idx_receipts_company\` (\`company_id\`),
        KEY \`idx_receipts_partner\` (\`company_id\`, \`partner_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`receipt_applications\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`company_id\` char(36) NOT NULL,
        \`receipt_id\` char(36) NOT NULL,
        \`doc_id\` char(36) NOT NULL COMMENT '被核销的销售出库单 inventory_documents.id',
        \`applied_amount\` decimal(16,2) NOT NULL COMMENT '本笔收款冲抵该单的金额',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_app_receipt\` (\`receipt_id\`),
        KEY \`idx_app_doc\` (\`company_id\`, \`doc_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`receipt_applications\``)
    await queryRunner.query(`DROP TABLE \`receipts\``)
    await queryRunner.query(`
      ALTER TABLE \`inventory_documents\`
        DROP COLUMN \`due_date\`,
        DROP COLUMN \`settled_amount\`
    `)
    await queryRunner.query(`ALTER TABLE \`partners\` DROP COLUMN \`credit_days\``)
  }
}
