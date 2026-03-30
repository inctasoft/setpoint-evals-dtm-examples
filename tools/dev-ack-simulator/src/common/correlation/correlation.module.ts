import { Module, Global } from "@nestjs/common";
import { CorrelationService } from "./correlation.service";
import { AppLogger } from "../logger/app-logger.service";

@Global()
@Module({
  providers: [CorrelationService, AppLogger],
  exports: [CorrelationService, AppLogger],
})
export class CorrelationModule {}
