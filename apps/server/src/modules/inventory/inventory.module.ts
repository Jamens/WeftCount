import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { InventoryBatchEntity } from './entities/inventory-batch.entity'
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from './entities/inventory-document.entity'
import { MaterialModule } from '../material/material.module'
import { PartnerModule } from '../partner/partner.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryBatchEntity, InventoryTransactionEntity, InventoryDocumentEntity]),
    MaterialModule,
    PartnerModule,
    AuthModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
