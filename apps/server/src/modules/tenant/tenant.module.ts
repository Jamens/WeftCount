import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TenantEntity } from './entities/tenant.entity'
import { CompanyEntity } from './entities/company.entity'

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity, CompanyEntity])],
  exports: [TypeOrmModule],
})
export class TenantModule {}
