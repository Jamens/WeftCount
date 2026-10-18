import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import type { PartnerStatus, PartnerType } from './entities/partner.entity'

export class CreatePartnerDto {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsString() @IsNotEmpty({ message: '单位名称不能为空' }) @MaxLength(128)
  name!: string

  @IsOptional() @IsEnum(['supplier', 'customer', 'both'])
  type?: PartnerType

  @IsOptional() @IsString() @MaxLength(64)
  contact?: string

  @IsOptional() @IsString() @MaxLength(32)
  phone?: string

  @IsOptional() @IsString() @MaxLength(32)
  taxNo?: string

  @IsOptional() @IsString() @MaxLength(255)
  address?: string

  @IsOptional() @IsString() @MaxLength(128)
  bankName?: string

  @IsOptional() @IsString() @MaxLength(64)
  bankAccount?: string

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string

  /** 信用账期（天），用于推算销售出库到期日；不传=按系统默认账期 */
  @IsOptional() @IsInt() @Min(0)
  creditDays?: number | null
}

export class UpdatePartnerDto {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128)
  name?: string

  @IsOptional() @IsEnum(['supplier', 'customer', 'both'])
  type?: PartnerType

  @IsOptional() @IsString() @MaxLength(64)
  contact?: string

  @IsOptional() @IsString() @MaxLength(32)
  phone?: string

  @IsOptional() @IsString() @MaxLength(32)
  taxNo?: string

  @IsOptional() @IsString() @MaxLength(255)
  address?: string

  @IsOptional() @IsString() @MaxLength(128)
  bankName?: string

  @IsOptional() @IsString() @MaxLength(64)
  bankAccount?: string

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null

  /** 信用账期（天），不传则不修改 */
  @IsOptional() @IsInt() @Min(0)
  creditDays?: number | null
}

export class PartnerFilterDto {
  @IsOptional() @IsString()
  keyword?: string

  @IsOptional() @IsEnum(['supplier', 'customer', 'both'])
  type?: PartnerType

  @IsOptional() @IsEnum(['active', 'disabled'])
  status?: PartnerStatus
}
