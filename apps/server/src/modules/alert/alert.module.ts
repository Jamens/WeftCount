import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AlertController } from './alert.controller'
import { AlertService } from './alert.service'
import { AlertEntity } from './entities/alert.entity'
import { MaterialEntity } from '../material/entities/material.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { CompanyEntity } from '../tenant/entities/company.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([AlertEntity, MaterialEntity, ProductionOrderEntity, InventoryBatchEntity, InventoryTransactionEntity, TradeOrderEntity, CompanyEntity]),
    AuthModule,
  ],
  controllers: [AlertController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
