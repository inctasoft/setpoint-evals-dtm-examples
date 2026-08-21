# Dev Acknowledgement Simulator

**Standalone acknowledgement service** that simulates external system acknowledgements for workflow steps.

## ⚠️ Current Usage (Temporary)

**This service currently runs in BOTH standalone and integrated modes as a temporary solution.**

- **Standalone Mode**: ✅ Permanent - Always uses dev-ack-simulator for local development
- **Integrated Mode**: ⚠️ **TEMPORARY** - Uses dev-ack-simulator until external system implements an acknowledgement service
- **Future Production**: Will be replaced by real acknowledgements from external system

**Why the temporary setup?**
External system does not yet have the acknowledgement service implemented. Once that's in place, the dev-ack-simulator will ONLY run in standalone mode for local development, and integrated mode will receive real acknowledgements from external system.

## Purpose

This service automatically sends acknowledgements to enable end-to-end testing:

- **Development/Standalone**: Enables testing without external dependencies
- **Integrated Mode (Current)**: Temporary bridge until external system acknowledgement service is ready
- **Production (Future)**: External system will send acknowledgements after processing data

## Features

- Listens to `*.completed` topics (per workflow cascade config)
- Automatically publishes to `*.ack` topics
- Respects simulated acknowledgement delays
- Supports custom acknowledgement payloads
- Runs in standalone Docker container (profile: `dev-tools`)
- **Fire-and-forget message processing**: ACK delay + Kafka publish run concurrently (not blocking the consumer), enabling high throughput during parallel SE execution

> **Note on `ENABLE_DEV_ACK_SIMULATOR`**: This environment variable is used in preflight checks and documentation as a convention to remind developers that acks are simulated. However, **the actual control mechanism is the Docker Compose `dev-tools` profile**—if the profile is active, the simulator runs.

## Architecture

```
┌─────────────────────────────────────────────────┐
│         DTM Orchestrator                        │
│  ┌──────────────────────────────────────────┐   │
│  │  Submit Worker                           │   │
│  │  1. Submits data to target               │   │
│  │  2. Publishes to *.completed             │───┼──┐
│  └──────────────────────────────────────────┘   │  │
│                                                  │  │
│  ┌──────────────────────────────────────────┐   │  │ Kafka
│  │  AcknowledgementHandler                  │◄──┼──┤ (*.completed)
│  │  - Receives acknowledgements             │   │  │
│  │  - Continues orchestration               │   │  │
│  └──────────────────────────────────────────┘   │  │
└─────────────────────────────────────────────────┘  │
                                                     │
            ┌────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────┐
│     Dev-Ack-Simulator (This Service)            │
│  ┌──────────────────────────────────────────┐   │
│  │  SimulatorService                        │   │
│  │  1. Listens to *.completed               │   │
│  │  2. Simulates delays (if configured)     │   │
│  │  3. Publishes to *.ack                   │───┼──┐
│  └──────────────────────────────────────────┘   │  │
└─────────────────────────────────────────────────┘  │
                                                     │ Kafka
                  ┌──────────────────────────────────┘ (*.ack)
                  │
                  ▼
         Back to AcknowledgementHandler
```

## Running

### Via Docker Compose (Recommended)

```bash
# Start in standalone mode (includes dev-ack-simulator)
./scripts/local-env.sh start --standalone --orchestrator

# OR start in integrated mode (currently also includes dev-ack-simulator - temporary)
./scripts/local-env.sh start --integrated --orchestrator

# Stop services
./scripts/local-env.sh stop

# View logs
docker logs dtm-dev-ack-simulator -f
```

### Manual (For Development)

```bash
# Install dependencies
cd tools/dev-ack-simulator
pnpm install

# Build
pnpm run build

# Start
pnpm run start:dev
```

## Configuration

### Environment Variables

| Variable        | Default       | Description            |
| --------------- | ------------- | ---------------------- |
| `NODE_ENV`      | `development` | Environment mode       |
| `KAFKA_BROKERS` | `kafka:29092` | Kafka broker addresses |
| `PORT`          | `3001`        | Health check port      |

