import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { KafkaHealthIndicator } from './kafka.health';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [KafkaHealthIndicator],
  exports: [KafkaHealthIndicator],
})
export class HealthModule {}
