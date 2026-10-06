import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WarehouseController } from './warehouse.controller'
import { WarehouseService } from './warehouse.service'
import { WarehouseEntity } from './entities/warehouse.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([WarehouseEntity]), AuthModule],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
