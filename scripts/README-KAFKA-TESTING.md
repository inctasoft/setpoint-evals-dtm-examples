# Kafka-Triggered Migration Testing Scripts

Quick reference for testing Kafka-triggered jobs.

## 🚀 Quick Start

### 1. Install Dependencies (One-time)

```bash
cd .
pnpm install  # Installs kafkajs for test scripts
```

### 2. Start Services

```bash
docker-compose up -d
```

### 3. Run a Test

```bash
# Method 1: Bash script (simplest)
./scripts/test-kafka-trigger.sh

# Method 2: Node.js script (more flexible)
node scripts/publish-test-event.js
```

---

## 📝 Available Scripts

### `test-kafka-trigger.sh` - Simple Bash Test

**Best for:** Quick smoke tests

```bash
# Test with default values (consumer_no=1000, eventType=created)
./scripts/test-kafka-trigger.sh

# Test with specific consumer_no
./scripts/test-kafka-trigger.sh 2000

# Test consumer.updated event
./scripts/test-kafka-trigger.sh 1000 updated
```

**What it does:**

- ✅ Publishes event to Kafka
- ✅ Waits 5 seconds
- ✅ Shows orchestrator logs
- ✅ Queries database for job
- ✅ Displays monitoring commands

---

### `publish-test-event.js` - Node.js Test Publisher

**Best for:** Flexible testing with custom data

```bash
# Basic usage
node scripts/publish-test-event.js

# Custom consumer ID and number
node scripts/publish-test-event.js \
  --consumerId my-test-123 \
  --consumerNo 2000

# Test updated event
node scripts/publish-test-event.js \
  --eventType updated \
  --consumerId consumer-456 \
  --consumerNo 1500 \
  --email newemail@example.com

# All options
node scripts/publish-test-event.js \
  --consumerId test-789 \
  --consumerNo 3000 \
  --eventType created \
  --firstName John \
  --lastName Doe \
  --email john.doe@example.com
```

**Options:**

- `--consumerId` - Unique consumer identifier (default: `test-{timestamp}`)
- `--consumerNo` - Consumer number from source system (default: 1000)
- `--eventType` - Event type: `created` or `updated` (default: `created`)
- `--firstName` - Consumer first name (default: `Test`)
- `--lastName` - Consumer last name (default: `User`)
- `--email` - Consumer email (default: `test@example.com`)

---

### `load-test-kafka-triggers.js` - Load Testing

**Best for:** Performance testing, stress testing

```bash
# Small load test (10 events)
node scripts/load-test-kafka-triggers.js --count 10

# Medium load test (100 events, 10 per batch)
node scripts/load-test-kafka-triggers.js \
  --count 100 \
  --batchSize 10 \
  --delayBetweenBatches 1000

# Heavy load test (1000 events, 50 per batch)
node scripts/load-test-kafka-triggers.js \
  --count 1000 \
  --batchSize 50 \
  --delayBetweenBatches 500

# Custom starting consumer_no
node scripts/load-test-kafka-triggers.js \
  --count 200 \
  --batchSize 20 \
  --startConsumerNo 5000
```

**Options:**

- `--count` - Total number of events (default: 100)
- `--batchSize` - Events per batch (default: 10)
- `--delayBetweenBatches` - Delay in ms between batches (default: 1000)
- `--startConsumerNo` - Starting consumer_no (default: 1000)

**What it does:**

- ✅ Publishes events in batches
- ✅ Shows progress and rate
- ✅ Provides monitoring commands
- ✅ Reports final statistics

**Example Output:**

```
🚀 Starting Kafka-Triggered Migrations Load Test
=================================================
   Test ID:                loadtest-1700000000000
   Total events:           100
   Batch size:             10
   Delay between batches:  1000ms
   Starting consumer_no:   1000

📤 Batch 1/10: 10 events in 45ms | Progress: 10/100 (10.0%) | Rate: 8.33 events/s
📤 Batch 2/10: 10 events in 42ms | Progress: 20/100 (20.0%) | Rate: 9.09 events/s
...
✅ Load Test Complete!
======================
   Total events published: 100
   Total duration:         12.34s
   Average rate:           8.10 events/second
   Batches sent:           10
```

