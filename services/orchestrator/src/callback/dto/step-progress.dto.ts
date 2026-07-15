import { IsString, IsEnum, IsObject, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { StepStatus } from '@dtm/database';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Retry metadata from SQS message attributes
 * Sent by Lambda workers to track execution attempts
 */
export interface RetryMetadata {
  sqsMessageId: string;
  sqsReceiveCount: number; // How many times SQS has delivered this message
  processingTimeMs: number;
  isRetry: boolean; // True if receiveCount > 1
}

/**
 * DTO for Lambda workers to report step progress
 * Lambda sends this payload via HTTP POST to /api/callback/step-progress
 */
export class StepProgressDto {
  @ApiProperty({ description: 'Job ID' })
  @IsUUID()
  jobId!: string;

  @ApiProperty({ description: 'Step ID' })
  @IsUUID()
  stepId!: string;

  @ApiProperty({
    description: 'Step status',
    enum: StepStatus,
    example: StepStatus.IN_PROGRESS,
  })
  @IsEnum(StepStatus)
  status!: StepStatus;

  @ApiProperty({
    description: 'Step output data (only for completed steps)',
    required: false,
  })
  @IsOptional()
  @IsObject()
  output?: Record<string, unknown>;

  @ApiProperty({
    description: 'Error message (only for failed steps)',
    required: false,
  })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiProperty({
    description: 'Number of records successfully processed',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  recordsProcessed?: number;

  @ApiProperty({
    description: 'Number of records that failed processing',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  recordsFailed?: number;

  @ApiProperty({
    description: 'Additional progress message',
    required: false,
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({
    description: 'Data reference for passing data between workers (e.g., database table pointer)',
    required: false,
    example: {
      type: 'database_table',
      table: 'customers_snapshot',
      metadata: { entity_id: 'ENT-9001', record_count: 5 },
    },
  })
  @IsOptional()
  @IsObject()
  dataReference?: {
    type: 'database_table' | 'database_batch' | 'sqs_queue';
    table?: string;
    batchId?: string;
    queueUrl?: string;
    metadata?: Record<string, unknown>;
  };

  @ApiProperty({
    description: 'Retry metadata from SQS message attributes (for tracking execution attempts)',
    required: false,
    example: {
      sqsMessageId: 'abc123',
      sqsReceiveCount: 2,
      processingTimeMs: 1234,
      isRetry: true,
    },
  })
  @IsOptional()
  @IsObject()
  retryMetadata?: RetryMetadata;
}

/**
 * Response DTO after receiving step progress
 */
export class StepProgressResponseDto {
  @ApiProperty({ description: 'Whether the progress was successfully recorded' })
  success!: boolean;

  @ApiProperty({ description: 'Response message' })
  message!: string;

  @ApiProperty({
    description: 'Job ID',
    required: false,
  })
  @IsOptional()
  jobId?: string;

  @ApiProperty({
    description: 'Step ID',
    required: false,
  })
  @IsOptional()
  stepId?: string;
}
