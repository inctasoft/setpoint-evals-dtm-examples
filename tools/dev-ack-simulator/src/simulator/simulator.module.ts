import { Module, forwardRef } from "@nestjs/common";
import { SimulatorService } from "./simulator.service";
import { KafkaModule } from "../kafka/kafka.module";
import { ConfigLoaderModule } from "../config/config-loader.module";

@Module({
  imports: [forwardRef(() => KafkaModule), ConfigLoaderModule],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
