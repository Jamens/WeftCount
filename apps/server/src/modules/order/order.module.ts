import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'
import { TradeOrderEntity } from './entities/trade-order.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { MaterialModule } from '../material/material.module'
import { PartnerModule } from '../partner/partner.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    // 注册 InventoryDocumentEntity 仅为按 order_id 汇总已履约单据/查关联单据，不注入 InventoryService（避免循环）
    TypeOrmModule.forFeature([TradeOrderEntity, InventoryDocumentEntity]),
    MaterialModule,
    PartnerModule,
    AuthModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
