# Orchestrator Service

The orchestrator is the NestJS backend API service for DTM (Distributed Task Manager).

## Development

### Quick Start

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm run start:dev
```

### Available Scripts

```bash
# Development
pnpm run start:dev      # Start with hot reload
pnpm run start:debug    # Start in debug mode

# Building
pnpm run build          # Build for production
pnpm run start:prod     # Run production build

# Testing
pnpm run test           # Run unit tests
pnpm run test:watch     # Run tests in watch mode
pnpm run test:cov       # Run tests with coverage
pnpm run test:e2e       # Run e2e tests

# Code Quality
pnpm run lint:check     # Check for linting errors
pnpm run lint:fix       # Fix linting errors
pnpm run format:check   # Check code formatting
pnpm run format         # Format code

# Database
pnpm run migrate        # Run database migrations
```

## Project Structure

```
orchestrator/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── app.module.ts           # Root module
│   ├── app.controller.ts       # Root controller
│   ├── app.service.ts          # Root service
│   ├── common/                 # ⭐ Common services
│   │   └── deduplication.service.ts  # Unified deduplication/idempotency
│   ├── ingestion/              # API ingestion endpoints
│   ├── orchestration/          # Workflow orchestration
│   ├── delegation/             # SQS delegation
│   ├── callback/               # Worker callbacks & Kafka publishing
│   ├── kafka/                  # Kafka event handlers & auto-triggers
│   ├── jobs/                   # Job queries
│   └── health/                 # Health check module
├── test/                       # E2E tests
├── dataSource.ts              # TypeORM data source
└── package.json
```

## Adding New Modules

```bash
# Generate a new module
nest g module my-module

# Generate a controller
nest g controller my-module

# Generate a service
nest g service my-module
```

## Environment Variables

The orchestrator uses the following environment variables (configured via `.env` in project root):

**Database:**
- `DTM_DB_HOST - Orchestrator database hostname
- `DTM_DB_PORT - Orchestrator database port
- `DTM_DB_USER - Database username
- `DTM_DB_PASSWORD - Database password
- `DTM_DB_NAME - Database name

**Application:**
- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 3000)
- `LOG_FORMAT` - Log format (`json` or default/text) for CloudWatch compatibility

**Kafka:**
- `KAFKA_BROKER` - Kafka broker address (e.g., kafka:29092)

**Feature Flags:**
- `ENABLE_DEDUPLICATION` - Enable/disable deduplication service (true/false)
- `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` - Enable/disable simulated delays for workers (true/false)

**AWS/LocalStack:**
- `AWS_SQS_ENDPOINT` - SQS endpoint for Lambda delegation
- `ORCHESTRATOR_CALLBACK_URL` - Callback URL for workers

See [Features Documentation](../../docs/guides/FEATURES.md) for detailed configuration guide.

## API Documentation

When running, the API is available at:

- Development: http://localhost:3000 (container) / http://localhost:3002 (host)

## Testing

```bash
# Unit tests
pnpm run test

# E2E tests
pnpm run test:e2e

# Test coverage
pnpm run test:cov
```

## More Information

See the main project [documentation](../../docs/) for more details on:

- Docker deployment
- Database migrations
- Troubleshooting
