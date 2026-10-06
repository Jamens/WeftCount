import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { WeftNamingStrategy } from './common/naming-strategy'
import { HealthController } from './health/health.controller'
import { AuthModule } from './modules/auth/auth.module'
import { TenantModule } from './modules/tenant/tenant.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuditInterceptor } from './modules/audit/audit.interceptor'
import { MaterialModule } from './modules/material/material.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { PartnerModule } from './modules/partner/partner.module'
import { OrderModule } from './modules/order/order.module'
import { ProductionModule } from './modules/production/production.module'
import { CostModule } from './modules/cost/cost.module'
import { WarehouseModule } from './modules/warehouse/warehouse.module'
import { StocktakeModule } from './modules/stocktake/stocktake.module'
import { TraceabilityModule } from './modules/traceability/traceability.module'
import { ContractModule } from './modules/contract/contract.module'
import { AiModule } from './modules/ai/ai.module'
import { AlertModule } from './modules/alert/alert.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { ImportExportModule } from './modules/import-export/import-export.module'
import { ResponseInterceptor } from './common/interceptors/response.interceptor'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(config.get<string>('DB_PORT', '3306')),
        username: config.get<string>('DB_USER', 'root'),
        password: config.get<string>('DB_PASSWORD', '1234560'),
        database: config.get<string>('DB_NAME', 'weft_count'),
        charset: 'utf8mb4',
        namingStrategy: new WeftNamingStrategy(),
        timezone: '+08:00',
        synchronize: false,
        logging: config.get<string>('DB_LOGGING') === 'true',
        autoLoadEntities: true,
        retryAttempts: 5,
        retryDelay: 2000,
      }),
    }),
    AuthModule,
    TenantModule,
    AuditModule,
    MaterialModule,
    InventoryModule,
    PartnerModule,
    OrderModule,
    ProductionModule,
    CostModule,
    WarehouseModule,
    StocktakeModule,
    TraceabilityModule,
    ContractModule,
    AiModule,
    AlertModule,
    AnalyticsModule,
    ImportExportModule,
  ],
  controllers: [HealthController],
  providers: [
    // 顺序要求：响应包装在最外层，审计在里层，
    // 这样审计拿到的是原始业务数据而非 envelope
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
