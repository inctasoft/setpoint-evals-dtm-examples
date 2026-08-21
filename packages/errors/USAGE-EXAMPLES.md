# Error Package Usage Examples

## Lambda Functions

### Basic Error Handling with LambdaErrorHandler

```typescript
// lambda/src/handlers/create-job.ts
import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  ValidationError,
  ExternalServiceError,
} from '@dtm/errors';
import { LambdaErrorHandler } from '../utils/error-handler';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // Parse and validate input
    const body = JSON.parse(event.body || '{}');
    
    if (!body.entityIds || !Array.isArray(body.entityIds)) {
      throw new ValidationError('entityIds must be an array', {
        received: typeof body.entityIds,
      });
    }

    if (body.entityIds.length === 0) {
      throw new ValidationError('entityIds cannot be empty');
    }

    // External service call with error handling
    try {
      await sendToQueue(queueUrl, body);
    } catch (error) {
      throw new ExternalServiceError('Failed to send message to queue', {
        queueUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      statusCode: 202,
      body: JSON.stringify({ 
        message: 'Job started successfully',
        entityCount: body.entityIds.length,
      }),
    };
  } catch (error) {
    console.error('Create job failed:', error);
    // Centralized error handling that returns proper API Gateway response
    return LambdaErrorHandler.handleApiError(error, 'CreateJob');
  }
};
```

### SQS Lambda with Error Handling

```typescript
// lambda/src/handlers/etl-transform.ts
import { SQSHandler } from 'aws-lambda';
import { ExternalServiceError } from '@dtm/errors';
import { LambdaErrorHandler } from '../utils/error-handler';

export const handler: SQSHandler = async (event) => {
  console.log(`Processing ${event.Records.length} message(s)`);

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error('Error processing record:', error);
      // Re-throw to trigger SQS retry/DLQ mechanism
      LambdaErrorHandler.handleSqsError(error, 'ETLTransform');
    }
  }
};

async function processRecord(record: any): Promise<void> {
  const message = JSON.parse(record.body);

  // Transform data
  const transformed = transformData(message.data);

  // Send to next queue with error handling
  try {
    await sendToLoadQueue(transformed);
  } catch (error) {
    throw new ExternalServiceError('Failed to send to Load queue', {
      entityId: transformed.entity_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

### Database Errors in Lambda

```typescript
// lambda/src/handlers/etl-extract.ts
import { SQSHandler } from 'aws-lambda';
import { Pool } from 'pg';
import { DatabaseError, InternalServerError } from '@dtm/errors';

const pool = new Pool({
  host: process.env.ORDER_PROCESSING_DB_HOST,
  port: Number(process.env.ORDER_PROCESSING_DB_PORT),
  database: process.env.ORDER_PROCESSING_DB_NAME,
});

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    try {
      const { entityId } = JSON.parse(record.body);
      
      // Query database
      const result = await pool.query(
        'SELECT * FROM dbo.entity WHERE entity_id = $1',
        [entityId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Entity', entityId);
      }

      // Process the data...
      
    } catch (error) {
      // Categorize database errors
      if (error.code?.startsWith('08')) {
        // Connection error
        throw new DatabaseError('Database connection failed', {
          originalError: error.message,
          code: error.code,
        });
      }

      if (error.code === '42P01') {
        // Table doesn't exist
        throw new DatabaseError('Required table not found', {
          originalError: error.message,
        });
      }

      // Re-throw our errors as-is
      if (error instanceof HttpError) {
        throw error;
      }

      // Wrap unknown errors
      throw new InternalServerError('Failed to extract data', {
        originalError: error.message,
      });
    }
  }
};
```

### Error Logging in Lambda

```typescript
// lambda/src/utils/error-logger.ts
import { AppError } from '@dtm/errors';

