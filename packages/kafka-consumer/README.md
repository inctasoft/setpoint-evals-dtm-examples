# @dtm/kafka-consumer

Reusable NestJS Kafka consumer package for DTM (Distributed Task Manager).

## Features

- ✅ Auto-discovery of topic handlers via decorators
- ✅ Graceful degradation when KAFKA_BROKER not set
- ✅ Error handling and logging
- ✅ Type-safe message handling
- ✅ Consumer group support

## Installation

```bash
pnpm add @dtm/kafka-consumer
```

## Usage

### 1. Register module in your NestJS app

```typescript
import { KafkaConsumerModule } from '@dtm/kafka-consumer';

@Module({
  imports: [
    KafkaConsumerModule.forRoot({
      broker: process.env.KAFKA_BROKER || '',
      groupId: 'dtm-service-group',
      clientId: 'dtm-orchestrator',
    }),
  ],
})
export class AppModule {}
```

### 2. Create a topic handler

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { KafkaTopic, IMessageHandler } from '@dtm/kafka-consumer';
import { EachMessagePayload } from 'kafkajs';

@Injectable()
@KafkaTopic({ topic: 'dtm.your-workflow.ack', fromBeginning: false })
export class WorkflowAckHandler implements IMessageHandler {
  private readonly logger = new Logger(WorkflowAckHandler.name);

  async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { message } = payload;
    const data = JSON.parse(message.value?.toString() || '{}');

    this.logger.log(`Processing consumer created event: ${data.consumerId}`);

    // Your business logic here
    // e.g., create a workflow job, update records, etc.
  }
}
```

### 3. Register your handler as a provider

```typescript
@Module({
  providers: [WorkflowAckHandler, WorkflowEventHandler],
})
export class KafkaHandlersModule {}
```

## Environment Variables

```bash
# Required for consumers to work
KAFKA_BROKER=kafka:9092

# If not set, consumers are gracefully disabled
# KAFKA_BROKER=
```

## Graceful Degradation

When `KAFKA_BROKER` is not set:
- Consumer initialization is skipped
- No connections are attempted
- No errors are thrown
- Logs: "Kafka broker not configured - consumer disabled"

