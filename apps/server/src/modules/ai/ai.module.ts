import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AiController } from './ai.controller'
import { LlmClient } from './llm.client'
import { PricingService } from './pricing.service'
import { LossService } from './loss.service'
import { CostModule } from '../cost/cost.module'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'

@Module({
  // 注册库存两实体仅为只读聚合投料/产出，不注入 InventoryService（避免循环依赖）
  imports: [
    TypeOrmModule.forFeature([InventoryDocumentEntity, InventoryBatchEntity]),
    CostModule,
    MaterialModule,
    AuthModule,
  ],
  controllers: [AiController],
  providers: [LlmClient, PricingService, LossService],
  exports: [LlmClient, PricingService, LossService],
})
export class AiModule {}
