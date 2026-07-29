/**
 * BUS_PROFILE umbrella expansion (Phase 4) — same contract as the
 * orchestrator's config/bus-profile.ts: BUS_PROFILE=zmq expands to
 * QUEUE_TRANSPORT=zmq + EVENT_BUS=zmq, explicit per-var env wins. Runs at
 * import time; must be imported BEFORE ./app.module in main.ts.
 */
export function expandBusProfileEnv(): void {
  const profile = (process.env.BUS_PROFILE || "").toLowerCase();

  if (profile === "zmq") {
    process.env.QUEUE_TRANSPORT = process.env.QUEUE_TRANSPORT || "zmq";
    process.env.EVENT_BUS = process.env.EVENT_BUS || "zmq";
    return;
  }

  if (profile === "aws" || profile === "") {
    return;
  }

  throw new Error(
    `Unknown BUS_PROFILE '${process.env.BUS_PROFILE}' (expected 'aws' or 'zmq')`,
  );
}

expandBusProfileEnv();
