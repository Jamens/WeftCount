import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CostController } from './cost.controller'
import { CostService } from './cost.service'
import { MaterialEntity } from '../material/entities/material.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    // 只读三张表做取价 + 规格来自 MaterialModule；不注入 InventoryService（无副作用）
    TypeOrmModule.forFeature([MaterialEntity, InventoryBatchEntity, InventoryDocumentEntity]),
    MaterialModule,
    AuthModule,
  ],
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}
