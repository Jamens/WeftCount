import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ImportExportController } from './import-export.controller'
import { ImportExportService } from './import-export.service'
import { ReportExportService } from './report-export.service'
import { MaterialEntity } from '../material/entities/material.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { WarehouseEntity } from '../warehouse/entities/warehouse.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { StocktakeEntity } from '../stocktake/entities/stocktake.entity'
import { AuditLogEntity } from '../audit/entities/audit-log.entity'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'
import { CostModule } from '../cost/cost.module'
import { AnalyticsModule } from '../analytics/analytics.module'

@Module({
  // 通用报表导出跨多模块取数：注册全部被导出的实体（只读，不注入对方 Service）
  imports: [
    TypeOrmModule.forFeature([
      MaterialEntity,
      GreigeSpecEntity,
      InventoryBatchEntity,
      InventoryTransactionEntity,
      InventoryDocumentEntity,
      RollEntity,
      WarehouseEntity,
      TradeOrderEntity,
      ProductionOrderEntity,
      ProductionReportEntity,
      MachineEntity,
      StocktakeEntity,
      AuditLogEntity,
    ]),
    MaterialModule,
    AuthModule,
    // 成本/趋势直接复用这两个模块的 service，保证导出数字与页面口径一致（不自己重算）
    CostModule,
    AnalyticsModule,
  ],
  controllers: [ImportExportController],
  providers: [ImportExportService, ReportExportService],
  exports: [ImportExportService, ReportExportService],
})
export class ImportExportModule {}