import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HealthController } from './health/health.controller'

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
        timezone: '+08:00',
        synchronize: false,
        logging: config.get<string>('DB_LOGGING') === 'true',
        autoLoadEntities: true,
        retryAttempts: 5,
        retryDelay: 2000,
      }),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
