import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator'

/** 工资单状态 */
export type WageSlipStatus = 'draft' | 'confirmed' | 'paid'

export class CreateProfileDto {
  /** 关联 users.id（报工人即登录账号，须属于本公司） */
  @IsString({ message: 'userId 必须为字符串' })
  userId!: string

  /** 工种，如 挡车工 / 辅助工 / 班长 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  jobType?: string

  /** 底薪 / 固定补贴（元/周期），无底薪填 0 */
  @IsOptional()
  @IsNumber({}, { message: '底薪必须为数字' })
  @Min(0, { message: '底薪不能为负' })
  baseWage?: number

  /** 计件单价（元/米），须 > 0——0 单价的工人不如不建档案 */
  @IsNumber({}, { message: '计件单价必须为数字' })
  @IsPositive({ message: '计件单价必须大于 0' })
  unitPrice!: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  jobType?: string

  @IsOptional()
  @IsNumber({}, { message: '底薪必须为数字' })
  @Min(0, { message: '底薪不能为负' })
  baseWage?: number

  @IsOptional()
  @IsNumber({}, { message: '计件单价必须为数字' })
  @IsPositive({ message: '计件单价必须大于 0' })
  unitPrice?: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class ProfileFilterDto {
  @IsOptional() @IsString()
  jobType?: string
}

export class GenerateSlipsDto {
  /** 结算周期起（ISO 日期，如 2026-10-01） */
  @IsDateString({}, { message: 'periodStart 必须为 ISO 日期' })
  periodStart!: string

  /** 结算周期止（ISO 日期，含当日） */
  @IsDateString({}, { message: 'periodEnd 必须为 ISO 日期' })
  periodEnd!: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class SlipFilterDto {
  @IsOptional() @IsEnum(['draft', 'confirmed', 'paid'])
  status?: WageSlipStatus

  @IsOptional() @IsString()
  userId?: string

  @IsOptional() @IsDateString()
  periodStart?: string

  @IsOptional() @IsDateString()
  periodEnd?: string
}

export class UpdateSlipDto {
  /** 奖金（元），仅 draft 可改 */
  @IsOptional()
  @IsNumber({}, { message: '奖金必须为数字' })
  @Min(0, { message: '奖金不能为负' })
  bonus?: number

  /** 扣款（元），仅 draft 可改；停机扣款等规则各厂不同，一律显式给而不是按停机分钟自动扣 */
  @IsOptional()
  @IsNumber({}, { message: '扣款必须为数字' })
  @Min(0, { message: '扣款不能为负' })
  deduction?: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}
