import { useEffect, useRef, useState } from 'preact/hooks';
import { fanOutCounts, type StepActivity } from '../lib/step-activity';
import type { StepState } from '../types/events';

export interface FanOutBadge {
  completed: number;
  total: number;
}

const NON_TERMINAL = new Set(['delegated', 'in_progress', 'in_progress_retrying', 'waiting_for_children', 'waiting_for_ack']);

/**
 * Live fan-out completion counts for the currently-overlaid job's parent steps — the DAG's
 * ticking "n/m" badge (ux-storyboards.md §2.2 t=0:36, "badges climbing"). WS events only carry
 * TOP-LEVEL step transitions (the critique's own noted iot limitation — no live per-child
 * stream exists), so childCount alone (snapshot-only, no polling) can show a static total but
 * never a climbing count. This hook polls /activity for every step with childCount > 0 while
 * that step is non-terminal, and stops once the job's fan-out parents all reach a terminal
 * state — the deliberate scope decision for the badge's live-count data path.
 */
export function useFanOutBadges(jobId: string | null, steps: StepState[]): Map<string, FanOutBadge> {
  const [badges, setBadges] = useState<Map<string, FanOutBadge>>(new Map());
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Stable-ish signature: only re-arm the poll loop when WHAT to watch actually changes
  // (a step entering the fan-out roster, or its own top-level status flipping), not on every
  // unrelated snapshot tick for other jobs/steps.
  const watchSignature = steps
    .filter((s) => (s.childCount ?? 0) > 0)
    .map((s) => `${s.step}:${s.status}`)
    .join('|');

  useEffect(() => {
    if (!jobId || watchSignature === '') {
      setBadges(new Map());
      return;
    }
    let cancelled = false;

    const tick = async () => {
      const watched = stepsRef.current.filter((s) => (s.childCount ?? 0) > 0);
      if (watched.length === 0) return;
      const results = await Promise.all(
        watched.map(async (s) => {
          try {
            const res = await fetch(
              `/api/api/v1/jobs/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(s.step)}/activity`,
            );
            if (!res.ok) return null;
            const json = (await res.json()) as StepActivity;
            const counts = fanOutCounts(json);
            return counts ? ([s.step, counts] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setBadges((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) next.set(r[0], r[1]);
        }
        return next;
      });
    };

    tick();
    const anyNonTerminal = stepsRef.current.some(
      (s) => (s.childCount ?? 0) > 0 && NON_TERMINAL.has(s.status),
    );
    const timer = anyNonTerminal ? setInterval(tick, 2500) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId, watchSignature]);

  return badges;
}