> **How the simulator is enabled**: The simulator runs when the Docker Compose `dev-tools` profile is active. The `ENABLE_DEV_ACK_SIMULATOR` env var is a **preflight check convention** used in validation scripts—it does not control the simulator at runtime.

### Topics

**Consumes:**

- `order.consumer.completed` - Consumer submit completed
- `order.payment.completed` - Payment submit completed
- (plus additional topics per workflow cascade config)

**Produces:**

- `order.consumer.ack` - Consumer acknowledgement
- `order.payment.ack` - Payment acknowledgement
- (plus additional topics per workflow cascade config)

## Testing Scenarios

### 1. **Basic Acknowledgement**

```bash
# Initiate job
curl -X POST http://localhost:3002/api/v1/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d '{"customerId": 1}'

# Simulator will auto-acknowledge
# Check logs:
docker logs dtm-dev-ack-simulator

# Expected output:
# [DEV] Auto-acknowledging consumer submission for step <step-id>
# [DEV] Consumer acknowledgement sent for step <step-id>
```

### 2. **Acknowledgement Delays**

```bash
# Simulate 30-second acknowledgement delay
curl -X POST http://localhost:3002/api/v1/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "SubmitCustomer": { "ackDelay": 30000 }
    }
  }'

# Monitor job staying in WAITING_FOR_ACK
./scripts/local-env.sh monitor api
```

### 3. **Custom Acknowledgement Payloads**

```bash
# Simulate external system enriching acknowledgement data
curl -X POST http://localhost:3002/api/v1/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "SubmitCustomer": {
        "ackPayload": {
          "externalId": "EXT-12345",
          "validationStatus": "APPROVED",
          "enrichedData": {
            "field1": "value1"
          }
        }
      }
    }
  }'

# Check database for enriched acknowledgement data
psql -h localhost -p 5448 -U dtm_user -d dtm \
  -c "SELECT ack_metadata FROM dtm_steps WHERE id = '<step-id>';"
```

### 4. **Stuck Job Testing**

```bash
# Start job
curl -X POST http://localhost:3002/api/v1/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d '{"customerId": 1}'

# Kill simulator to simulate external system being down
docker stop dtm-dev-ack-simulator

# Job will remain in WAITING_FOR_ACK status
./scripts/local-env.sh monitor api

# Restart simulator to resume
docker start dtm-dev-ack-simulator
```

## Health Check

```bash
curl http://localhost:3001/health

# Response:
{
  "status": "ok",
  "service": "dev-ack-simulator",
  "timestamp": "2025-11-22T10:00:00.000Z"
}
```

## Logs

### Startup Logs (Success)

```
✅ Kafka consumer connected successfully
✅ Kafka producer connected successfully
✅ Subscribed to completion topics
✅ Kafka consumer started
🤖 Dev Acknowledgement Simulator is running on port 3001
⚠️  This is a DEVELOPMENT-ONLY service. Do not use in production!
📊 Health check: http://localhost:3001/health
```

### Acknowledgement Logs

```
[DEV] Auto-acknowledging consumer submission for step abc-123
[DEV] Simulating ack delay: 5000ms
[DEV] Consumer acknowledgement sent for step abc-123
```

### Custom Payload Logs

```
[DEV] Auto-acknowledging consumer submission for step abc-123
[DEV] Consumer acknowledgement sent for step abc-123 (with custom payload)
```

## Production Behavior

**Current State (Temporary):**

- ⚠️ Runs in BOTH standalone AND integrated modes (profile: `dev-tools`)
- ⚠️ Integrated mode uses this service temporarily until external system implements acknowledgements
- ✅ Controlled by Docker Compose `dev-tools` profile (not by env vars at runtime)

**Future State (After External System Implementation):**

- ✅ Will ONLY run in standalone mode for local development
- ✅ Integrated mode will receive real acknowledgements from external system
- ✅ Production will use real acknowledgements from external system (never this simulator)

