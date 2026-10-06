import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([InventoryBatchEntity, InventoryDocumentEntity, GreigeSpecEntity, RollEntity, ProductionReportEntity, ProductionOrderEntity, MachineEntity]), AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
