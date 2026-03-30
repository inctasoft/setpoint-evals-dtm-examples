import { DynamicModule, Module, Provider, Type } from "@nestjs/common";
import { KafkaConsumerService } from "./kafka-consumer.service";
import { KafkaConsumerConfig } from "./interfaces/consumer-config.interface";

/**
 * Options for async configuration factory
 */
export interface KafkaConsumerModuleAsyncOptions {
  imports?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<KafkaConsumerConfig> | KafkaConsumerConfig;
  inject?: any[];
}

@Module({})
export class KafkaConsumerModule {
  /**
   * Register Kafka consumer with static configuration
   */
  static forRoot(config: KafkaConsumerConfig): DynamicModule {
    const kafkaConsumerProvider = {
      provide: KafkaConsumerService,
      useFactory: () => new KafkaConsumerService(config),
    };

    return {
      module: KafkaConsumerModule,
      providers: [kafkaConsumerProvider],
      exports: [KafkaConsumerService],
      global: false,
    };
  }

  /**
   * Register Kafka consumer with async configuration
   * Supports dependency injection for ConfigService, etc.
   */
  static forRootAsync(options: KafkaConsumerModuleAsyncOptions): DynamicModule {
    const kafkaConsumerProvider: Provider = {
      provide: KafkaConsumerService,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args);
        return new KafkaConsumerService(config);
      },
      inject: options.inject || [],
    };

    return {
      module: KafkaConsumerModule,
      imports: options.imports || [],
      providers: [kafkaConsumerProvider],
      exports: [KafkaConsumerService],
      global: false,
    };
  }
}
