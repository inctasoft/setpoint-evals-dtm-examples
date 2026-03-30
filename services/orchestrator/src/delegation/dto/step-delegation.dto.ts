import { IsString, IsObject, IsEnum, IsUUID, IsOptional } from 'class-validator';
import { JobType } from '@dtm/database';

/**
 * DTO for delegating a single step to a Lambda worker
 *
 * stepValue: The enum string value (e.g., 'ValidateCustomer', 'SubmitCustomer') identifying the step
 * sourceConfig: Source system configuration (connection details, table, filter key)
 * processingConfig: Processing definitions (data type, transformation list)
 *
 * Note: Each worker is dedicated to one action type - the queue assignment determines the worker's behavior.
 * The presence of sourceConfig vs processingConfig indicates the step type.
 */
export class StepDelegationDto {
  @IsUUID()
  jobId!: string;

  @IsUUID()
  stepId!: string;

  @IsString()
  stepValue!: string; // String enum value (e.g., 'ValidateCustomer')

  @IsString()
  queueName!: string;

  @IsEnum(JobType)
  jobType!: JobType;

  @IsObject()
  input!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sourceConfig?: {
    sourceDatabase: string;
    sourceTable: string;
    filterKey: string;
  };

  @IsOptional()
  @IsObject()
  processingConfig?: {
    inputDataType: string;
    transformations: string[];
  };
}

/**
 * Source Configuration interface
 */
export interface SourceConfig {
  sourceDatabase: string;
  sourceTable: string;
  filterKey: string;
}

/**
 * Processing Configuration interface
 */
export interface ProcessingConfig {
  inputDataType: string;
  transformations: string[];
}

/**
 * Result of delegating a step to Lambda
 */
export interface DelegationResult {
  stepId: string;
  success: boolean;
  sqsMessageId?: string;
  error?: string;
}

/**
 * Bulk delegation result
 */
export interface BulkDelegationResult {
  totalSteps: number;
  successfulDelegations: number;
  failedDelegations: number;
  results: DelegationResult[];
}