---

## 🔍 Monitoring Commands

### Watch Orchestrator Logs

```bash
# Follow logs with specific consumer ID
docker logs -f dtm-orchestrator | grep "test-123"

# Follow all job triggers
docker logs -f dtm-orchestrator | grep "Job triggered"

# Last 50 lines
docker logs --tail 50 dtm-orchestrator
```

### Check Job Status

```bash
# Via API
curl http://localhost:3001/api/v1/jobs | jq '.[] | select(.submittedBy | contains("kafka"))'

# Via Database
docker exec migration-db psql -U postgres -d migration_db -c \
  "SELECT id, status, submitted_by, created_at
   FROM dtm_jobs
   WHERE submitted_by LIKE 'kafka-consumer-%'
   ORDER BY created_at DESC
   LIMIT 10;"

# Count auto-triggered jobs
docker exec migration-db psql -U postgres -d migration_db -c \
  "SELECT COUNT(*) FROM dtm_jobs WHERE submitted_by LIKE 'kafka-consumer-%';"
```

### Monitor Kafka

```bash
# Watch incoming events
docker exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic dtm.jobs.submitted \
  --from-beginning

# Watch completion events
docker exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic migration.jobs.completed \
  --from-beginning

# Check consumer lag
docker exec kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe \
  --group dtm-service-group
```

---

## ✅ Testing Checklist

### Before Committing

- [ ] `./scripts/test-kafka-trigger.sh` - Basic smoke test
- [ ] Check logs for errors
- [ ] Verify job created in database
- [ ] Run unit tests: `pnpm test src/kafka`

### Before Merging PR

- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] Load test with 50-100 events
- [ ] No errors in logs
- [ ] Check Kafka consumer lag is low

### Before Production

- [ ] Full test suite passes in CI
- [ ] Load test with 1000+ events
- [ ] Monitor resource usage
- [ ] Verify idempotency works
- [ ] Test with realistic data

---

## 🐛 Troubleshooting

### No Migration Triggered

**Problem:** Event published but no migration created

**Check:**

```bash
# 1. Is auto-job enabled?
docker exec dtm-orchestrator env | grep AUTO_MIGRATE

# 2. Is Kafka consumer connected?
docker logs dtm-orchestrator | grep "Kafka"
# Should see: "Connected to Kafka broker"

# 3. Is consumer subscribed?
docker logs dtm-orchestrator | grep "Subscribed"
# Should see: "Subscribed to topic: dtm.ack.topic"
```

### Idempotency Preventing Migration

**Problem:** Same event doesn't trigger migration

**This is expected!** Idempotency prevents duplicate migrations on the same day.

```bash
# Check if job already exists
docker exec migration-db psql -U postgres -d migration_db -c \
  "SELECT id, status FROM dtm_jobs WHERE id LIKE '%your-consumer-id%';"
```

**Solution:** Use a different consumer ID or wait until tomorrow.

### Kafka Connection Error

**Problem:** `ECONNREFUSED` or `Broker not available`

**Check:**

```bash
# 1. Is Kafka running?
docker ps | grep kafka

# 2. Check Kafka health
docker logs kafka | tail -20

# 3. Verify broker URL
docker exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092
```

---

## 📚 Related Documentation

- **[TESTING-KAFKA-TRIGGERED-MIGRATIONS.md](../../TESTING-KAFKA-TRIGGERED-MIGRATIONS.md)** - Complete testing guide
- **[QUICK-START-KAFKA-TRIGGERED-MIGRATIONS.md](../../QUICK-START-KAFKA-TRIGGERED-MIGRATIONS.md)** - Quick start guide
- **[KAFKA-TRIGGERED-MIGRATIONS-COMPLETE.md](../../KAFKA-TRIGGERED-MIGRATIONS-COMPLETE.md)** - Full implementation details

---

## 💡 Tips

1. **Use unique consumer IDs** to avoid idempotency blocking tests
2. **Monitor logs in real-time** with `docker logs -f`
3. **Check consumer lag** after load tests
4. **Use Kafka UI** (http://localhost:8080) for visual debugging
5. **Clean up test data** periodically from database

---

**Happy Testing! 🎉**