export function logError(error: unknown, context: string): void {
  if (error instanceof AppError) {
    console.error(JSON.stringify({
      context,
      timestamp: error.timestamp.toISOString(),
      code: error.code,
      message: error.message,
      details: error.details,
      stack: error.stack,
    }));
  } else {
    console.error(JSON.stringify({
      context,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
  }
}

// Usage in handlers
try {
  // ... your code
} catch (error) {
  logError(error, 'CreateJobHandler');
  throw error;
}
```

## React / Front-End

### API Error Handling with Axios

```typescript
// apps/monitor/src/utils/api-client.ts
import axios, { AxiosError } from 'axios';
import { AppError, ErrorCode, HttpStatus } from '@dtm/errors';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3002',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor to handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Network error
    if (!error.response) {
      throw new AppError(
        'Network error - please check your connection',
        ErrorCode.INTERNAL_SERVER_ERROR,
        { originalError: error.message }
      );
    }

    // API returned an error
    const { status, data } = error.response;
    const errorData = data as any;

    // Create appropriate error based on status
    throw new AppError(
      errorData?.message || 'An error occurred',
      errorData?.code || ErrorCode.INTERNAL_SERVER_ERROR,
      {
        status,
        details: errorData?.details,
      }
    );
  }
);

export default apiClient;
```

### React Hook for Error Handling

```typescript
// front-end/src/hooks/useApiError.tsx
import { useState, useCallback } from 'react';
import { AppError, ErrorCode } from '@dtm/errors';

interface ErrorState {
  message: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

export function useApiError() {
  const [error, setError] = useState<ErrorState | null>(null);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof AppError) {
      setError({
        message: err.message,
        code: err.code,
        details: err.details,
      });
    } else {
      setError({
        message: err instanceof Error ? err.message : 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_SERVER_ERROR,
      });
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { error, handleError, clearError };
}
```

### React Component with Error Handling

```typescript
// front-end/src/components/JobForm.tsx
import React, { useState } from 'react';
import { Alert, Button, TextField, Box } from '@mui/material';
import apiClient from '../utils/api-client';
import { useApiError } from '../hooks/useApiError';
import { ValidationError } from '@dtm/errors';

export const JobForm: React.FC = () => {
  const [entityIds, setEntityIds] = useState('');
  const [loading, setLoading] = useState(false);
  const { error, handleError, clearError } = useApiError();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    // Client-side validation
    const ids = entityIds.split(',').map(id => id.trim()).filter(Boolean);
    
    if (ids.length === 0) {
      handleError(new ValidationError('Please enter at least one entity ID'));
      return;
    }

    setLoading(true);

    try {
      const response = await apiClient.post('/jobs', {
        entityIds: ids,
      });

      console.log('Job started:', response.data);
      // Handle success...
      
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 2 }}>
          <strong>{error.code}:</strong> {error.message}
          {error.details && (
            <pre>{JSON.stringify(error.details, null, 2)}</pre>
          )}
        </Alert>
      )}

      <TextField
        fullWidth
        label="Entity IDs (comma-separated)"
        value={entityIds}
        onChange={(e) => setEntityIds(e.target.value)}
        disabled={loading}
        sx={{ mb: 2 }}
      />

      <Button
        type="submit"
        variant="contained"
        disabled={loading}
      >
        {loading ? 'Starting Job...' : 'Start Job'}
      </Button>
    </Box>
  );
};
```

### Error Boundary Component

```typescript
// front-end/src/components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Box } from '@mui/material';
import { AppError, ErrorCode } from '@dtm/errors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: AppError | Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    
    // Log to monitoring service (e.g., Sentry, DataDog)
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const error = this.state.error;
      const isAppError = error instanceof AppError;

      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">
            <h3>Something went wrong</h3>
            <p>
              {isAppError
                ? `${error.code}: ${error.message}`
                : error.message}
            </p>
            {isAppError && error.details && (
              <details>
                <summary>Error Details</summary>
                <pre>{JSON.stringify(error.details, null, 2)}</pre>
              </details>
            )}
          </Alert>
          <Button
            onClick={this.handleReset}
            variant="outlined"
            sx={{ mt: 2 }}
          >
            Try Again
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

// Usage
// <ErrorBoundary>
//   <App />
// </ErrorBoundary>
```

## Common Patterns

### Validate and Throw

```typescript
import { ValidationError } from '@dtm/errors';

function validateJobInput(data: any) {
  if (!data.entityIds) {
    throw new ValidationError('entityIds is required');
  }

  if (!Array.isArray(data.entityIds)) {
    throw new ValidationError('entityIds must be an array', {
      received: typeof data.entityIds,
    });
  }

  if (data.entityIds.length > 100) {
    throw new ValidationError('Cannot process more than 100 entities at once', {
      count: data.entityIds.length,
      max: 100,
    });
  }

  return true;
}
```

### Wrap External Errors

```typescript
import { DatabaseError, InternalServerError } from '@dtm/errors';

async function queryDatabase(query: string) {
  try {
    return await pool.query(query);
  } catch (error) {
    if (error.code) {
      // PostgreSQL error
      throw new DatabaseError(`Database query failed: ${error.message}`, {
        code: error.code,
        query: query.substring(0, 100), // First 100 chars
      });
    }
    throw new InternalServerError('Unexpected database error', {
      originalError: error.message,
    });
  }
}
```

### Convert Errors for API Responses

```typescript
import { HttpError, HttpStatus } from '@dtm/errors';

function errorToApiResponse(error: unknown) {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      body: JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          timestamp: error.timestamp,
        },
      }),
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    body: JSON.stringify({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'An error occurred',
      },
    }),
  };
}
```

