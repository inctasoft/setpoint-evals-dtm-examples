import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import { GlobalErrorFilter } from './error';
import { AppLogger } from './common/logger/app-logger.service';
import * as express from 'express';
import supertokens from 'supertokens-node';
import { SuperTokensExceptionFilter } from './auth/supertokens-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Enable WebSocket support for the operations dashboard
  app.useWebSocketAdapter(new WsAdapter(app));

  // Use custom logger with correlation ID support
  app.useLogger(app.get(AppLogger));

  // Add JSON parser for various content types
  app.use(express.json({ type: ['application/json', 'application/cloudevents+json'] }));

  // CORS for SuperTokens auth
  app.enableCors({
    origin: [process.env.SUPERTOKENS_WEBSITE_DOMAIN || 'http://localhost:5173'],
    allowedHeaders: ['content-type', ...supertokens.getAllCORSHeaders()],
    credentials: true,
  });

  // Set global API prefix for versioning, exclude /auth routes
  app.setGlobalPrefix('api/v1', {
    exclude: ['/auth/(.*)', '/auth'],
  });

  // Configure Swagger/OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('DTM Orchestrator API')
    .setDescription(
      'DTM (Distributed Task Manager) — Orchestrator Service\n\n' +
        '## Overview\n' +
        'This service orchestrates workflow jobs using an step-based delegation pattern. ' +
        'Jobs are broken into steps processed by isolated Lambda workers via SQS, ' +
        'with Kafka carrying events to downstream systems.\n\n' +
        '## Workflow Endpoint\n\n' +
        '**POST** `/api/v1/workflows/{workflowName}/jobs`\n' +
        '- Submit a job to any registered workflow\n' +
        '- `deduplicationKey` — optional key for deduplication matching\n' +
        '- `variant` — optional step DAG variant (uses workflow default if omitted)\n' +
        '- `payload` — workflow-specific data passed to Lambda workers\n' +
        '- `testOptions` — optional per-step simulation controls (dev only)\n\n' +
        '**Registered workflows:** Configured via workflow definition packages\n\n' +
        '## Job Processing Flow\n\n' +
        '```\n' +
        '1. POST /api/v1/workflows/{name}/jobs\n' +
        '2. Job created → Steps delegated in parallel via SQS\n' +
        '3. Lambda workers process steps → callback to orchestrator\n' +
        '4. Results published to Kafka\n' +
        '5. Step enters WAITING_FOR_ACK → external system acknowledges\n' +
        '6. Job completes → workflow.jobs.completed event emitted\n' +
        '7. Webhook notification (if webhookUrl provided)\n' +
        '```\n\n' +
        '## Example Request\n\n' +
        '```bash\n' +
        'curl -X POST "http://localhost:3002/api/v1/workflows/{workflowName}/jobs" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        "  -d '{\n" +
        '    "variant": "default",\n' +
        '    "payload": { "key": "value" }\n' +
        "  }'\n" +
        '```\n\n' +
        '## Monitoring\n\n' +
        '- **Health:** `/api/v1/health` (liveness), `/api/v1/health/ready` (readiness)\n' +
        '- **Kafka Topics:** `/api/v1/health/kafka` (debug)\n' +
        '- **Job Status:** `GET /api/v1/workflows/{name}/jobs/{jobId}`\n' +
        '- **Kafka UI:** http://localhost:8080 (local)\n',
    )
    .setVersion('1.0')
    .addTag('workflows', '⚙️ Workflow Jobs — Submit and track workflow jobs')
    .addTag('health', '❤️ Health Checks - Liveness, Readiness, Kafka')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/api-docs', app, documentFactory, {
    customSiteTitle: 'DTM Orchestrator API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: false, // Don't throw errors for extra properties, just strip them
    }),
  );

  // Global error filters
  app.useGlobalFilters(new SuperTokensExceptionFilter(), new GlobalErrorFilter());

  // Log startup info
  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/v1/api-docs`);
  console.log(`❤️  Health Check: http://localhost:${port}/api/v1/health`);
}
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application:', error);
  process.exit(1);
});
