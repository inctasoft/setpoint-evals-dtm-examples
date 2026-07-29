import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KafkaConsumerModule } from '@dtm/kafka-consumer';
import { KafkaModule } from '../kafka/kafka.module';
import { EventBus } from './event-bus.interface';
import { KafkaEventBus } from './kafka-event-bus.service';
import { ZmqEventBus } from './zmq-event-bus.service';

const EVENT_BUS = process.env.EVENT_BUS || 'kafka';

/**
 * Provides EventBus based on the EVENT_BUS env var.
 *   kafka → KafkaEventBus (brokered; today's behavior byte-equivalent)
 *   zmq   → ZmqEventBus (PUB/SUB events + PUSH/PULL ack return)
 *
 * The zmq profile is fully dark under kafka: ZmqEventBus is never
 * instantiated and no sockets bind. Single-instance wiring from the start
 * (the Phase 2 lesson): the EventBus token ALIASES the concrete via
 * useExisting — a useClass duplicate would double-bind the zmq sockets on
 * module init.
 */
@Module({
  imports:
    EVENT_BUS === 'kafka'
      ? [
          KafkaModule,
          // The ACK consumer wiring, moved verbatim from KafkaHandlersModule
          // (same factory, same boot log line).
          KafkaConsumerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
              const broker = configService.get<string>('kafka.broker');
              const clientId = configService.get<string>('kafka.consumerClientId');
              const groupId = configService.get<string>('kafka.consumerGroupId');
              console.log(
                `[KafkaHandlersModule] Consumer: broker=${broker}, clientId=${clientId}, groupId=${groupId}`,
              );
              return {
                broker: broker || 'localhost:9093',
                groupId: groupId || 'dtm-service-group',
                clientId: clientId || 'dtm-orchestrator-consumer',
              };
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
        ]
      : [],
  providers:
    EVENT_BUS === 'zmq'
      ? [ZmqEventBus, { provide: EventBus, useExisting: ZmqEventBus }]
      : [KafkaEventBus, { provide: EventBus, useExisting: KafkaEventBus }],
  exports: [EventBus],
})
export class EventBusModule {}
