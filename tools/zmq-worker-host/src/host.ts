/**
 * ZMQ Worker Host — DEALER side of the zmq task transport
 *
 * Sibling of tools/sqs-poller for the zmq task path: instead of polling SQS,
 * the host CONNECTS to the orchestrator's ROUTER socket as a DEALER, sends a
 * HELLO (worker id + the queues its workflow serves), refreshes liveness with
 * periodic heartbeats, receives task envelopes, receipt-acks them, and
 * invokes the SAME workflow handlerMap in-process (like the poller's
 * debug-server mode). Workers callback to the orchestrator over HTTP exactly
 * as on the SQS path — workflow handler code is byte-untouched.
 *
 * One host serves ONE workflow (WORKFLOW_NAME); compose scales replicas per
 * workflow. Losing this host mid-task is safe by design: the task was
 * receipt-acked but the orchestrator's durability anchor is Postgres — the
 * redelivery engine re-dispatches the step when its delegation lease expires,
 * and the silence sweeper marks this worker dead so no NEW dispatch routes to
 * it.
 *
 * Configuration:
 * - WORKFLOW_NAME            — workflow this host serves (required)
 * - ZMQ_TASKS_ENDPOINT       — orchestrator ROUTER (default: tcp://orchestrator:5557)
 * - WORKER_ID                — stable identity (default: <workflow>-<hostname>-<pid>)
 * - ZMQ_HEARTBEAT_INTERVAL_MS — heartbeat cadence (default: 5000)
 */

import "reflect-metadata";

import * as os from "os";
import * as zmq from "zeromq";
import {
  buildZmqHeartbeatEnvelope,
  buildZmqHelloEnvelope,
  buildZmqReceivedEnvelope,
  decodeZmqEnvelope,
  encodeZmqEnvelope,
} from "@dtm/core";
import { discoverQueuesForWorkflow } from "./queue-discovery";
import {
  createMockContext,
  getHandlerMapForWorkflow,
  initWorkflowDataSource,
} from "./handler-registry";
import { dispatchTask, WorkflowHandler } from "./dispatch";

const WORKFLOW_NAME = process.env.WORKFLOW_NAME || "";
const ENDPOINT = process.env.ZMQ_TASKS_ENDPOINT || "tcp://orchestrator:5557";
const WORKER_ID =
  process.env.WORKER_ID || `${WORKFLOW_NAME}-${os.hostname()}-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.ZMQ_HEARTBEAT_INTERVAL_MS || "5000",
  10,
);

const stats = {
  tasksReceived: 0,
  tasksSucceeded: 0,
  tasksFailed: 0,
  startTime: new Date(),
};

async function main(): Promise<void> {
  if (!WORKFLOW_NAME) {
    console.error(
      "❌ WORKFLOW_NAME is required (one host serves one workflow)",
    );
    process.exit(1);
  }

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   ZMQ Worker Host (DEALER, in-process)         ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log("");
  console.log("Configuration:");
  console.log(`  Workflow:           ${WORKFLOW_NAME}`);
  console.log(`  Worker ID:          ${WORKER_ID}`);
  console.log(`  ROUTER endpoint:    ${ENDPOINT}`);
  console.log(`  Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);
  console.log("");

  // Fail fast if the workflow is unknown; discover the queues we serve.
  const queues = discoverQueuesForWorkflow(WORKFLOW_NAME);
  const handlerMap = getHandlerMapForWorkflow(WORKFLOW_NAME) as Record<
    string,
    WorkflowHandler
  >;

  // Handlers run in-process for the life of this host — neutralize
  // DataSource.destroy() (each handler's finally block calls it) before any
  // handler module is exercised, then pre-initialize the workflow DataSource.
  try {
    const { DataSource } = await import("typeorm");
    DataSource.prototype.destroy = async function () {
      /* no-op in the long-lived worker host */
    };
    console.log("✅ DataSource.prototype.destroy patched (shared connections)");
  } catch (error) {
    console.warn(
      "⚠️  Could not patch DataSource.prototype.destroy:",
      error instanceof Error ? error.message : error,
    );
  }
  await initWorkflowDataSource(WORKFLOW_NAME);

  const dealer = new zmq.Dealer({ routingId: WORKER_ID });
  dealer.connect(ENDPOINT);
  console.log(`🔌 Connected to orchestrator ROUTER at ${ENDPOINT}`);

  // HELLO registers this worker (id + queues served); the orchestrator flushes
  // any tasks buffered for our queues while no worker was available.
  await dealer.send(
    encodeZmqEnvelope(buildZmqHelloEnvelope({ workerId: WORKER_ID, queues })),
  );
  console.log(`👋 HELLO sent — serving ${queues.length} queue(s)`);

  const sendHeartbeat = () => {
    // Re-HELLO on EVERY heartbeat tick, not only at boot: the registry is
    // in-memory, so an orchestrator recreate wipes it — and while zmq
    // auto-reconnects the socket, registration does not recover by itself
    // (observed live: fleet permanently empty after recreates, tasks buffered
    // forever). Registration is idempotent (first/revived transitions log,
    // steady state is silent; buffered tasks flush on re-registration).
    void dealer
      .send(encodeZmqEnvelope(buildZmqHelloEnvelope({ workerId: WORKER_ID, queues })))
      .catch((error) => console.error("❌ Re-HELLO send failed:", error));
    void dealer
      .send(encodeZmqEnvelope(buildZmqHeartbeatEnvelope(WORKER_ID)))
      .catch((error) => console.error("❌ Heartbeat send failed:", error));
  };

  // First heartbeat IMMEDIATELY after HELLO, not one interval later: the
  // registry's silence sweep measures from the last SEEN heartbeat, and a
  // worker whose interval exceeds the silence window would flap dead before
  // its first heartbeat ever lands (the SE-32 boot-flap).
  sendHeartbeat();
  const heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const shutdown = (signal: string) => {
    console.log(
      `\n👋 ${signal} received — shutting down (stats: ${JSON.stringify(stats)})`,
    );
    clearInterval(heartbeat);
    dealer.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("🚀 Receive loop started");
  console.log("");

  for await (const [topic, json] of dealer) {
    let envelope;
    try {
      envelope = decodeZmqEnvelope(topic.toString(), json.toString());
    } catch (error) {
      console.error(
        `❌ Malformed frame from orchestrator: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }

    if (envelope.kind !== "task") {
      console.warn(`⚠️  Unexpected frame kind '${envelope.kind}' — dropped`);
      continue;
    }

    const task = envelope.payload;
    stats.tasksReceived++;
    console.log(
      `[${task.queueName}] Task ${task.taskHandle} (attempt ${task.attemptNumber})`,
    );

    // Receipt-ack FIRST — the orchestrator's sendTask resolves an honest
    // TaskSendResult from this frame. Handler execution follows async.
    await dealer.send(
      encodeZmqEnvelope(buildZmqReceivedEnvelope(task.taskHandle)),
    );

    // Dispatch without blocking the receive loop: concurrent tasks are safe
    // (shared DataSources, destroy() neutralized). A failure is already
    // reported to the orchestrator by the handler's own failure callback.
    void dispatchTask(handlerMap, task, createMockContext).then((result) => {
      if (result.success) {
        stats.tasksSucceeded++;
        console.log(`[${task.queueName}] ✅ Task ${task.taskHandle} handled`);
      } else {
        stats.tasksFailed++;
        console.error(
          `[${task.queueName}] ❌ Task ${task.taskHandle} failed: ${result.error}`,
        );
      }
    });
  }
}

main().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
