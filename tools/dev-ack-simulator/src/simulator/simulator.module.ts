import { Module, forwardRef } from "@nestjs/common";
import { SimulatorService } from "./simulator.service";
import { EventBusModule } from "../event-bus/event-bus.module";
import { ConfigLoaderModule } from "../config/config-loader.module";

@Module({
  imports: [forwardRef(() => EventBusModule), ConfigLoaderModule],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
