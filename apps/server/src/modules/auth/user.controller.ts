import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { AuthGuard } from './guards/auth.guard'
import { CurrentUser, type RequestContext } from './auth-context'
import { Permission } from './permissions'
import { RequirePermission } from './decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dtos/admin.dto'

@ApiTags('用户管理')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @RequirePermission(Permission.USER_VIEW)
  @ApiOperation({ summary: '查询租户内用户列表（含公司与角色名），并附带可选公司列表' })
  list(@CurrentUser() ctx: RequestContext) {
    return this.auth.listUsers(ctx.tenantId)
  }

  @Post()
  @RequirePermission(Permission.USER_MANAGE)
  @Audit({ action: 'create', module: 'user' })
  @ApiOperation({ summary: '新建用户' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateUserDto) {
    return this.auth.createUser(ctx.tenantId, dto)
  }

  @Patch(':id')
  @RequirePermission(Permission.USER_MANAGE)
  @Audit({ action: 'update', module: 'user', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新用户（资料 / 状态 / 公司 / 角色，可选重置密码）' })
  update(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.auth.updateUser(ctx.tenantId, id, dto)
  }

  @Post(':id/reset-password')
  @RequirePermission(Permission.USER_MANAGE)
  @Audit({ action: 'update', module: 'user.password', targetIdParam: 'id' })
  @ApiOperation({ summary: '重置用户密码' })
  resetPassword(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<{ ok: true }> {
    return this.auth.resetPassword(ctx.tenantId, id, dto).then(() => ({ ok: true }))
  }
}
