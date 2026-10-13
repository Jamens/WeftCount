import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { AuthModule } from '../auth/auth.module'
import { AlertModule } from '../alert/alert.module'

@Module({
  // 只读聚合：直接查这几张表，不注入其它 Service（避免跨模块耦合与循环依赖）。
  // 唯一的例外是 AlertService —— 预警有生成/静默等业务规则，自己重算 openCount 会口径分叉。
  imports: [
    TypeOrmModule.forFeature([
      InventoryBatchEntity,
      InventoryDocumentEntity,
      RollEntity,
      TradeOrderEntity,
      ProductionOrderEntity,
      ProductionReportEntity,
      MachineEntity,
    ]),
    AuthModule,
    AlertModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}