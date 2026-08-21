# @dtm/errors

Framework-agnostic error handling package for DTM (Distributed Task Manager).

## Features

- 🎯 **Framework-agnostic core**: Use in any JavaScript/TypeScript project
- 🌐 **Browser-safe**: Separate entry point for browser environments
- 🚀 **NestJS integration**: Optional adapters for NestJS applications
- 📦 **Type-safe**: Full TypeScript support with strict typing
- 🔍 **Structured logging**: Built-in logger interface with console implementation

## Usage

### Browser / React / Vite (Dashboard)

For browser environments, the package automatically uses a browser-safe entry point that excludes Node.js-specific code:

```typescript
import { AppError, ErrorCode, HttpStatus } from '@dtm/errors';

// Use core error classes (browser-safe)
throw new AppError('Something went wrong', ErrorCode.INTERNAL_SERVER_ERROR);
```

**Note:** The browser entry point does NOT include NestJS-specific exports (`GlobalErrorFilter`, `ErrorHandler`) as they require Node.js globals.

### Node.js / NestJS (Orchestrator, Lambda)

For Node.js environments, all features are available including NestJS adapters:

```typescript
import {
  AppError,
  ErrorCode,
  GlobalErrorFilter,
  ErrorHandler,
} from '@dtm/errors';

// Use NestJS adapters
@Catch()
export class MyFilter extends GlobalErrorFilter {}
```

## Package Exports

The package uses conditional exports based on the environment:

```json
{
  "exports": {
    ".": {
      "browser": "./dist/browser.js",  // Browser-safe (excludes NestJS)
      "import": "./dist/index.js",      // Node.js ESM
      "require": "./dist/index.js",     // Node.js CommonJS
      "default": "./dist/index.js"      // Fallback
    }
  }
}
```

## Available Exports

### Browser & Node.js (Common)

- `ErrorCode` - Enum of standard error codes
- `AppError` - Base error class
- `HttpStatus` - HTTP status constants
- `HttpStatusCode` - HTTP status code type
- `HttpError`, `ValidationError`, `NotFoundError`, etc. - Specific error classes
- `ILogger`, `ConsoleLogger` - Logging utilities

### Node.js Only

- `GlobalErrorFilter` - NestJS global exception filter
- `ErrorHandler` - NestJS error handler service

## Development

```bash
# Build the package
pnpm build

# Watch mode
pnpm build:watch

# Lint
pnpm lint:check
pnpm lint:fix

# Format
pnpm format:check
pnpm format:fix
```

## Architecture

```
packages/errors/
├── src/
│   ├── index.ts           # Full exports (Node.js)
│   ├── browser.ts         # Browser-safe exports
│   ├── core/              # Framework-agnostic core
│   ├── http/              # HTTP error utilities
│   ├── nestjs/            # NestJS adapters (Node.js only)
│   └── utils/             # Shared utilities
└── dist/                  # Compiled output
    ├── index.js           # Node.js entry point
    └── browser.js         # Browser entry point
```
