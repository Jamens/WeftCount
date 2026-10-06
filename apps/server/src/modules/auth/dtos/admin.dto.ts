import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import type { UserStatus } from '@weftcount/shared'

export class CreateUserDto {
  @IsString() @IsNotEmpty({ message: '登录账号不能为空' }) @MaxLength(64)
  username!: string

  @IsString() @IsNotEmpty({ message: '姓名不能为空' }) @MaxLength(64)
  realName!: string

  @IsString() @IsNotEmpty({ message: '初始密码不能为空' }) @MinLength(8, { message: '密码至少 8 位' })
  password!: string

  @IsOptional() @IsString() @MaxLength(32)
  phone?: string

  @IsOptional() @IsEmail({}, { message: '邮箱格式不正确' }) @MaxLength(128)
  email?: string

  @IsArray() @ArrayNotEmpty({ message: '至少关联一个公司' })
  @IsString({ each: true })
  companyIds!: string[]

  @IsArray() @ArrayNotEmpty({ message: '至少分配一个角色' })
  @IsString({ each: true })
  roleCodes!: string[]
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64)
  realName?: string

  @IsOptional() @IsString() @MaxLength(32)
  phone?: string

  @IsOptional() @IsEmail({}, { message: '邮箱格式不正确' }) @MaxLength(128)
  email?: string

  /** 可选：传入则重置密码（仍走强度校验） */
  @IsOptional() @IsString() @MinLength(8, { message: '密码至少 8 位' })
  password?: string

  @IsOptional() @IsEnum(['active', 'disabled', 'locked'])
  status?: UserStatus

  @IsOptional() @IsArray() @ArrayNotEmpty()
  @IsString({ each: true })
  companyIds?: string[]

  @IsOptional() @IsArray() @ArrayNotEmpty()
  @IsString({ each: true })
  roleCodes?: string[]
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() @MinLength(8, { message: '密码至少 8 位' })
  newPassword!: string
}

export class CreateRoleDto {
  @IsString() @IsNotEmpty({ message: '角色编码不能为空' }) @MaxLength(32)
  code!: string

  @IsString() @IsNotEmpty({ message: '角色名称不能为空' }) @MaxLength(64)
  name!: string

  @IsOptional() @IsString() @MaxLength(255)
  description?: string

  @IsArray() @IsString({ each: true })
  permissions!: string[]
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64)
  name?: string

  @IsOptional() @IsString() @MaxLength(255)
  description?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  permissions?: string[]
}

/** 前端展示用的用户安全视图（绝不回传 passwordHash） */
export interface SafeUser {
  id: string
  username: string
  realName: string
  phone: string | null
  email: string | null
  status: UserStatus
  companyIds: string[]
  companyNames: string[]
  roleCodes: string[]
  roleNames: string[]
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** 角色选项（供用户表单下拉） */
export interface RoleOption {
  id: string
  code: string
  name: string
  builtin: boolean
}

/** 公司选项（供用户表单下拉） */
export interface CompanyOption {
  id: string
  code: string
  name: string
}
