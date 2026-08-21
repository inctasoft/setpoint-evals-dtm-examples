import { ApiProperty } from '@nestjs/swagger';

/**
 * Base interface for transformed data events
 * Contains metadata about the transformation
 */
interface TransformedDataEventBase {
  jobId: string;
  stepId: string;
  tableName: string;
  recordCount: number;
  transformedAt: Date;
  eventTimestamp: Date;
  requiresAcknowledgement?: boolean;
  testOptions?: Record<string, unknown>;
}

/**
 * Generic Transformed Data Event
 * Published to: dtm.jobs.completed
 * Contains transformed data from any workflow step
 */
export class TransformedDataEvent implements TransformedDataEventBase {
  @ApiProperty({
    description: 'Job ID (UUID)',
    example: '7c87dd48-a439-4542-b5a9-6665a523bdac',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Step ID that produced this data (UUID)',
    example: '8d98ee59-b54a-5653-c6ba-7776b634cebd',
  })
  stepId!: string;

  @ApiProperty({
    description: 'Entity type name (e.g., "customer", "order", "device")',
    example: 'customer',
  })
  tableName!: string;

  @ApiProperty({
    description: 'Number of records in the data array',
    example: 4,
  })
  recordCount!: number;

  @ApiProperty({
    description: 'When the processing completed',
    example: '2025-11-14T15:30:00.000Z',
  })
  transformedAt!: Date;

  @ApiProperty({
    description: 'When this event was published',
    example: '2025-11-14T15:30:01.000Z',
  })
  eventTimestamp!: Date;

  @ApiProperty({
    description: 'Whether this event requires acknowledgement',
    example: true,
    required: false,
  })
  requiresAcknowledgement?: boolean;

  @ApiProperty({
    description: 'Test options (simulated delays + feature flags) for dev/testing',
    required: false,
  })
  testOptions?: Record<string, unknown>;

  @ApiProperty({
    description: 'Array of processed data records',
    example: [{ id: 'record-1', status: 'COMPLETE' }],
  })
  data!: Array<Record<string, unknown>>;
}

/**
 * Union type for all transformed events
 */
export type TransformedEvent = TransformedDataEvent;

/**
 * Processing Failed Event
 * Published to: dtm.jobs.failed
 * Contains error details for failed processing
 */
export class TransformationFailedEvent {
  @ApiProperty({
    description: 'Job ID (UUID)',
    example: '7c87dd48-a439-4542-b5a9-6665a523bdac',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Step ID that failed (UUID)',
    example: '8d98ee59-b54a-5653-c6ba-7776b634cebd',
  })
  stepId!: string;

  @ApiProperty({
    description: 'Entity type that failed to process',
    example: 'customer',
  })
  tableName!: string;

  @ApiProperty({
    description: 'Error message',
    example: 'Processing failed: Invalid data format',
  })
  error!: string;

  @ApiProperty({
    description: 'Number of records that failed to process',
    example: 4,
  })
  recordsFailed!: number;

  @ApiProperty({
    description: 'When the processing failed',
    example: '2025-11-14T15:30:00.000Z',
  })
  failedAt!: Date;

  @ApiProperty({
    description: 'When this event was published',
    example: '2025-11-14T15:30:01.000Z',
  })
  eventTimestamp!: Date;
}
