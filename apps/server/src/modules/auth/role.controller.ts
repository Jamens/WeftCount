import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { AuthGuard } from './guards/auth.guard'
import { CurrentUser, type RequestContext } from './auth-context'
import { Permission } from './permissions'
import { RequirePermission } from './decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { CreateRoleDto, UpdateRoleDto } from './dtos/admin.dto'

@ApiTags('角色管理')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('roles')
export class RoleController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @RequirePermission(Permission.ROLE_VIEW)
  @ApiOperation({ summary: '查询租户内角色列表' })
  list(@CurrentUser() ctx: RequestContext) {
    return this.auth.listRoles(ctx.tenantId)
  }

  @Post()
  @RequirePermission(Permission.ROLE_MANAGE)
  @Audit({ action: 'create', module: 'role' })
  @ApiOperation({ summary: '新建自定义角色' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateRoleDto) {
    return this.auth.createRole(ctx.tenantId, dto)
  }

  @Patch(':id')
  @RequirePermission(Permission.ROLE_MANAGE)
  @Audit({ action: 'update', module: 'role', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新角色（名称 / 描述 / 权限）' })
  update(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.auth.updateRole(ctx.tenantId, id, dto)
  }

  @Delete(':id')
  @RequirePermission(Permission.ROLE_MANAGE)
  @Audit({ action: 'delete', module: 'role', targetIdParam: 'id' })
  @ApiOperation({ summary: '删除自定义角色（内置角色不可删，被使用的角色不可删）' })
  remove(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<{ ok: true }> {
    return this.auth.deleteRole(ctx.tenantId, id).then(() => ({ ok: true }))
  }
}
