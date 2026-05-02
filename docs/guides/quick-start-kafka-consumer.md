# Quick Start: Kafka Consumer

## ✅ Current Status
- **Implementation:** Complete
- **Testing:** All tests passed
- **Ready for:** Production use

---

## 🚀 How to Use

### Start Orchestrator with Kafka Consumer Enabled

```bash

# Ensure KAFKA_BROKER is set in .env
echo "KAFKA_BROKER=kafka:9092" >> .env

# Start the orchestrator
pnpm --filter "./services/orchestrator" run start:dev
```

### Expected Startup Logs

```log
[KafkaConsumerService] ✅ Kafka consumer connected (group: dtm-service-group)
[KafkaConsumerService] ✅ Registered handler for topic: dtm.entity.created
[KafkaConsumerService] ✅ Registered handler for topic: dtm.entity.updated
[NestApplication] Nest application successfully started
```

---

## 📝 Create Missing Kafka Topics (One-Time Setup)

```bash
# Create dtm.entity.created topic
docker exec kafka kafka-topics --bootstrap-server localhost:9092 \
  --create --topic dtm.entity.created \
  --partitions 3 --replication-factor 1

# Create dtm.entity.updated topic
docker exec kafka kafka-topics --bootstrap-server localhost:9092 \
  --create --topic dtm.entity.updated \
  --partitions 3 --replication-factor 1

# Verify topics were created
docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list | grep dtm
```

---

## 🧪 Test Message Handling

### Send Test Message (Entity Created)

```bash
# Start producer
docker exec -it kafka kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic dtm.entity.created

# Paste this JSON and press Enter:
{"entityId":"test-123","entityNumber":1000,"name":"Test Entity","email":"test@example.com","createdAt":"2025-11-15T09:00:00Z","source":"workflow"}
```

### Expected Handler Logs

```log
[EntityCreatedHandler] 📥 Entity created event received: test-123 (entity_number: 1000)
[EntityCreatedHandler] ✅ Processed entity created: test-123
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Required for consumer to work
KAFKA_BROKER=kafka:9092

# Optional (defaults provided)
KAFKA_CONSUMER_GROUP_ID=dtm-service-group
```

### Disable Consumer

```bash
# Comment out KAFKA_BROKER to disable
# KAFKA_BROKER=kafka:9092
```

The orchestrator will start normally with a warning:
```log
[KafkaConsumerService] ⚠️  Kafka broker not configured - consumer disabled
```

---

## ➕ Add New Handler

### 1. Create Handler File

```typescript
// src/kafka/handlers/entity-created.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { IMessageHandler } from '@dtm/kafka-consumer';
import { EachMessagePayload } from 'kafkajs';

interface EntityCreatedEvent {
  entityId: string;
  entityNumber: number;
  parentId: string;
  createdAt: string;
}

@Injectable()
export class EntityCreatedHandler implements IMessageHandler {
  private readonly logger = new Logger(EntityCreatedHandler.name);

  async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { message } = payload;
    const data: EntityCreatedEvent = JSON.parse(
      message.value?.toString() || '{}',
    );

    this.logger.log(
      `📥 Entity created event received: ${data.entityId}`,
    );

    // TODO: Your business logic here
    // - Trigger reverse sync
    // - Update cache
    // - Send notifications

    this.logger.log(`✅ Processed entity created: ${data.entityId}`);
  }
}
```

### 2. Register in KafkaHandlersModule

```typescript
// src/kafka/kafka-handlers.module.ts
import { EntityCreatedHandler } from './handlers/entity-created.handler';

@Module({
  imports: [/* ... */],
  providers: [
    OrderCreatedHandler,
    OrderUpdatedHandler,
    EntityCreatedHandler, // ← Add here
  ],
  exports: [/* ... */],
})
export class KafkaHandlersModule implements OnModuleInit {
  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly orderCreatedHandler: OrderCreatedHandler,
    private readonly orderUpdatedHandler: OrderUpdatedHandler,
    private readonly entityCreatedHandler: EntityCreatedHandler, // ← Inject
  ) {}

  async onModuleInit() {
    await this.kafkaConsumer.connect();

    // Register handlers
    this.kafkaConsumer.registerHandler(
      'dtm.order.created',
      this.orderCreatedHandler,
    );
    this.kafkaConsumer.registerHandler(
      'dtm.order.updated',
      this.orderUpdatedHandler,
    );
    this.kafkaConsumer.registerHandler(
      'dtm.entity.created', // ← New topic
      this.entityCreatedHandler,
    );

    // Subscribe to topics
    await this.kafkaConsumer.subscribe({
      topic: 'dtm.order.created',
      fromBeginning: false,
    });
    await this.kafkaConsumer.subscribe({
      topic: 'dtm.order.updated',
      fromBeginning: false,
    });
    await this.kafkaConsumer.subscribe({
      topic: 'dtm.entity.created', // ← New subscription
      fromBeginning: false,
    });

    await this.kafkaConsumer.startConsuming();
  }
}
```

### 3. Rebuild and Restart

```bash
pnpm run build
pnpm --filter "./services/orchestrator" run start:dev
```

---

## 📊 Monitor Consumer

### Check Consumer Group Status

```bash
docker exec kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group dtm-service-group \
  --describe
```

### View Messages in Kafka UI

Open: http://localhost:8082

Navigate to:
1. **Topics** → `dtm.entity.created`
2. **Consumer Groups** → `dtm-service-group`

---

## 🐛 Troubleshooting

### Consumer not receiving messages

**Check 1: Is Kafka running?**
```bash
docker ps | grep kafka
```

**Check 2: Is KAFKA_BROKER set?**
```bash
grep "KAFKA_BROKER=" .env
```

**Check 3: Does topic exist?**
```bash
docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list | grep dtm
```

**Check 4: Are messages being produced?**
```bash
docker exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic dtm.entity.created \
  --from-beginning
```

### Connection errors

**Symptom:** `ECONNREFUSED`

**Solution:** Check `KAFKA_BROKER` format:
- ✅ Correct: `kafka:9092` (Docker)
- ✅ Correct: `localhost:9092` (Local)
- ❌ Wrong: `kafka:29092` (internal port)

### Topics don't exist

**Symptom:** "This server does not host this topic-partition"

**Solution:** Create topics manually (see above)

---

---

## 🎯 Current Handlers

| Handler | Topic | Status |
|---------|-------|--------|
| `EntityCreatedHandler` | `dtm.entity.created` | ✅ Active |
| `EntityUpdatedHandler` | `dtm.entity.updated` | ✅ Active |

---

## ⚡ Performance Tips

1. **Parallel Processing:** Increase partition count for high-throughput topics
2. **Consumer Groups:** Deploy multiple orchestrator instances for horizontal scaling
3. **Batch Processing:** Process multiple messages in a batch (configure in KafkaJS)
4. **Error Handling:** Messages that throw errors will be retried by Kafka

---

## 🔒 Security Notes

- Consumer group ID should be consistent across all orchestrator instances
- Use Kafka ACLs in production to restrict topic access
- Consider encryption for sensitive message payloads

---

## ✅ Quick Verification

Start orchestrator and look for these logs:

```log
✅ KafkaConsumerService initialized
✅ Kafka consumer connected (group: dtm-service-group)
✅ Registered handler for topic: dtm.entity.created
✅ Registered handler for topic: dtm.entity.updated
✅ Subscribed to topic: dtm.entity.created
✅ Subscribed to topic: dtm.entity.updated
🚀 Kafka consumer started
```

**All green?** 🎉 You're ready to receive messages!

