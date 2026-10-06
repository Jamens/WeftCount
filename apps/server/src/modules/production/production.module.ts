import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MachineController, ProductionOrderController } from './production.controller'
import { ProductionService } from './production.service'
import { MachineEntity } from './entities/machine.entity'
import { ProductionOrderEntity } from './entities/production-order.entity'
import { ProductionReportEntity } from './entities/production-report.entity'
import { MaterialModule } from '../material/material.module'
import { InventoryModule } from '../inventory/inventory.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([MachineEntity, ProductionOrderEntity, ProductionReportEntity]),
    MaterialModule,
    // 报工 → 坯布入库（单向依赖：production → inventory，无循环）
    InventoryModule,
    AuthModule,
  ],
  controllers: [MachineController, ProductionOrderController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
