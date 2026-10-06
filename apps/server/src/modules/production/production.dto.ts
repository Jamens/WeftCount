import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 报工按匹：织机产出的一件布（件卡） */
export class ReportRollDto {
  @IsString() @IsNotEmpty({ message: '件卡号不能为空' })
  rollNo!: string

  @IsNumber({}, { message: '件卡米数必须为数字' })
  @Min(0.001, { message: '件卡米数必须大于 0' })
  meters!: number
}
import type { MachineStatus } from './entities/machine.entity'
import type { ProductionOrderStatus } from './entities/production-order.entity'

// ---------------------------------------------------------------------------
// 机台
// ---------------------------------------------------------------------------

export class CreateMachineDto {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsString() @IsNotEmpty({ message: '机台名称不能为空' }) @MaxLength(64)
  name!: string

  @IsOptional() @IsString() @MaxLength(64)
  model?: string

  @IsOptional() @IsEnum(['idle', 'running', 'maintenance', 'retired'])
  status?: MachineStatus

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

export class UpdateMachineDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64)
  name?: string

  @IsOptional() @IsString() @MaxLength(64)
  model?: string

  @IsOptional() @IsEnum(['idle', 'running', 'maintenance', 'retired'])
  status?: MachineStatus

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

// ---------------------------------------------------------------------------
// 生产工单
// ---------------------------------------------------------------------------

export class CreateProductionOrderDto {
  @IsString() @IsNotEmpty({ message: '请选择产出物料' })
  materialId!: string

  @IsString() @IsNotEmpty({ message: '请选择坯布规格' })
  specId!: string

  /** 计划产量（米） */
  @IsNumber({}, { message: '计划产量必须为数字' })
  @Min(0.001, { message: '计划产量必须大于 0' })
  plannedQuantityM!: number

  @IsOptional() @IsString()
  machineId?: string | null

  @IsOptional() @IsDateString({}, { message: '计划开始日期格式应为 YYYY-MM-DD' })
  plannedStartDate?: string | null

  @IsOptional() @IsDateString({}, { message: '交期格式应为 YYYY-MM-DD' })
  dueDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

/** 仅 draft/scheduled 可改；产出米不允许手填（只能报工累计） */
export class UpdateProductionOrderDto {
  @IsOptional() @IsString() @IsNotEmpty()
  specId?: string

  @IsOptional() @IsNumber() @Min(0.001, { message: '计划产量必须大于 0' })
  plannedQuantityM?: number

  @IsOptional() @IsString()
  machineId?: string | null

  @IsOptional() @IsDateString()
  plannedStartDate?: string | null

  @IsOptional() @IsDateString()
  dueDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

export class ProductionOrderFilterDto {
  @IsOptional() @IsEnum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'])
  status?: ProductionOrderStatus

  @IsOptional() @IsString()
  machineId?: string

  @IsOptional() @IsString()
  keyword?: string
}

// ---------------------------------------------------------------------------
// 报工
// ---------------------------------------------------------------------------

export class CreateReportDto {
  /**
   * 客户端幂等键（**可选**，强烈建议传）
   *
   * 为这次报工生成一个唯一值（uuid/时间戳+随机）；**重试时必须复用同一个值**，
   * 服务端据此去重，避免超时重试/双击造成重复计量（产量虚高、件卡翻倍）。
   */
  @IsOptional() @IsString() @MaxLength(64)
  clientRequestId?: string

  @IsNumber({}, { message: '产出必须为数字' })
  @Min(0.001, { message: '产出必须大于 0' })
  outputM!: number

  /** 报工按匹：织机产出逐匹登记（各匹米数之和应=outputM），自动生成件卡 */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReportRollDto)
  rolls?: ReportRollDto[] | null

  @IsOptional() @IsDateString({}, { message: '报工日期格式应为 YYYY-MM-DD' })
  reportDate?: string | null

  @IsOptional() @IsInt() @Min(0)
  stoppageMinutes?: number | null

  @IsOptional() @IsString() @MaxLength(255)
  stopReason?: string
}
