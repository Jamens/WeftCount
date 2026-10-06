import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AiController } from './ai.controller'
import { LlmClient } from './llm.client'
import { PricingService } from './pricing.service'
import { LossService } from './loss.service'
import { CoefficientService } from './coefficient.service'
import { PredictionService } from './prediction.service'
import { SchedulingService } from './scheduling.service'
import { CostModule } from '../cost/cost.module'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { MaterialEntity } from '../material/entities/material.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { RollEntity } from '../inventory/entities/roll.entity'

@Module({
  // 注册库存/规格/物料/机台/订单实体仅为只读聚合与回写校准系数，不注入上层 Service（避免循环依赖）
  imports: [
    TypeOrmModule.forFeature([
      InventoryDocumentEntity,
      InventoryBatchEntity,
      ProductionReportEntity,
      RollEntity,
      GreigeSpecEntity,
      MaterialEntity,
      MachineEntity,
      ProductionOrderEntity,
    ]),
    CostModule,
    MaterialModule,
    AuthModule,
  ],
  controllers: [AiController],
  providers: [LlmClient, PricingService, LossService, CoefficientService, PredictionService, SchedulingService],
  exports: [LlmClient, PricingService, LossService, CoefficientService, PredictionService, SchedulingService],
})
export class AiModule {}
