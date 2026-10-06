import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { InventoryBatchEntity } from './entities/inventory-batch.entity'
import { RollEntity } from './entities/roll.entity'
import { RollOutboundEntity } from './entities/roll-outbound.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from './entities/inventory-document.entity'
import { MaterialModule } from '../material/material.module'
import { PartnerModule } from '../partner/partner.module'
import { OrderModule } from '../order/order.module'
import { WarehouseModule } from '../warehouse/warehouse.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryBatchEntity, RollEntity, RollOutboundEntity, InventoryTransactionEntity, InventoryDocumentEntity, ProductionReportEntity, ProductionOrderEntity, MachineEntity]),
    MaterialModule,
    PartnerModule,
    OrderModule,
    // 批次归仓 + 调拨需要仓库服务（单向：inventory → warehouse，无循环）
    WarehouseModule,
    AuthModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
