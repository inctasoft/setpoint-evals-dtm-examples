import { Module } from "@nestjs/common";
import { KafkaService } from "./kafka.service";
import { KafkaConsumer } from "./kafka.consumer";
import { SimulatorModule } from "../simulator/simulator.module";
import { ConfigLoaderModule } from "../config/config-loader.module";

@Module({
  imports: [SimulatorModule, ConfigLoaderModule],
  providers: [KafkaService, KafkaConsumer],
  exports: [KafkaService],
})
export class KafkaModule {}
