import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateReadingDto {
  /** 机台 id（须为本公司机台） */
  @IsString({ message: 'machineId 必须为字符串' })
  machineId!: string

  /** 电表编号；换表开新号（读数可从 0 起算） */
  @IsString({ message: '电表号必须为字符串' })
  @MaxLength(32)
  meterNo!: string

  /** 抄表日期（ISO 日期） */
  @IsDateString({}, { message: 'readingDate 必须为 ISO 日期' })
  readingDate!: string

  /** 当期累计表底读数（kWh），不是用量 */
  @IsNumber({}, { message: '读数必须为数字' })
  @Min(0, { message: '读数不能为负' })
  reading!: number

  /** 当期电价（元/kWh），必须 > 0——0 电价算出的电费是假的 */
  @IsNumber({}, { message: '电价必须为数字' })
  @Min(0.0001, { message: '电价必须大于 0' })
  tariff!: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

/**
 * 改抄表记录
 *
 * 只开放 tariff / remark：读数与抄表日是**序列键的一部分**，
 * 改它们等于把一条记录换成另一条（还会改变后续记录的用量差值），
 * 抄错了只能删掉重录——单据不可编辑，与报工单同一惯例。
 */
export class UpdateReadingDto {
  @IsOptional()
  @IsNumber({}, { message: '电价必须为数字' })
  @Min(0.0001, { message: '电价必须大于 0' })
  tariff?: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class ReadingFilterDto {
  @IsOptional() @IsString()
  machineId?: string

  @IsOptional() @IsString()
  meterNo?: string

  @IsOptional() @IsDateString()
  from?: string

  @IsOptional() @IsDateString()
  to?: string
}

export class StatsQueryDto {
  /** 统计期间起（ISO 日期） */
  @IsDateString({}, { message: 'periodStart 必须为 ISO 日期' })
  periodStart!: string

  /** 统计期间止（ISO 日期，含当日） */
  @IsDateString({}, { message: 'periodEnd 必须为 ISO 日期' })
  periodEnd!: string
}