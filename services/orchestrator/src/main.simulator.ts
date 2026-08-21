/**
 * Simulator Entry Point
 *
 * Identical to main.ts but uses AppSimulatorModule (dynamic workflow loading)
 * instead of AppModule (hardcoded workflow imports).
 *
 * Usage:
 *   WORKFLOW_CONFIG_PATHS=/path/to/workflow.config.js npx tsx main.simulator.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppSimulatorModule } from './app.simulator.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalErrorFilter } from './error';
import { AppLogger } from './common/logger/app-logger.service';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppSimulatorModule, { bufferLogs: true });

  app.useLogger(app.get(AppLogger));
  app.use(express.json({ type: ['application/json', 'application/cloudevents+json'] }));
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('DTM Orchestrator Simulator')
    .setDescription('Orchestrator Simulator — dynamic workflow loading mode')
    .setVersion('1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/api-docs', app, documentFactory);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new GlobalErrorFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Orchestrator Simulator running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/v1/api-docs`);
  console.log(`❤️  Health Check: http://localhost:${port}/api/v1/health`);
}

bootstrap().catch((error) => {
  const logger = new Logger('SimulatorBootstrap');
  logger.error('Failed to start simulator:', error);
  process.exit(1);
});
