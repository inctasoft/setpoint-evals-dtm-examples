/**
 * Response shapes for GET /api/v1/jobs/:jobId/steps/:stepName/activity (capability-spec.md
 * §3.2a, Lane A / PR #34) — the DAG node-click drill-down's data source. Two shapes share this
 * one endpoint: a normal step gets the "primary" shape; a step that exists ONLY as fan-out
 * child instances (no primary row — e.g. iot-sensor-pipeline's double fan-out) gets the
 * "aggregate" shape instead of a 404. `isAggregateActivity` is the type guard between them.
 */

export interface ExecutionAttempt {
  attemptNumber?: number;
  status?: string;
  error?: string | null;
  processingTimeMs?: number | null;
  sqsReceiveCount?: number | null;
  [key: string]: unknown;
}

export interface StepActivityChild {
  step?: string;
  childIndex: number | null;
  childItemId: string | null;
  status: string;
  durationMs: number | null;
  retryCount: number;
}

export interface StepActivityPrimary {
  step: string;
  status: string;
  durationMs: number | null;
  retryCount: number;
  maxRetryCount: number;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  attempts: ExecutionAttempt[];
  delegation: { lambdaFunctionName: string | null; sqsMessageId: string | null };
  ack: {
    kafkaPublishedAt: string | null;
    ackReceivedAt: string | null;
    ackWaitMs: number | null;
    ackMetadata: Record<string, unknown> | null;
  };
  fanOut: { childCount: number; children: StepActivityChild[] } | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
}

export interface StepActivityAggregate {
  step: string;
  aggregate: true;
  instanceCount: number;
  statusDistribution: Record<string, number>;
  instances: Array<StepActivityChild & { parentStep: string | null; attempts: ExecutionAttempt[] }>;
}

export type StepActivity = StepActivityPrimary | StepActivityAggregate;

export function isAggregateActivity(activity: StepActivity): activity is StepActivityAggregate {
  return 'aggregate' in activity && activity.aggregate === true;
}

/** Normalizes both response shapes to a single {completed,total} — the DAG badge and the
 *  drill-down distribution bar share this so they never read the two shapes differently. */
export function fanOutCounts(activity: StepActivity): { completed: number; total: number } | null {
  if (isAggregateActivity(activity)) {
    if (activity.instanceCount === 0) return null;
    return { completed: activity.statusDistribution.completed ?? 0, total: activity.instanceCount };
  }
  if (activity.fanOut) {
    const total = activity.fanOut.childCount || activity.fanOut.children.length;
    if (total === 0) return null;
    const completed = activity.fanOut.children.filter((c) => c.status === 'completed').length;
    return { completed, total };
  }
  return null;
}

export interface NormalizedChild {
  key: string;
  step?: string;
  childIndex: number | null;
  childItemId: string | null;
  status: string;
  durationMs: number | null;
  retryCount: number;
}

/** Same two-shape normalization for the drill-down's child list + distribution bar. */
export function normalizedChildren(activity: StepActivity): NormalizedChild[] {
  if (isAggregateActivity(activity)) {
    // Index is always folded into the key (not just used as a childItemId fallback):
    // childItemId/childIndex are not guaranteed unique across instances — e.g. the
    // fan-out double-emission bug (SE-03-double-fan-out) produces two rows with the
    // same childItemId, which previously collided into one Preact key (#35 defect 1).
    return activity.instances.map((c, i) => ({
      key: `${c.childItemId ?? c.childIndex ?? 'idx'}-${i}`,
      step: c.parentStep ?? undefined,
      childIndex: c.childIndex,
      childItemId: c.childItemId,
      status: c.status,
      durationMs: c.durationMs,
      retryCount: c.retryCount,
    }));
  }
  if (activity.fanOut) {
    return activity.fanOut.children.map((c, i) => ({
      key: `${c.childItemId ?? c.childIndex ?? 'idx'}-${i}`,
      step: c.step,
      childIndex: c.childIndex,
      childItemId: c.childItemId,
      status: c.status,
      durationMs: c.durationMs,
      retryCount: c.retryCount,
    }));
  }
  return [];
}

export function childStatusDistribution(children: NormalizedChild[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of children) dist[c.status] = (dist[c.status] ?? 0) + 1;
  return dist;
}
