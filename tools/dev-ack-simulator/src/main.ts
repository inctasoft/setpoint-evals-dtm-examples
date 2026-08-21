// BUS_PROFILE umbrella expansion MUST land before AppModule is evaluated
// (the event-bus module reads process.env at import time).
import "./bus-profile";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AppLogger } from "./common/logger/app-logger.service";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use custom logger with correlation ID support
  app.useLogger(app.get(AppLogger));

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Health check endpoint
  app.getHttpAdapter().get("/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      service: "dev-ack-simulator",
      timestamp: new Date().toISOString(),
    });
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`🤖 Dev Acknowledgement Simulator is running on port ${port}`);
  logger.warn(
    "⚠️  This is a DEVELOPMENT-ONLY service. Do not use in production!",
  );
  logger.log(`📊 Health check: http://localhost:${port}/health`);
}

bootstrap();
