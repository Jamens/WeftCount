import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'
import { AuditInterceptor } from './audit.interceptor'
import { AuditLogEntity } from './entities/audit-log.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  // AuthModule 提供 AuthGuard（查询审计日志需要 audit.view 权限）
  imports: [TypeOrmModule.forFeature([AuditLogEntity]), AuthModule],
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
