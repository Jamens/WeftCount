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
import type { ContractStatus } from './entities/contract.entity'

export class ContractItemInput {
  @IsString() @IsNotEmpty({ message: '请选择物料' })
  materialId!: string

  @IsString() @IsNotEmpty({ message: '请选择规格' })
  specId!: string

  /** 协议单价（元/米） */
  @IsNumber({}, { message: '协议单价必须为数字' })
  @Min(0.0001, { message: '协议单价必须大于 0' })
  agreedPrice!: number

  /** 协议数量（米） */
  @IsNumber({}, { message: '协议数量必须为数字' })
  @Min(0.001, { message: '协议数量必须大于 0' })
  agreedQuantityM!: number

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

export class CreateContractDto {
  @IsEnum(['purchase', 'sales'], { message: '合同类型必须是 purchase 或 sales' })
  contractType!: 'purchase' | 'sales'

  @IsString() @IsNotEmpty({ message: '请选择往来单位' })
  partnerId!: string

  @IsArray() @ArrayMinSize(1, { message: '至少一条明细行' })
  @ValidateNested({ each: true }) @Type(() => ContractItemInput)
  items!: ContractItemInput[]

  @IsOptional() @IsDateString({}, { message: '开始日期格式应为 YYYY-MM-DD' })
  startDate?: string | null

  @IsOptional() @IsDateString({}, { message: '结束日期格式应为 YYYY-MM-DD' })
  endDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

/** 更新草稿合同：可整体替换明细行 */
export class UpdateContractDto {
  @IsOptional() @IsArray() @ArrayMinSize(1, { message: '至少一条明细行' })
  @ValidateNested({ each: true }) @Type(() => ContractItemInput)
  items?: ContractItemInput[]

  @IsOptional() @IsDateString()
  startDate?: string | null

  @IsOptional() @IsDateString()
  endDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

export class ContractFilterDto {
  @IsOptional() @IsEnum(['purchase', 'sales'])
  contractType?: 'purchase' | 'sales'

  @IsOptional() @IsEnum(['draft', 'active', 'completed', 'cancelled'])
  status?: ContractStatus

  @IsOptional() @IsString()
  partnerId?: string

  @IsOptional() @IsString()
  keyword?: string
}
