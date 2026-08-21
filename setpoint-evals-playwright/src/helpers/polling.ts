import type { JobStatusResponse } from './types';

export interface PollOptions {
  maxSeconds?: number;
  intervalMs?: number;
  additionalTimeoutMs?: number;
  /** Terminal states that stop polling. Default: completed, failed, partial_success */
  terminalStatuses?: string[];
  /** Called after each poll for logging/display */
  onPoll?: (response: JobStatusResponse, attempt: number) => void;
}

const DEFAULT_TERMINAL = ['completed', 'failed', 'partial_success'];

/**
 * Poll a job until it reaches a terminal state or times out.
 *
 * Mirrors the bash helpers' `poll_job` function:
 * - Sleeps intervalMs between polls
 * - Checks for terminal states (case-insensitive)
 * - Respects additionalTimeoutMs for slow environments
 *
 * @returns The final JobStatusResponse when a terminal state is reached
 * @throws Error if polling times out
 */
export async function pollUntilTerminal(
  getJobStatus: (jobId: string) => Promise<JobStatusResponse>,
  jobId: string,
  options: PollOptions = {},
): Promise<JobStatusResponse> {
  const {
    maxSeconds = 120,
    intervalMs = 3000,
    additionalTimeoutMs = 0,
    terminalStatuses = DEFAULT_TERMINAL,
    onPoll,
  } = options;

  const totalMs = maxSeconds * 1000 + additionalTimeoutMs;
  const maxAttempts = Math.ceil(totalMs / intervalMs);
  const terminalLower = terminalStatuses.map((s) => s.toLowerCase());

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(intervalMs);

    const response = await getJobStatus(jobId);
    const status = response.status?.toLowerCase();

    onPoll?.(response, attempt);

    if (terminalLower.includes(status)) {
      return response;
    }
  }

  throw new Error(
    `Job ${jobId} did not reach terminal state within ${maxSeconds}s` +
      (additionalTimeoutMs > 0 ? ` (+${additionalTimeoutMs}ms additional)` : '') +
      `. Polled ${maxAttempts} times at ${intervalMs}ms intervals.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
