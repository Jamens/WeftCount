import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PartnerController } from './partner.controller'
import { PartnerService } from './partner.service'
import { PartnerEntity } from './entities/partner.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([PartnerEntity]), AuthModule],
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
