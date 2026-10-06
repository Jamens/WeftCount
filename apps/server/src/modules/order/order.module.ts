import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'
import { TradeOrderEntity } from './entities/trade-order.entity'
import { MaterialModule } from '../material/material.module'
import { PartnerModule } from '../partner/partner.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([TradeOrderEntity]), MaterialModule, PartnerModule, AuthModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
