import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

// ---------- 保养计划 ----------

export class CreatePlanDto {
  /** 机台 id（须为本公司的机台） */
  @IsString()
  machineId!: string

  /** 计划名称，如「3 号织机周巡检」 */
  @IsString()
  @MaxLength(128)
  planName!: string

  @IsOptional()
  @IsEnum(['inspect', 'lubricate', 'repair', 'overhaul'])
  type?: 'inspect' | 'lubricate' | 'repair' | 'overhaul'

  /** 循环依据：day 按天 / run_hour 按运转小时 */
  @IsOptional()
  @IsEnum(['day', 'run_hour'])
  cycleType?: 'day' | 'run_hour'

  /** 循环值：cycle_type=day 为天数，=run_hour 为运转小时 */
  @IsOptional()
  @IsInt()
  @Min(1)
  cycleValue?: number

  /** 首次/上次执行日（YYYY-MM-DD），用于推算下次到期 */
  @IsOptional()
  @IsDateString()
  lastDoneDate?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(64)
  responsible?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  planName?: string

  @IsOptional()
  @IsEnum(['inspect', 'lubricate', 'repair', 'overhaul'])
  type?: 'inspect' | 'lubricate' | 'repair' | 'overhaul'

  @IsOptional()
  @IsEnum(['day', 'run_hour'])
  cycleType?: 'day' | 'run_hour'

  @IsOptional()
  @IsInt()
  @Min(1)
  cycleValue?: number

  @IsOptional()
  @IsDateString()
  lastDoneDate?: string | null

  @IsOptional()
  @IsDateString()
  nextDueDate?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(64)
  responsible?: string | null

  @IsOptional()
  @IsEnum(['active', 'paused'])
  status?: 'active' | 'paused'

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class PlanFilterDto {
  @IsOptional() @IsString()
  machineId?: string

  @IsOptional() @IsEnum(['active', 'paused'])
  status?: 'active' | 'paused'

  /** 只看即将到期（next_due_date 在 today+dueSoonDays 内且未完成） */
  @IsOptional() @IsInt()
  dueSoon?: number

  @IsOptional() @IsInt()
  page?: number = 1

  @IsOptional() @IsInt()
  pageSize?: number = 20
}

// ---------- 维保执行 / 故障停机 ----------

export class SparePartUsageDto {
  /** 备件 id */
  @IsString()
  partId!: string

  /** 耗用数量，须 > 0 */
  @IsNumber({}, { message: '耗用数量必须为数字' })
  @IsPositive({ message: '耗用数量必须大于 0' })
  qty!: number

  /** 耗用金额（元），须 >= 0 */
  @IsNumber({}, { message: '耗用金额必须为数字' })
  @Min(0)
  cost!: number
}

export class CreateRecordDto {
  /** 机台 id */
  @IsString()
  machineId!: string

  /** 关联的保养计划 id（故障停机可不传） */
  @IsOptional()
  @IsString()
  planId?: string | null

  /** planned 计划保养 / breakdown 故障停机 */
  @IsOptional()
  @IsEnum(['planned', 'breakdown'])
  type?: 'planned' | 'breakdown'

  /** 保养项目或故障描述 */
  @IsString()
  @MaxLength(128)
  category!: string

  /** 执行日期（YYYY-MM-DD） */
  @IsDateString()
  date!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMin?: number | null

  /** 停机时长（分钟），仅故障停机有意义 */
  @IsOptional()
  @IsInt()
  @Min(0)
  downtimeMin?: number | null

  /** 费用（元），默认 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number

  @IsOptional()
  @IsEnum(['ok', 'pending', 'failed'])
  result?: 'ok' | 'pending' | 'failed'

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null

  /** 耗用备件列表（写入时扣减库存） */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  spareParts?: SparePartUsageDto[]
}

export class RecordFilterDto {
  @IsOptional() @IsString()
  machineId?: string

  @IsOptional() @IsEnum(['planned', 'breakdown'])
  type?: 'planned' | 'breakdown'

  @IsOptional() @IsDateString()
  from?: string

  @IsOptional() @IsDateString()
  to?: string

  @IsOptional() @IsInt()
  page?: number = 1

  @IsOptional() @IsInt()
  pageSize?: number = 20
}

// ---------- 备件 ----------

export class CreateSparePartDto {
  /** 备件编码，公司内唯一 */
  @IsString()
  @MaxLength(32)
  partCode!: string

  @IsString()
  @MaxLength(128)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  spec?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number

  @IsOptional()
  @IsString()
  @MaxLength(64)
  location?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class UpdateSparePartDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  spec?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number

  @IsOptional()
  @IsString()
  @MaxLength(64)
  location?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

export class SparePartFilterDto {
  /** 只看低于安全库存的备件 */
  @IsOptional() @IsInt()
  lowStock?: number

  @IsOptional() @IsInt()
  page?: number = 1

  @IsOptional() @IsInt()
  pageSize?: number = 50
}
