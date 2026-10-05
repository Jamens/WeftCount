import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthGuard } from './guards/auth.guard'
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
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'weftcount-dev-secret'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as never,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}
