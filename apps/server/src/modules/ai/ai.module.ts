import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { LlmClient } from './llm.client'
import { PricingService } from './pricing.service'
import { CostModule } from '../cost/cost.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [CostModule, AuthModule],
  controllers: [AiController],
  providers: [LlmClient, PricingService],
  exports: [LlmClient, PricingService],
})
export class AiModule {}
