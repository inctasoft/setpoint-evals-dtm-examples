import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Job event status enum (maps to internal job status)
 */
export enum JobEventStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Response DTO for job event status
 * GET /api/v1/jobs/{jobId}/status
 */
export class EventStatusResponseDto {
  @ApiProperty({
    description: 'Job ID (UUID)',
    example: '15dc74ca-fca6-4bde-879f-b0afaa3e8d8c',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Current job status',
    enum: JobEventStatus,
    example: 'IN_PROGRESS',
  })
  status!: JobEventStatus;

  @ApiProperty({
    description: 'Job started timestamp (ISO 8601)',
    example: '2026-04-15T10:00:00Z',
  })
  startedAt!: string;

  @ApiPropertyOptional({
    description: 'Job completed timestamp (ISO 8601)',
    example: '2026-04-15T10:30:00Z',
  })
  completedAt?: string | null;

  @ApiPropertyOptional({
    description: 'Current step being executed',
    example: 'ValidateCustomer',
  })
  currentStep?: string;
}

/**
 * Progress details object
 */
export class ProgressDetailsDto {
  @ApiProperty({
    description: 'Total number of steps to process',
    example: 7,
  })
  totalSteps!: number;

  @ApiProperty({
    description: 'Number of steps completed',
    example: 3,
  })
  completedSteps!: number;

  @ApiProperty({
    description: 'Percentage complete (0-100)',
    example: 42,
  })
  percentComplete!: number;
}

/**
 * Response DTO for job event progress
 * GET /api/v1/jobs/{jobId}/progress
 */
export class EventProgressResponseDto extends EventStatusResponseDto {
  @ApiProperty({
    description: 'Job progress details',
    type: ProgressDetailsDto,
  })
  progress!: ProgressDetailsDto;

  @ApiProperty({
    description: 'URL to track job status',
    example: '/jobs/15dc74ca-fca6-4bde-879f-b0afaa3e8d8c/status',
  })
  trackingUrl!: string;
}
