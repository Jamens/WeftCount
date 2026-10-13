import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MaterialController, GreigeSpecController } from './material.controller'
import { MaterialService } from './material.service'
import { MaterialEntity } from './entities/material.entity'
import { GreigeSpecEntity } from './entities/greige-spec.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [
    // 带上 InventoryBatchEntity 只为停用物料时校验库存余量。
    // **不能改成 imports [InventoryModule]**：inventory 已经依赖 material
    // （入库要取物料的 measureMode/规格），反向再依赖就是模块循环。
    // 实体类是纯类定义，跨模块 import 不产生 DI 依赖，因此这样是安全的。
    TypeOrmModule.forFeature([MaterialEntity, GreigeSpecEntity, InventoryBatchEntity]),
    AuthModule,
  ],
  controllers: [MaterialController, GreigeSpecController],
  providers: [MaterialService],
  exports: [MaterialService, TypeOrmModule],
})
export class MaterialModule {}
