import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { ApiClientService } from './api-client.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, ApiClientService],
})
export class MetricsModule {}
