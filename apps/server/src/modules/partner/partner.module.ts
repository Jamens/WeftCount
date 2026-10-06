import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PartnerController, SupplierCodeController } from './partner.controller'
import { PartnerService } from './partner.service'
import { PartnerEntity } from './entities/partner.entity'
import { SupplierCodeMappingEntity } from './entities/supplier-code-mapping.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([PartnerEntity, SupplierCodeMappingEntity]), AuthModule],
  controllers: [PartnerController, SupplierCodeController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
