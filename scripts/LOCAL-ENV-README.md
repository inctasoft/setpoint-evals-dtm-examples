# Local Environment Script - Quick Reference

## Overview
The `local-env.sh` script provides a unified interface for managing the DTM development environment.

## Key Features
✅ **Streamlined commands** - Only the essential functionality you need
✅ **Two modes** - Standalone (local Kafka) and Integrated (external Kafka)
✅ **Clean bash implementation** - No docker/compose file modifications

## Commands

### Start Services

#### Standalone Mode (with local Kafka)
```bash
./scripts/local-env.sh start --standalone
```
**Starts:**
- Kafka + Zookeeper + Kafka UI
- PostgreSQL (dtm-db on port 5448)
- PostgreSQL (workflow source DBs on ports 5449-5451)
- LocalStack (AWS services on port 4567)
- SQS Poller

#### Integrated Mode (with external Kafka)
```bash
./scripts/local-env.sh start --integrated
```
**Starts:**
- PostgreSQL (dtm-db on port 5448)
- PostgreSQL (workflow source DBs on ports 5449-5451)
- LocalStack (AWS services on port 4566)
- SQS Poller
- Kafka topic initialization (against external Kafka network)

**Environment Variables for Integrated Mode:**
```bash
export EXTERNAL_KAFKA_NETWORK="kafka-external"  # Default
export EXTERNAL_KAFKA_BROKER="kafka:29092"      # Default
```

### Stop Services
```bash
./scripts/local-env.sh stop
```
Stops all running services gracefully.

### Clean Everything
```bash
./scripts/local-env.sh clean
```
Stops all services and removes volumes (with confirmation prompt).

### Deploy Lambda Functions
```bash
./scripts/local-env.sh deploy-workers
```
Deploys Lambda functions to LocalStack (uses poller mode for reliability).

### Monitor Services

#### Monitor Jobs via API
```bash
./scripts/local-env.sh monitor api
```
Launches real-time job monitoring using the orchestrator API.

#### Monitor SQS Queues
```bash
./scripts/local-env.sh monitor sqs
```
Displays real-time SQS message counts across all queues.

### View Logs
```bash
./scripts/local-env.sh logs
```
Shows combined logs from all running services.

### Help
```bash
./scripts/local-env.sh help
```
Display comprehensive help message.

## Access URLs (Standalone Mode)

- **Migration DB**: `localhost:5448`
- **Order Processing DB**: `localhost:5449`
- **IoT Sensor Pipeline DB**: `localhost:5450`
- **Infra Provisioning DB**: `localhost:5451`
- **Kafka Broker**: `localhost:9093`
- **Kafka UI**: `http://localhost:8090`
- **LocalStack**: `http://localhost:4567`

## Access URLs (Integrated Mode)

- **Migration DB**: `localhost:5448`
- **Workflow Source DBs**: `localhost:5449-5451`
- **LocalStack**: `http://localhost:4567`
- **Kafka**: Uses external cluster

## Common Workflows

### Full Local Development
```bash
# Start everything
./scripts/local-env.sh start --standalone

# Deploy Lambda functions
./scripts/local-env.sh deploy-workers

# Monitor in separate terminal
./scripts/local-env.sh monitor api

# When done
./scripts/local-env.sh stop
```

### Using External Kafka
```bash
# Configure external Kafka
export EXTERNAL_KAFKA_NETWORK="your-kafka-network"
export EXTERNAL_KAFKA_BROKER="your-kafka-broker:9092"

# Start without local Kafka
./scripts/local-env.sh start --integrated

# Deploy and monitor
./scripts/local-env.sh deploy-workers
./scripts/local-env.sh monitor sqs
```

### Clean Start
```bash
# Remove everything and start fresh
./scripts/local-env.sh clean
./scripts/local-env.sh start --standalone
```

## Docker Commands

```bash
# Check running containers
docker ps

# View specific logs
docker logs -f dtm-db
docker logs -f dtm-localstack
docker logs -f dtm-sqs-poller-1

# Check Kafka topics (standalone mode)
docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list
```

## Notes

- The script uses `--profile db` to start only database services from the main compose file
- SQS poller runs in "poller mode" for reliable Lambda triggering
- All services use the `local` Docker network for communication
- The script sources common functions from `scripts/inc/common.sh`

## Troubleshooting

### Network not found
If you see network errors, ensure the `local` Docker network exists:
```bash
docker network create local
```

### LocalStack not starting
Check if port 4566 is already in use:
```bash
lsof -i :4566
```

### Kafka connection issues (integrated mode)
Verify the external Kafka network and broker are accessible:
```bash
docker network inspect $EXTERNAL_KAFKA_NETWORK
```

### Database connection issues
Check if ports 5432 or 5433 are already in use:
```bash
lsof -i :5432
lsof -i :5433
```
