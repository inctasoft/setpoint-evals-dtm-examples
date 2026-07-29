import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { KafkaModule } from "../kafka/kafka.module";
import { KafkaService } from "../kafka/kafka.service";
import { SimulatorModule } from "../simulator/simulator.module";
import { ConfigLoaderModule } from "../config/config-loader.module";
import { ZmqEventBusClient } from "./zmq-event-bus.client";
import { SIMULATOR_EVENT_BUS } from "./simulator-event-bus.interface";

const EVENT_BUS = process.env.EVENT_BUS || "kafka";

/**
 * Provides the simulator's event bus client based on the EVENT_BUS env var.
 *   kafka → the existing KafkaService satisfies the contract (byte-identical)
 *   zmq   → ZmqEventBusClient (SUB events in, PUSH acks out)
 *
 * Single-instance wiring: the token ALIASES the concrete via useExisting.
 */
@Module({
  imports: [
    ConfigModule,
    KafkaModule,
    forwardRef(() => SimulatorModule),
    ConfigLoaderModule,
  ],
  providers:
    EVENT_BUS === "zmq"
      ? [
          ZmqEventBusClient,
          { provide: SIMULATOR_EVENT_BUS, useExisting: ZmqEventBusClient },
        ]
      : [{ provide: SIMULATOR_EVENT_BUS, useExisting: KafkaService }],
  exports: [SIMULATOR_EVENT_BUS],
})
export class EventBusModule {}
