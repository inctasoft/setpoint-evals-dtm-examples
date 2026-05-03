# Kafka Connectivity Fix for Debug Mode

## Issue Summary

When running the orchestrator in **debug mode** (outside Docker), Kafka connections were failing with:

```
Error: connect ECONNREFUSED 127.0.0.1:9092
```

Despite configuring `localhost:9093` as the broker address, KafkaJS was trying to connect to port `9092`.

## Root Cause Analysis

### Problem 1: Kafka Advertised Listeners Mismatch

The Docker Kafka container had this configuration:

```yaml
ports:
  - "9093:9092"  # Host:Container - external clients connect to 9093
  
environment:
  KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://dtm-kafka:29092,PLAINTEXT_INTERNAL://localhost:9092
```

**The issue:** When a client connects to `localhost:9093`:
1. Docker routes it to container port `9092` ✓
2. Client successfully connects to Kafka ✓
3. Kafka returns metadata with advertised address: `localhost:9092` ✗
4. Client tries to connect to `localhost:9092` → **FAILS** (port not exposed)

### Problem 2: Missing KAFKA_LISTENERS Configuration

The Kafka container didn't have `KAFKA_LISTENERS` defined, which tells Kafka what ports to actually bind to.

### Problem 3: Database Package Creating Duplicate Connection

The `packages/database/database.module.ts` was creating its own `TypeOrmModule.forRootAsync()` with hardcoded environment variables, conflicting with the runtime-detected configuration in `app.module.ts`.

### Problem 4: Runtime Detection Not Overriding Env Values

The runtime detection functions (`getKafkaBroker`, `getServiceEndpoint`, etc.) were using env values as defaults instead of overriding them in local mode.

## Solution

### Fix 1: docker-compose.kafka.yml - Simplified Port Configuration

The cleanest solution is to use the **same port inside and outside** the container:

```yaml
environment:
  KAFKA_BROKER_ID: 1
  KAFKA_ZOOKEEPER_CONNECT: "zookeeper:2181"
  KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_INTERNAL:PLAINTEXT
  # Use 9093 internally so it matches the advertised port (no remapping needed!)
  KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:29092,PLAINTEXT_INTERNAL://0.0.0.0:9093
  # Same port - simple!
  KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://dtm-kafka:29092,PLAINTEXT_INTERNAL://localhost:9093
  KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
ports:
  - "9093:9093"   # Same port inside and outside!
  - "29093:29092"
healthcheck:
  test: ["CMD", "kafka-topics", "--bootstrap-server", "localhost:9093", "--list"]
```

**Key insight:** Using the same port (9093) everywhere eliminates confusion:
- Container listens on 9093
- Docker exposes 9093:9093 (no remapping)
- Kafka advertises `localhost:9093`
- Healthcheck uses `localhost:9093`
- External clients use `localhost:9093`

### Fix 2: Runtime Config - Always Override in Local Mode

In `services/orchestrator/src/config/runtime.config.ts`:

```typescript
export function getKafkaBroker(envValue: string | undefined): string {
  const runtime = detectRuntime();
  
  switch (runtime) {
    case 'eks':
      return envValue || 'localhost:9092';
    case 'docker':
      return envValue || 'dtm-kafka:29092';
    case 'local':
      // FIXED: Always use localhost:9093, ignore env value
      return 'localhost:9093';
  }
}
```

### Fix 3: Database Package - Remove Duplicate Connection

In `packages/database/src/database.module.ts`:

```typescript
// BEFORE: Had its own TypeOrmModule.forRootAsync() with env vars
// AFTER: Only uses TypeOrmModule.forFeature() - connection configured by app
@Module({
  imports: [
    TypeOrmModule.forFeature([Job, MigrationStep]),
  ],
  // ...
})
export class DatabaseModule {}
```

## How It Works Now

### Local Debug Mode (orchestrator outside Docker)
1. Runtime detection identifies as "local" (`/.dockerenv` doesn't exist)
2. All config functions return local addresses:
   - Kafka: `localhost:9093`
   - Database: `localhost:5448`
   - SQS: `localhost:4566`
3. Client connects to Kafka at `localhost:9093`
4. Kafka metadata returns `localhost:9093` (matches!)
5. Connection succeeds ✓

### Docker Mode (orchestrator inside Docker)
1. Runtime detection identifies as "docker" (`/.dockerenv` exists)
2. Config functions return Docker service names:
   - Kafka: `dtm-kafka:29092`
   - Database: `dtm-db:5432`
3. Docker DNS resolves service names
4. Connection succeeds ✓

## Verification

After applying fixes, restart Kafka container to pick up new config:

```bash
cd .
docker compose -f docker-compose.kafka.yml up -d kafka
```

Then run orchestrator in debug mode:

```bash
cd services/orchestrator
NODE_ENV=development node dist/src/main.js
```

You should see:
```
[KafkaConfig] Broker: localhost:9093 (env: dtm-kafka:29092)
[KafkaService] Kafka producer connected successfully
[KafkaConsumerService] ✅ Kafka consumer connected (group: dtm-service-group)
[ConsumerGroup] Consumer has joined the group
```

## Files Changed

1. `docker-compose.kafka.yml` - Fixed Kafka listeners configuration
2. `services/orchestrator/src/config/runtime.config.ts` - Override env values in local mode
3. `packages/database/src/database.module.ts` - Removed duplicate TypeORM connection
4. `services/orchestrator/src/kafka/kafka-handlers.module.ts` - Added debug logging
5. `packages/kafka-consumer/src/kafka-consumer.service.ts` - Added debug logging
6. `packages/kafka-producer/src/kafka-producer.service.ts` - Added debug logging

## Key Takeaways

1. **Kafka Advertised Listeners must match the actual client connection address**
   - If clients connect to `localhost:9093`, advertise `localhost:9093`
   - Port mappings only affect the network layer, not Kafka metadata

2. **Runtime detection should OVERRIDE env values, not just use them as defaults**
   - The `.env` file contains Docker-oriented values
   - Local mode should always use local addresses regardless of env

3. **Avoid duplicate TypeORM connections in NestJS monorepos**
   - Only the main app module should configure `TypeOrmModule.forRootAsync()`
   - Shared packages should only use `TypeOrmModule.forFeature()`

