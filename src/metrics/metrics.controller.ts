import {
  Controller,
  Get,
  Param,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  async getAllMetrics(@Res() res: Response): Promise<void> {
    try {
      // Update metrics for all members
      await this.metricsService.updateMetricsForAllMembers();

      // Get the Prometheus-formatted metrics
      const metrics = await this.metricsService.getMetrics();

      // Set appropriate headers for Prometheus
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      throw new HttpException(
        `Error fetching metrics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':memberId/metrics')
  async getMemberMetrics(
    @Param('memberId') memberId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      // Update metrics for the specified member
      await this.metricsService.updateMetricsForMember(memberId);

      // Get the Prometheus-formatted metrics
      const metrics = await this.metricsService.getMetrics();

      // Set appropriate headers for Prometheus
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(
          `Member ${memberId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        `Error fetching metrics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
