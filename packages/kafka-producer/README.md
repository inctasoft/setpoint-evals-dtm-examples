# @dtm/kafka-producer

Shared Kafka producer service for the dtm monorepo.

## Overview

This package provides a reusable Kafka producer that can be used across multiple services in the dtm monorepo. It handles publishing messages to the project's Kafka topics:

- `dtm.jobs.completed` - For successfully completed job data
- `dtm.jobs.failed` - For job records that failed processing

## Installation

This package is part of the pnpm workspace and is automatically available to other packages. To use it in a service:

```json
{
  "dependencies": {
    "@dtm/kafka-producer": "workspace:*"
  }
}
```

## Usage

### Basic Example

```typescript
import { KafkaProducerService, JobCompletedMessage, JobFailedMessage } from "@dtm/kafka-producer";

// Initialize producer
const producer = new KafkaProducerService({
  broker: process.env.KAFKA_BROKER || "kafka:29092",
  clientId: "my-service",
});

// Connect
await producer.connect();

// Publish transformed message
const transformedMessage: JobCompletedMessage = {
  jobId: "job-123",
  transformedAt: new Date().toISOString(),
  data: {
    // optional additional data
  },
};

await producer.publishTransformed(transformedMessage);

// Publish failed message
const failedMessage: JobFailedMessage = {
  jobId: "job-123",
  failedAt: new Date().toISOString(),
  error: "Error message",
  stage: "transform", // optional
  data: {
    // optional additional data
  },
};

await producer.publishFailed(failedMessage);

// Disconnect when done
await producer.disconnect();
```

### NestJS Integration

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KafkaProducerService, JobCompletedMessage } from "@dtm/kafka-producer";

@Injectable()
export class MyService implements OnModuleInit, OnModuleDestroy {
  private producer: KafkaProducerService;

  constructor(private configService: ConfigService) {
    this.producer = new KafkaProducerService({
      broker: this.configService.get<string>("KAFKA_BROKER", "kafka:29092"),
      clientId: "my-service",
    });
  }

  async onModuleInit() {
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  async publishTransformed(data: JobCompletedMessage) {
    await this.producer.publishTransformed(data);
  }
}
```

## Configuration

### KafkaProducerConfig

```typescript
interface KafkaProducerConfig {
  broker: string | string[]; // Required: Kafka broker address(es)
  clientId?: string; // Optional: Client ID (default: 'dtm-producer')
  retry?: {
    retries?: number; // Optional: Number of retries (default: 3)
    initialRetryTime?: number; // Optional: Initial retry time in ms (default: 100)
  };
}
```

## Features

- **Idempotent Producer**: Ensures exactly-once semantics
- **Type Safety**: Full TypeScript support with typed message interfaces
- **Error Handling**: Comprehensive error messages and connection management
- **Reusable**: Can be used across multiple services in the workspace
- **Connection Management**: Automatic connection state tracking

## Message Types

### JobCompletedMessage

```typescript
interface JobCompletedMessage {
  jobId: string;
  transformedAt: string; // ISO 8601 timestamp
  data?: Record<string, unknown>; // Optional additional data
}
```

### JobFailedMessage

```typescript
interface JobFailedMessage {
  jobId: string;
  failedAt: string; // ISO 8601 timestamp
  error: string;
  stage?: string; // Optional: e.g., 'extract', 'transform', 'publish'
  data?: Record<string, unknown>; // Optional additional data
}
```

## Development

### Build

```bash
cd packages/kafka-producer
pnpm build
```

### Test

```bash
cd packages/kafka-producer
pnpm test
```

## Requirements

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Kafka broker with topics `dtm.jobs.completed` and `dtm.jobs.failed` created

## Topics

The producer expects the following topics to exist:

- `dtm.jobs.completed` (3 partitions, replication factor 1)
- `dtm.jobs.failed` (3 partitions, replication factor 1)

Topics are typically created by the `kafka-init` container in the Docker Compose setup.
