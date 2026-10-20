import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PayrollController } from './payroll.controller'
import { PayrollService } from './payroll.service'
import { WageProfileEntity } from './entities/wage-profile.entity'
import { WageSlipEntity } from './entities/wage-slip.entity'
import { WageSlipItemEntity } from './entities/wage-slip-item.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { UserEntity } from '../auth/entities/user.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WageProfileEntity,
      WageSlipEntity,
      WageSlipItemEntity,
      ProductionReportEntity,
      ProductionOrderEntity,
      MachineEntity,
      UserEntity,
    ]),
    AuthModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
