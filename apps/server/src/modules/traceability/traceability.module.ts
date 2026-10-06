import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TraceabilityController } from './traceability.controller'
import { TraceabilityService } from './traceability.service'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { PartnerEntity } from '../partner/entities/partner.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { WarehouseEntity } from '../warehouse/entities/warehouse.entity'
import { AuthModule } from '../auth/auth.module'

/**
 * 全链路追溯（纯只读查询）
 *
 * 不新建表——数据已通过 sourceDocId / orderId / batchId / docId 串成链，
 * 这里只做穿透查询把链条拼出来。forFeature 注册各实体只读取用，不注入各业务 Service（无副作用）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryBatchEntity,
      InventoryTransactionEntity,
      InventoryDocumentEntity,
      TradeOrderEntity,
      PartnerEntity,
      ProductionOrderEntity,
      ProductionReportEntity,
      MachineEntity,
      GreigeSpecEntity,
      WarehouseEntity,
    ]),
    AuthModule,
  ],
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
  exports: [TraceabilityService],
})
export class TraceabilityModule {}
