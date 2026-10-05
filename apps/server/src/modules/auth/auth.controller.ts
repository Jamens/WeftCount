import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'
import { AuthService } from './auth.service'
import { AuthGuard } from './guards/auth.guard'
import { CurrentUser, type RequestContext } from './auth-context'
import { Permission } from './permissions'
import { RequirePermission } from './decorators/require-permission.decorator'
import type { ChangePasswordDto, LoginResult } from './types'

class LoginDto {
  @IsString({ message: '账号必须为字符串' })
  @IsNotEmpty({ message: '账号不能为空' })
  @MaxLength(64, { message: '账号长度不能超过 64' })
  username!: string

  @IsString({ message: '密码必须为字符串' })
  @IsNotEmpty({ message: '密码不能为空' })
  @MaxLength(64, { message: '密码长度不能超过 64' })
  password!: string
}

class SwitchCompanyDto {
  @IsString()
  @IsNotEmpty({ message: '公司 ID 不能为空' })
  companyId!: string
}

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '账号密码登录' })
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.username, dto.password)
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出（令牌由前端清除，服务端记录审计）' })
  logout(): { ok: true } {
    // 无状态 JWT，登出仅需前端清除令牌；审计在阶段一 1.4 补齐
    return { ok: true }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户的上下文与权限' })
  me(@CurrentUser() ctx: RequestContext): {
    userId: string
    tenantId: string
    companyId: string
    username: string
    realName: string
    roles: string[]
    permissions: string[]
  } {
    return {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      username: ctx.username,
      realName: ctx.realName,
      roles: ctx.roleCodes,
      permissions: ctx.permissions,
    }
  }

  @Post('switch-company')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '切换当前操作公司' })
  switchCompany(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: SwitchCompanyDto,
  ): Promise<{ companyId: string }> {
    return this.auth.switchCompany(ctx.userId, dto.companyId)
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改密码' })
  changePassword(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    return this.auth.changePassword(ctx.userId, dto.oldPassword, dto.newPassword).then(() => ({ ok: true }))
  }

  @Get('permissions')
  @UseGuards(AuthGuard)
  @RequirePermission(Permission.USER_VIEW)
  @ApiBearerAuth()
  @ApiOperation({ summary: '列出当前用户的全部权限码' })
  listPermissions(@CurrentUser() ctx: RequestContext): { permissions: string[] } {
    return { permissions: ctx.permissions }
  }
}
