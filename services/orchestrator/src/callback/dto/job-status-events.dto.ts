import { ApiProperty } from '@nestjs/swagger';
import { JobType, JobStatus } from '@dtm/database';

/**
 * Simplified Job Completed Event
 * Published to: dtm.jobs.completed
 * Contains only job-level status, no step details or transformed data
 * Transformed data is published separately to table-specific topics
 */
export class JobCompletedEvent {
  @ApiProperty({
    description: 'Job ID (UUID)',
    example: '7c87dd48-a439-4542-b5a9-6665a523bdac',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Job type (variant)',
    enum: ['default', 'quick-order'],
    example: 'default',
  })
  type!: JobType;

  @ApiProperty({
    description: 'Job status (always "completed" for this event)',
    example: 'completed',
  })
  status!: JobStatus;

  @ApiProperty({
    description: 'Who submitted the job',
    example: 'api',
  })
  submittedBy!: string;

  @ApiProperty({
    description: 'When the job was submitted',
    example: '2025-11-14T15:25:00.000Z',
  })
  submittedAt!: Date;

  @ApiProperty({
    description: 'When the job started processing',
    example: '2025-11-14T15:25:05.000Z',
    required: false,
  })
  startedAt?: Date;

  @ApiProperty({
    description: 'When the job completed',
    example: '2025-11-14T15:30:30.000Z',
    required: false,
  })
  completedAt?: Date;

  @ApiProperty({
    description: 'Duration in milliseconds',
    example: 325000,
  })
  durationMs!: number;

  @ApiProperty({
    description: 'Summary of records processed across all steps',
    example: {
      totalRecordsProcessed: 5,
      totalRecordsFailed: 0,
    },
  })
  summary!: {
    totalRecordsProcessed: number;
    totalRecordsFailed: number;
  };

  @ApiProperty({
    description: 'When this event was published',
    example: '2025-11-14T15:30:31.000Z',
  })
  eventTimestamp!: Date;
}

/**
 * Simplified Job Failed Event
 * Published to: dtm.jobs.failed
 * Contains only job-level error information
 */
export class JobFailedEvent {
  @ApiProperty({
    description: 'Job ID (UUID)',
    example: '7c87dd48-a439-4542-b5a9-6665a523bdac',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Job type (variant)',
    enum: ['default', 'quick-order'],
    example: 'default',
  })
  type!: JobType;

  @ApiProperty({
    description: 'Job status (always "failed" for this event)',
    example: 'failed',
  })
  status!: JobStatus;

  @ApiProperty({
    description: 'Who submitted the job',
    example: 'api',
  })
  submittedBy!: string;

  @ApiProperty({
    description: 'When the job was submitted',
    example: '2025-11-14T15:25:00.000Z',
  })
  submittedAt!: Date;

  @ApiProperty({
    description: 'When the job started processing',
    example: '2025-11-14T15:25:05.000Z',
    required: false,
  })
  startedAt?: Date;

  @ApiProperty({
    description: 'When the job failed',
    example: '2025-11-14T15:26:30.000Z',
    required: false,
  })
  failedAt?: Date;

  @ApiProperty({
    description: 'Duration in milliseconds before failure',
    example: 85000,
  })
  durationMs!: number;

  @ApiProperty({
    description: 'Error message',
    example: 'ValidateCustomer step failed: No customer found for customer_id 99999',
  })
  error!: string;

  @ApiProperty({
    description: 'Summary of records processed before failure',
    example: {
      totalRecordsProcessed: 0,
      totalRecordsFailed: 4,
    },
  })
  summary!: {
    totalRecordsProcessed: number;
    totalRecordsFailed: number;
  };

  @ApiProperty({
    description: 'When this event was published',
    example: '2025-11-14T15:26:31.000Z',
  })
  eventTimestamp!: Date;
}
