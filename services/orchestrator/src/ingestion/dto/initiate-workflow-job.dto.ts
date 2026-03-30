import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsNumber,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Test options for a SINGLE step. All fields are optional.
 * Applied by the step name key in the TestOptions map.
 *
 * Security: All simulation features require ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
 */
export class TestOptionSetDto {
  @ApiPropertyOptional({
    description: 'Simulate processing delay (milliseconds). Worker sleeps before doing real work.',
    example: 300,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  simDelay?: number;

  @ApiPropertyOptional({
    description:
      'Simulate failure after this many milliseconds. ' +
      'Worker starts processing, then throws an error after this delay. ' +
      'Without failOnAttempts: ALL attempts fail -> DLQ.',
    example: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  failureAfter?: number;

  @ApiPropertyOptional({
    description:
      'Which retry attempts should fail (1-indexed). ' +
      '[1] = fail first, succeed on retry. [1,2,3] = fail all -> DLQ. ' +
      'Requires failureAfter to be set.',
    example: [1, 2],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  failOnAttempts?: number[];

  @ApiPropertyOptional({
    description:
      'For fan-out steps: only fail for these specific item IDs. ' +
      'Other items will succeed. Use to test partial failure.',
    example: ['100022'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failForItemIds?: string[];

  @ApiPropertyOptional({
    description:
      'Delay before sending ACK (milliseconds). ' +
      'Simulates slow external system processing. Only for steps with requiresAcknowledgement.',
    example: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  ackDelay?: number;

  @ApiPropertyOptional({
    description:
      'Skip ACK entirely. Step remains in WAITING_FOR_ACK forever. ' +
      'Tests stuck-ack detection and recovery. Non-destructive.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  skipAck?: boolean;

  @ApiPropertyOptional({
    description:
      'Simulate a crash before sending ACK. Unlike skipAck, this abruptly terminates handling. ' +
      'Tests crash recovery + stuck-ack-recovery in combination.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  crashBeforeAck?: boolean;

  @ApiPropertyOptional({
    description:
      'Custom ACK payload fields (merged over defaults). ' +
      'Overrides the simulator auto-generated fields. ' +
      'Use to test specific FK values, error responses, or corrupt data handling.',
    example: { ext_consumer_id: 'EXT-12345', processing_status: 'verified' },
  })
  @IsOptional()
  @IsObject()
  ackPayload?: Record<string, unknown>;
}

/**
 * DTO for initiating a generic workflow job
 * POST /api/v1/workflows/:workflowName/jobs
 *
 * This endpoint is workflow-agnostic. The workflowName in the URL path
 * determines which workflow definition to use. The request body provides
 * the entity identifier, optional variant, payload, and test options.
 */
export class InitiateWorkflowJobDto {
  @ApiPropertyOptional({
    description:
      'Workflow variant to use (e.g., "membership", "membership_batch"). ' +
      'If not provided, the workflow\'s default variant is used. ' +
      'Each workflow defines its own set of variants with different step DAGs.',
    example: 'default',
  })
  @IsOptional()
  @IsString()
  variant?: string;

  @ApiPropertyOptional({
    description:
      'Additional payload data passed to all step workers. ' +
      'Contents are workflow-specific (e.g., customerId/orderId for order-processing).',
    example: { customerId: 1, orderId: 101 },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Per-step test options keyed by step name. Each key is a step name and the value ' +
      'contains simulation options (delays, failures, ACK behavior) for that step.\n\n' +
      'Security: Simulated delays/failures require ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true.',
  })
  @IsOptional()
  @IsObject()
  testOptions?: Record<string, TestOptionSetDto>;

  @ApiPropertyOptional({
    description:
      'Per-request feature flag overrides. Keys are flag names, values are flag values. ' +
      "Only flags listed in the workflow's clientOverridable allowlist can be overridden. " +
      'Requires ENABLE_REQUEST_FEATURE_FLAGS=true on the server.',
    example: { enableDeduplication: true },
  })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Per-request deduplication override. ' +
      'Priority: this field > ENABLE_DEDUPLICATION env var.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  enableDeduplication?: boolean;

  @ApiPropertyOptional({
    description:
      'Caller-defined key for deduplication matching. ' +
      'If not provided and deduplication is enabled, a hash of the payload is used.',
    example: 'ORDER-001',
  })
  @IsOptional()
  @IsString()
  deduplicationKey?: string;

  @ApiPropertyOptional({
    description: 'Who/what is submitting this job. Defaults to "api".',
    example: 'api',
  })
  @IsOptional()
  @IsString()
  submittedBy?: string;
}

/**
 * Response DTO for generic workflow job initiation
 */
export class InitiateWorkflowJobResponseDto {
  @ApiProperty({
    description: 'Created job ID (UUID)',
    example: '15dc74ca-fca6-4bde-879f-b0afaa3e8d8c',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Workflow name that was used',
    example: 'order-processing',
  })
  workflowName!: string;

  @ApiProperty({
    description: 'Variant that was resolved',
    example: 'default',
  })
  variant!: string;
}
