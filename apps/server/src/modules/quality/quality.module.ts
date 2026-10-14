import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { QualityController } from './quality.controller'
import { QualityService } from './quality.service'
import { DefectTypeEntity } from './entities/defect-type.entity'
import { InspectionEntity } from './entities/inspection.entity'
import { InspectionRollEntity } from './entities/inspection-roll.entity'
import { InspectionDefectEntity } from './entities/inspection-defect.entity'
import { GradePriceEntity } from './entities/grade-price.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DefectTypeEntity,
      InspectionEntity,
      InspectionRollEntity,
      InspectionDefectEntity,
      GradePriceEntity,
      RollEntity,
      InventoryBatchEntity,
    ]),
    AuthModule,
  ],
  controllers: [QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
