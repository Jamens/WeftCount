import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MaterialController, GreigeSpecController } from './material.controller'
import { MaterialService } from './material.service'
import { MaterialEntity } from './entities/material.entity'
import { GreigeSpecEntity } from './entities/greige-spec.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [TypeOrmModule.forFeature([MaterialEntity, GreigeSpecEntity]), AuthModule],
  controllers: [MaterialController, GreigeSpecController],
  providers: [MaterialService],
  exports: [MaterialService, TypeOrmModule],
})
export class MaterialModule {}
