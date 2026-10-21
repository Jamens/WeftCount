import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { EnergyController } from './energy.controller'
import { EnergyService } from './energy.service'
import { EnergyReadingEntity } from './entities/energy-reading.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([EnergyReadingEntity, MachineEntity, ProductionReportEntity]),
    AuthModule,
  ],
  controllers: [EnergyController],
  providers: [EnergyService],
  exports: [EnergyService],
})
export class EnergyModule {}