> **Note**: The `dev-tools` profile is automatically added by `local-env.sh` in both standalone and integrated modes. To disable the simulator, you would need to modify `local-env.sh` to exclude the profile.

## Troubleshooting

### Simulator Not Starting

```bash
# Check if dev-tools profile is active
docker ps | grep dev-ack-simulator

# If not found, ensure you started the environment with orchestrator:
./scripts/local-env.sh start --standalone --orchestrator
# OR
./scripts/local-env.sh start --integrated --orchestrator
```

### Acknowledgements Not Being Sent

```bash
# Check simulator logs
docker logs dtm-dev-ack-simulator

# Verify the simulator container is running (dev-tools profile must be active)
docker ps | grep dev-ack-simulator

# Check Kafka connection
docker logs dtm-dev-ack-simulator | grep Kafka
```

### Jobs Stuck in WAITING_FOR_ACK

```bash
# Verify simulator is running
docker ps | grep dev-ack-simulator

# Check if simulator is consuming messages
docker logs dtm-dev-ack-simulator | grep "Auto-acknowledging"

# If no logs, check Kafka topics
docker exec -it dtm-kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic order.consumer.completed \
  --from-beginning
```

## Development

### Local Setup

```bash
cd tools/dev-ack-simulator

# Install dependencies
pnpm install

# Build
pnpm run build

# Run in watch mode
pnpm run start:dev

# Run tests
pnpm run test

# Lint
pnpm run lint
```

### Project Structure

```
src/
├── main.ts                      # Application bootstrap
├── app.module.ts                # Root module
├── kafka/
│   ├── kafka.module.ts          # Kafka providers module
│   ├── kafka.service.ts         # Kafka producer service
│   └── kafka.consumer.ts        # Kafka consumer service
└── simulator/
    ├── simulator.module.ts      # Simulator module
    └── simulator.service.ts     # Core simulation logic
```

### Key Files

- **`simulator.service.ts`**: Main logic for consuming completion events and publishing acknowledgements. Uses **fire-and-forget** pattern: the ackDelay + Kafka publish are scheduled without blocking the KafkaJS `eachMessage` consumer, allowing concurrent processing of multiple completion events.
- **`kafka.consumer.ts`**: Simplified Kafka consumer (IMessageHandler interface)
- **`kafka.service.ts`**: Kafka producer for publishing acknowledgements
- **`main.ts`**: Bootstraps NestJS app, registers handlers, subscribes to topics

### Fire-and-Forget Pattern

KafkaJS `eachMessage` processes messages sequentially -- each handler must resolve before the next message is consumed. Without fire-and-forget, 50+ concurrent completion messages with 500ms ackDelay each would block the consumer for ~25s, causing orchestrator step timeouts during parallel SE execution.

The fix: `handleEntityCompleted()` synchronously validates the message but schedules the delay + publish as a detached async operation:

```typescript
const sendAck = async () => {
  if (ackDelay > 0) await this.delay(ackDelay);
  await this.kafkaService.publish(ackTopic, finalAck);
};
sendAck().catch((err) => this.logger.error(`Failed to send ACK: ${err}`));
// Consumer immediately proceeds to next message
```

This is safe because ACKs are independent (different stepIds), the delay still works per-ACK, and KafkaJS handles concurrent `producer.send()` calls internally.

## Related Documentation

- [System Architecture](../../../docs/system-architecture.md) - Section 8: Production vs Development Modes
- [Features Guide](../../../docs/FEATURES.md) - Custom Acknowledgement Payloads
- [Extraction Summary](../../../DEV-ACK-SIMULATOR-EXTRACTION-COMPLETE.md) - Full extraction details
- [E2E Evals](../../../e2e-evals/) - Testing scenarios

## Support

For issues, questions, or feature requests, contact the DTM Team.

---

**Service Version:** 1.0.0  
**Last Updated:** 2025-11-22  
**Status:** ✅ PRODUCTION-READY (for development use)
