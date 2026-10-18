import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MaintenanceController } from './maintenance.controller'
import { MaintenanceService } from './maintenance.service'
import { MaintenancePlanEntity } from './entities/maintenance-plan.entity'
import { MaintenanceRecordEntity } from './entities/maintenance-record.entity'
import { SparePartEntity } from './entities/spare-part.entity'
import { MaintenanceSparePartEntity } from './entities/maintenance-spare-part.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenancePlanEntity,
      MaintenanceRecordEntity,
      SparePartEntity,
      MaintenanceSparePartEntity,
      MachineEntity,
    ]),
    AuthModule,
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
