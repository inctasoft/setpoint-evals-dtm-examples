# Error Handling Package

This package provides centralized error handling for the DTM orchestrator, including HTTP error filters, utilities for non-HTTP errors, and custom exception classes.

## Components

### 1. GlobalErrorFilter

A global exception filter that catches all exceptions (both `HttpException` and non-HTTP errors) and provides centralized error handling and logging.

**Registration** (already done in `main.ts`):
```typescript
import { GlobalErrorFilter } from '../../error';
app.useGlobalFilters(new GlobalErrorFilter());
```

**Features:**
- Catches all exceptions automatically
- Returns consistent error response format: `{ code, message, details? }`
- Logs errors with context (method, URL, status, code)
- Handles both custom exceptions and NestJS HttpExceptions
- Ready for DataDog integration (TODO placeholder included)

### 2. ErrorHandler

Utility class for handling errors outside of HTTP request/response context (scheduled tasks, background jobs, event handlers, etc.).

**Usage:**
```typescript
import { ErrorHandler } from '../../error';

try {
  await someAsyncOperation();
} catch (error) {
  ErrorHandler.catch(error, 'ScheduledTask');
}
```

### 3. Custom Exception Classes

Application-specific exception classes that extend `HttpException` and provide consistent error handling.

**Available Exceptions:**

- `AppError` - Base exception class (non-HTTP)
- `HttpException` - Base HTTP exception class
- `ValidationException` - For validation errors (400)
- `NotFoundException` - For resource not found (404)
- `UnauthorizedException` - For unauthorized access (401)
- `ForbiddenException` - For forbidden access (403)
- `InternalServerErrorException` - For internal server errors (500)
- `DatabaseException` - For database errors (500)

## Usage Examples

### In Controllers

```typescript
import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { NotFoundException, ValidationException } from '../../error';

@Controller('users')
export class UsersController {
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }
    return user;
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    if (!createUserDto.email) {
      throw new ValidationException('Email is required');
    }
    return this.usersService.create(createUserDto);
  }
}
```

### In Services

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  DatabaseException,
} from '../../error';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User', id);
    }
    return user;
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      return await this.usersRepository.save(createUserDto);
    } catch (error) {
      throw new DatabaseException('Failed to create user', {
        cause: error.message,
      });
    }
  }
}
```

### For Scheduled Tasks / Background Jobs

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ErrorHandler } from '../../error';

@Injectable()
export class ScheduledTasksService {
  @Cron(CronExpression.EVERY_HOUR)
  async processHourlyTask() {
    try {
      // Your task logic here
      await this.processData();
    } catch (error) {
      ErrorHandler.catch(error, 'HourlyTask');
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processDailyTask() {
    try {
      await this.processDailyData();
    } catch (error) {
      ErrorHandler.catch(error, 'DailyTask');
    }
  }
}
```

### For Kafka Consumers / Message Handlers

```typescript
import { Injectable } from '@nestjs/common';
import { ErrorHandler } from '../../error';

@Injectable()
export class KafkaConsumerService {
  async handleMessage(message: any) {
    try {
      await this.processMessage(message);
    } catch (error) {
      ErrorHandler.catch(error, 'KafkaMessageHandler');
      // Optionally re-throw if you want to handle retries
      throw error;
    }
  }
}
```

### Custom AppError Usage

For non-HTTP errors that need structured error codes:

```typescript
import { AppError, ErrorCode } from '../../error';

// In a service method
async processData(data: any) {
  if (!data.isValid) {
    throw new AppError('Data validation failed', ErrorCode.VALIDATION, {
      field: 'data',
      reason: 'Invalid format',
    });
  }
}
```

## Response Format

The `GlobalErrorFilter` returns a consistent error response format:

**With details:**
```json
{
  "code": "NOT_FOUND",
  "message": "User with identifier '123' not found",
  "details": {
    "resource": "User",
    "identifier": "123"
  }
}
```

**Without details:**
```json
{
  "code": "VALIDATION",
  "message": "Email is required"
}
```

