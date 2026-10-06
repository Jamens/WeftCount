import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { TradeOrderType } from './entities/trade-order.entity'

export class OrderItemInput {
  @IsString() @IsNotEmpty({ message: '请选择物料' })
  materialId!: string

  @IsString() @IsNotEmpty({ message: '请选择规格' })
  specId!: string

  /** 录入单位：采购多按 kg，销售多按 m2 */
  @IsString() @IsNotEmpty() @MaxLength(8)
  orderedUnit!: string

  @IsNumber({}, { message: '数量必须为数字' })
  @Min(0.0001, { message: '数量必须大于 0' })
  orderedValue!: number

  /** 单价（元/米），可空；从合同带出时为协议价 */
  @IsOptional() @IsNumber() @Min(0)
  unitPrice?: number | null

  /** 可选：来源合同行（按协议价成交） */
  @IsOptional() @IsString()
  contractItemId?: string | null
}

export class CreateOrderDto {
  @IsEnum(['purchase', 'sales'], { message: '订单类型必须是 purchase 或 sales' })
  orderType!: TradeOrderType

  /** 采购=供应商，销售=客户，服务端按 orderType 校验 */
  @IsString() @IsNotEmpty({ message: '请选择往来单位' })
  partnerId!: string

  @IsArray() @ArrayMinSize(1, { message: '至少一条明细行' })
  @ValidateNested({ each: true }) @Type(() => OrderItemInput)
  items!: OrderItemInput[]

  /** 可选：来源合同（从合同建单时关联） */
  @IsOptional() @IsString()
  contractId?: string | null

  @IsOptional() @IsDateString({}, { message: '交期格式应为 YYYY-MM-DD' })
  expectedDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

/** 仅草稿可改；orderType 建后不可变。传 items 则整体替换明细并重算汇总 */
export class UpdateOrderDto {
  @IsOptional() @IsString() @IsNotEmpty()
  partnerId?: string

  @IsOptional() @IsArray() @ArrayMinSize(1, { message: '至少一条明细行' })
  @ValidateNested({ each: true }) @Type(() => OrderItemInput)
  items?: OrderItemInput[]

  @IsOptional() @IsDateString({}, { message: '交期格式应为 YYYY-MM-DD' })
  expectedDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

export class OrderFilterDto {
  @IsOptional() @IsEnum(['purchase', 'sales'])
  orderType?: TradeOrderType

  @IsOptional() @IsEnum(['draft', 'confirmed', 'completed', 'cancelled'])
  status?: string

  @IsOptional() @IsString()
  partnerId?: string

  @IsOptional() @IsString()
  keyword?: string
}

/** 从补货预警一键生成采购订单：可覆盖供应商/交期/单价，其余从建议推导 */
export class CreateOrderFromAlertDto {
  /**
   * 指定规格（**服务端推断不出时必填**）
   *
   * 服务端会优先从该物料历史采购入库记录推断规格；像「首次采购的新物料」这类
   * 无历史的情况推断不出来，此时由调用方指定——**不给就明确报错，不猜**。
   */
  @IsOptional() @IsString()
  specId?: string | null

  @IsOptional() @IsString()
  partnerId?: string | null

  @IsOptional() @IsDateString({}, { message: '交期格式应为 YYYY-MM-DD' })
  expectedDate?: string | null

  @IsOptional() @IsNumber() @Min(0)
  unitPrice?: number | null
}
