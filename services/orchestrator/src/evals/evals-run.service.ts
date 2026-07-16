import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WorkflowJobService } from '../ingestion/workflow-job.service';
import { InitiateWorkflowJobDto } from '../ingestion/dto/initiate-workflow-job.dto';
import { EvalsDiscoveryService } from './evals-discovery.service';
import { EvalSummary } from './evals.types';

/** `<uuidgen per run>`, `<id from createClientViaDispatcher>`, etc — the SE-README templating convention (docs/setpoint-eval-conventions.md). */
const TEMPLATE_PLACEHOLDER = /^<.*>$/;

/** `POST /workflows/order-processing/jobs` (mermaid) or "POSTed to .../workflows/order-processing/jobs" (prose). */
const WORKFLOW_TOKEN_RE = /workflows\/([a-z0-9-]+)\/jobs/;

/**
 * core-suite job payloads never carry an explicit `workflowName` field (verified
 * against the estate at build time — see PR body) — every one that posts a job
 * targets order-processing. Used only when the README prose/mermaid doesn't
 * carry an explicit `/workflows/<name>/jobs` token either.
 */
const CORE_SUITE_DEFAULT_WORKFLOW = 'order-processing';

@Injectable()
export class EvalsRunService {
  private readonly logger = new Logger(EvalsRunService.name);

  constructor(
    private readonly discovery: EvalsDiscoveryService,
    private readonly workflowJobService: WorkflowJobService,
    private readonly configService: ConfigService,
  ) {}

  /** Recursively replace README template placeholders (e.g. "<uuidgen per run>") with a fresh uuid. */
  private freshenPlaceholders<T>(value: T): T {
    if (typeof value === 'string') {
      return (TEMPLATE_PLACEHOLDER.test(value) ? crypto.randomUUID() : value) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.freshenPlaceholders(v)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.freshenPlaceholders(v);
      }
      return out as unknown as T;
    }
    return value;
  }

  private resolveWorkflowName(evalItem: EvalSummary): string {
    if (evalItem.suite !== 'core') {
      return evalItem.suite;
    }
    const token = evalItem.readme ? WORKFLOW_TOKEN_RE.exec(evalItem.readme) : null;
    return token ? token[1] : CORE_SUITE_DEFAULT_WORKFLOW;
  }

  async run(suite: string, id: string): Promise<{ jobId: string }> {
    if (!this.configService.get<boolean>('evals.enableRunApi')) {
      throw new ForbiddenException(
        'Eval run API is disabled (ENABLE_EVAL_RUN_API=false) — dev-only endpoint.',
      );
    }

    const evalItem = this.discovery.getEval(suite, id);
    if (!evalItem) {
      throw new NotFoundException(`Eval '${suite}/${id}' not found`);
    }

    if (!evalItem.payload || evalItem.payload.parseError || !evalItem.payload.json) {
      throw new UnprocessableEntityException(
        !evalItem.payload
          ? `Eval '${suite}/${id}' has no "## Payload" section — nothing to run (e.g. schema/leader-election SEs with no job to replay).`
          : `Eval '${suite}/${id}' has a malformed "## Payload" JSON block: ${evalItem.payload.parseError}`,
      );
    }

    const workflowName = this.resolveWorkflowName(evalItem);
    // Server-parsed only: the DTO comes entirely from the README's own committed
    // Payload block (placeholders freshened), never from a client-supplied body —
    // POST /evals/:suite/:id/run takes no request body.
    const dto = this.freshenPlaceholders(
      evalItem.payload.json,
    ) as unknown as InitiateWorkflowJobDto;

    this.logger.log(`Running eval ${suite}/${id} -> POST /workflows/${workflowName}/jobs`);
    const result = await this.workflowJobService.initiateWorkflowJob(workflowName, dto);
    return { jobId: result.jobId };
  }
}
