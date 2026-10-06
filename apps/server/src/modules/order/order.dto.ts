import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'
import type { TradeOrderType } from './entities/trade-order.entity'

export class CreateOrderDto {
  @IsEnum(['purchase', 'sales'], { message: '订单类型必须是 purchase 或 sales' })
  orderType!: TradeOrderType

  /** 采购=供应商，销售=客户，服务端按 orderType 校验 */
  @IsString() @IsNotEmpty({ message: '请选择往来单位' })
  partnerId!: string

  @IsString() @IsNotEmpty({ message: '请选择物料' })
  materialId!: string

  @IsString() @IsNotEmpty({ message: '请选择坯布规格' })
  specId!: string

  /** 录入单位：采购多按 kg，销售多按 m2 */
  @IsString() @IsNotEmpty() @MaxLength(8)
  orderedUnit!: string

  @IsNumber({}, { message: '数量必须为数字' })
  @Min(0.0001, { message: '数量必须大于 0' })
  orderedValue!: number

  @IsOptional() @IsNumber() @Min(0)
  unitPrice?: number | null

  @IsOptional() @IsDateString({}, { message: '交期格式应为 YYYY-MM-DD' })
  expectedDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

/** 仅草稿可改；orderType 建后不可变，故不在更新里 */
export class UpdateOrderDto {
  @IsOptional() @IsString() @IsNotEmpty()
  partnerId?: string

  @IsOptional() @IsString() @IsNotEmpty()
  materialId?: string

  @IsOptional() @IsString() @IsNotEmpty()
  specId?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(8)
  orderedUnit?: string

  @IsOptional() @IsNumber() @Min(0.0001, { message: '数量必须大于 0' })
  orderedValue?: number

  @IsOptional() @IsNumber() @Min(0)
  unitPrice?: number | null

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
