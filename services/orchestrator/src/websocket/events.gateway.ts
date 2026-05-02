import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { JobRepository, StepRepository, JobStatus } from '@dtm/database';
import type { DtmEvent, JobSnapshot, StepSnapshot } from './dtm-event.types';

const NON_TERMINAL_STATUSES = [JobStatus.PENDING, JobStatus.PROCESSING];

@WebSocketGateway({ path: '/ws/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly stepRepository: StepRepository,
  ) {}

  @WebSocketServer()
  server!: Server;

  handleConnection(client: WebSocket) {
    this.logger.log(`Dashboard client connected (${this.server.clients.size} total)`);

    client.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'request_snapshot') {
          this.sendSnapshot(client).catch((err) => {
            this.logger.error(`Snapshot failed: ${err}`);
          });
        }
      } catch {
        // ignore malformed messages
      }
    });
  }

  handleDisconnect() {
    this.logger.log(`Dashboard client disconnected (${this.server.clients.size} total)`);
  }

  /**
   * Broadcast a DTM event to all connected dashboard clients.
   */
  broadcast(event: DtmEvent): void {
    const payload = JSON.stringify(event);
    let sent = 0;

    this.server.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent++;
      }
    });

    if (sent > 0) {
      this.logger.debug(`Broadcast ${event.type} to ${sent} client(s)`);
    }
  }

  /**
   * Send a snapshot of active jobs to a single client.
   */
  private async sendSnapshot(client: WebSocket): Promise<void> {
    // Fetch non-terminal jobs (PENDING + PROCESSING) plus recent completed (last 20)
    const [activeJobs, recentJobs] = await Promise.all([
      Promise.all(NON_TERMINAL_STATUSES.map((s) => this.jobRepository.findByStatus(s, 50))).then(
        (arrs) => arrs.flat(),
      ),
      this.jobRepository.findRecentJobs(20),
    ]);

    // Merge and deduplicate
    const jobMap = new Map<string, (typeof activeJobs)[0]>();
    for (const job of [...activeJobs, ...recentJobs]) {
      jobMap.set(job.id, job);
    }

    const snapshots: JobSnapshot[] = [];

    for (const job of jobMap.values()) {
      const steps = await this.stepRepository.findByJobId(job.id);

      const stepSnapshots: StepSnapshot[] = steps.map((s, i) => ({
        step: s.stepValue,
        description: s.description ?? '',
        status: s.status.toLowerCase() as StepSnapshot['status'],
        stepNumber: i + 1,
        error: s.error ?? undefined,
        duration:
          s.startedAt && s.completedAt
            ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()
            : undefined,
        attempt: s.retryCount ?? undefined,
      }));

      snapshots.push({
        id: job.id,
        workflow: job.workflowName || job.type || 'unknown',
        variant: job.type || 'default',
        status: job.status.toLowerCase() as JobSnapshot['status'],
        steps: stepSnapshots,
        createdAt: job.submittedAt?.toISOString() ?? new Date().toISOString(),
        completedAt: job.completedAt?.toISOString(),
        error: job.error ?? undefined,
        results: job.results
          ? {
              totalRecordsProcessed: job.results.totalRecordsProcessed,
              totalRecordsFailed: job.results.totalRecordsFailed,
              stepsCompleted: job.results.stepsCompleted,
              stepsFailed: job.results.stepsFailed,
              stepsAborted: job.results.stepsAborted ?? 0,
              durationMs: job.results.durationMs,
            }
          : undefined,
      });
    }

    const event: DtmEvent = {
      type: 'snapshot',
      jobs: snapshots,
      timestamp: new Date().toISOString(),
    };

    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
      this.logger.log(`Sent snapshot with ${snapshots.length} jobs to client`);
    }
  }
}
