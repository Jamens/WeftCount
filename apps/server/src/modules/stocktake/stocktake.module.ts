import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { StocktakeController } from './stocktake.controller'
import { StocktakeService } from './stocktake.service'
import { StocktakeEntity } from './entities/stocktake.entity'
import { StocktakeItemEntity } from './entities/stocktake-item.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { WarehouseModule } from '../warehouse/warehouse.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([StocktakeEntity, StocktakeItemEntity, InventoryBatchEntity, InventoryTransactionEntity]),
    WarehouseModule,
    AuthModule,
  ],
  controllers: [StocktakeController],
  providers: [StocktakeService],
  exports: [StocktakeService],
})
export class StocktakeModule {}
