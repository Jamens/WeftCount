import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { InventoryBatchEntity } from './entities/inventory-batch.entity'
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from './entities/inventory-document.entity'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryBatchEntity, InventoryTransactionEntity, InventoryDocumentEntity]),
    MaterialModule,
    AuthModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
