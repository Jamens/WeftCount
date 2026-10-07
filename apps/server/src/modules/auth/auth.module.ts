import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthGuard } from './guards/auth.guard'
import { UserController } from './user.controller'
import { RoleController } from './role.controller'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from './entities/role.entity'
import { CompanyEntity } from '../tenant/entities/company.entity'
import { TenantEntity } from '../tenant/entities/tenant.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RoleEntity, CompanyEntity, TenantEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // 开发默认值仅供本地便利；**生产环境用默认值等于公开密钥**
        // （开源仓库里人人可见 → 可伪造任意租户/管理员令牌）。
        //
        // 两个「公开值」都要拦：
        //  1) 代码里的兜底默认值
        //  2) `.env.example` 里那个示例值——用户直接 cp .env.example .env 是最常见的
        //     起点，只拦 (1) 会漏掉这条路径（实测踩过：.env 用的是 (2)，守卫没触发）
        const PUBLIC_DEV_SECRETS = new Set([
          'weftcount-dev-secret',
          'weftcount-dev-secret-change-me', // .env.example 的示例值
        ])
        const secret = config.get<string>('JWT_SECRET') ?? 'weftcount-dev-secret'
        const isProduction = config.get<string>('NODE_ENV') === 'production'
        if (isProduction && PUBLIC_DEV_SECRETS.has(secret)) {
          throw new Error(
            'JWT_SECRET 未设置或仍是开发默认值。生产环境必须配置强随机密钥，' +
              '否则任何人都能用公开的默认值伪造令牌。' +
              '生成方式：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
          )
        }
        return {
          secret,
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as never,
          },
        }
      },
    }),
  ],
  controllers: [AuthController, UserController, RoleController],
  providers: [AuthService, AuthGuard],
  // 导出实体仓库：AuthGuard 被审计模块复用时需要直接查库复核用户/租户状态
  exports: [AuthService, AuthGuard, JwtModule, TypeOrmModule],
})
export class AuthModule {}
