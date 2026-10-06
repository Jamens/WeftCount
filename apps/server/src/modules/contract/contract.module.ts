import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ContractController } from './contract.controller'
import { ContractService } from './contract.service'
import { ContractEntity } from './entities/contract.entity'
import { ContractItemEntity } from './entities/contract-item.entity'
import { PartnerModule } from '../partner/partner.module'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([ContractEntity, ContractItemEntity]),
    PartnerModule,
    MaterialModule,
    AuthModule,
  ],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
