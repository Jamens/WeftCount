import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ReceivableController } from './receivable.controller'
import { ReceivableService } from './receivable.service'
import { ReceiptEntity } from './entities/receipt.entity'
import { ReceiptApplicationEntity } from './entities/receipt-application.entity'
import { PartnerEntity } from '../partner/entities/partner.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReceiptEntity,
      ReceiptApplicationEntity,
      PartnerEntity,
      InventoryDocumentEntity,
    ]),
    AuthModule,
  ],
  controllers: [ReceivableController],
  providers: [ReceivableService],
  exports: [ReceivableService],
})
export class ReceivableModule {}
