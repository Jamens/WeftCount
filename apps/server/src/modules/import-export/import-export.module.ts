import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ImportExportController } from './import-export.controller'
import { ImportExportService } from './import-export.service'
import { MaterialEntity } from '../material/entities/material.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { MaterialModule } from '../material/material.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([MaterialEntity, GreigeSpecEntity]), MaterialModule, AuthModule],
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
