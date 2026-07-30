/**
 * BUS_PROFILE umbrella expansion (Phase 4 of the bus-agnosticism program).
 *
 * `BUS_PROFILE=zmq` expands to `QUEUE_TRANSPORT=zmq` + `EVENT_BUS=zmq`;
 * `BUS_PROFILE=aws` is today's default world (sqs + kafka). An explicit
 * per-var env ALWAYS wins over the umbrella (precedence:
 * `QUEUE_TRANSPORT`/`EVENT_BUS` > `BUS_PROFILE` > built-in defaults), so
 * mixed modes stay one env away (`BUS_PROFILE=zmq` + `EVENT_BUS=kafka` =
 * Phase 2's zmq-tasks + kafka-events).
 *
 * This module runs its side effect AT IMPORT TIME and must be imported
 * BEFORE `./app.module` in `main.ts` — TransportModule and EventBusModule
 * read `process.env` in module-level consts at import, so the expansion has
 * to land first (ES import order is preserved top-to-bottom).
 */

export function expandBusProfileEnv(): void {
  const profile = (process.env.BUS_PROFILE || '').toLowerCase();

  if (profile === 'zmq') {
    process.env.QUEUE_TRANSPORT = process.env.QUEUE_TRANSPORT || 'zmq';
    process.env.EVENT_BUS = process.env.EVENT_BUS || 'zmq';
    return;
  }

  if (profile === 'aws' || profile === '') {
    // Explicit no-op: per-var env or built-in defaults govern (sqs + kafka).
    return;
  }

  throw new Error(`Unknown BUS_PROFILE '${process.env.BUS_PROFILE}' (expected 'aws' or 'zmq')`);
}

expandBusProfileEnv();
