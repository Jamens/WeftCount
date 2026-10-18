import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, ValidateNested } from 'class-validator'
import type { ReceiptMethod } from './entities/receipt.entity'

export class ReceiptApplicationDto {
  /** 被冲抵的销售出库单 id */
  @IsString()
  docId!: string

  /** 本笔收款冲抵该单的金额（元），须 > 0 */
  @IsNumber({}, { message: '核销金额必须为数字' })
  @Min(0.01, { message: '核销金额必须大于 0' })
  appliedAmount!: number
}

export class CreateReceiptDto {
  /** 客户 id（须为客户/兼营，且启用） */
  @IsString()
  partnerId!: string

  /** 收款日期（ISO 日期，如 2026-03-20） */
  @IsDateString()
  receiptDate!: string

  /** 实收金额（元），须 > 0 */
  @IsNumber({}, { message: '收款金额必须为数字' })
  @IsPositive({ message: '收款金额必须大于 0' })
  amount!: number

  /** 收款方式，默认银行 */
  @IsOptional()
  @IsEnum(['cash', 'bank', 'acceptance', 'other'])
  method?: ReceiptMethod

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null

  /** 核销分配：每条冲抵一张出库单；各条 appliedAmount 之和须等于 amount */
  @IsArray()
  @ValidateNested({ each: true })
  applications!: ReceiptApplicationDto[]
}

export class ReceiptFilterDto {
  @IsOptional() @IsString()
  partnerId?: string

  @IsOptional() @IsDateString()
  from?: string

  @IsOptional() @IsDateString()
  to?: string

  @IsOptional() @IsNumber()
  page?: number = 1

  @IsOptional() @IsNumber()
  pageSize?: number = 20
}

export class LedgerQueryDto {
  @IsOptional() @IsString()
  partnerId?: string
}

export class AgingQueryDto {
  @IsOptional() @IsString()
  partnerId?: string
}

export class StatementQueryDto {
  /** 对账单必须指定客户 */
  @IsString()
  partnerId!: string

  @IsOptional() @IsDateString()
  from?: string

  @IsOptional() @IsDateString()
  to?: string
}
