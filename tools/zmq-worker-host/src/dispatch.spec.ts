import type { SQSEvent, Context } from "aws-lambda";
import { buildZmqTaskEnvelope, ZmqTaskPayload } from "@dtm/core";
import { buildSqsEventFromTask, dispatchTask } from "./dispatch";

/**
 * Phase 2 — zmq-worker-host dispatch (RED-first).
 *
 * The host receives a task envelope from the orchestrator's ROUTER and must
 * invoke the SAME handlerMap the sqs-poller debug-server mode uses, with an
 * SQSEvent-shaped input synthesized from the envelope — workflow handler code
 * stays byte-untouched. The synthetic attempt counter rides in as
 * ApproximateReceiveCount so the worker-sdk's retryMetadata.attemptNumber is
 * the orchestrator's dtm_steps attempt count, and the orchestrator-minted
 * taskHandle is the messageId.
 */

const taskPayload: ZmqTaskPayload = {
  taskHandle: "4b7d1d3c-9f2a-4f0e-9a1b-1a2b3c4d5e6f",
  queueName: "order-validate-customer",
  attemptNumber: 3,
  message: {
    jobId: "job-1",
    stepId: "step-1",
    stepValue: "ValidateCustomer",
    input: { customerId: 1 },
    callbackUrl: "http://orchestrator:3000/api/v1/callback/step-progress",
  },
};

function makeContext(functionName: string): Context {
  return { functionName, awsRequestId: "test-request" } as unknown as Context;
}

describe("Phase 2 — zmq-worker-host dispatch", () => {
  it("SE-DISP-event: a task envelope becomes the SQSEvent shape the handlers expect", () => {
    const event = buildSqsEventFromTask(taskPayload);

    expect(event.Records).toHaveLength(1);
    const record = event.Records[0];
    expect(record.messageId).toBe(taskPayload.taskHandle);
    expect(record.attributes.ApproximateReceiveCount).toBe("3");
    expect(record.eventSource).toBe("aws:sqs");
    expect(record.eventSourceARN).toContain("order-validate-customer");
    // Body is EXACTLY the step payload — the same shape the SQS path sends.
    expect(JSON.parse(record.body)).toEqual(taskPayload.message);
  });

  it("SE-DISP-invoke: dispatchTask invokes the queue's handler with the event and a named context", async () => {
    const handler = jest.fn(async () => ({ batchItemFailures: [] }));
    const handlerMap = { "order-validate-customer": handler };

    const result = await dispatchTask(handlerMap, taskPayload, makeContext);

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const [event, context] = handler.mock.calls[0] as unknown as [
      SQSEvent,
      Context,
    ];
    expect(event.Records[0].messageId).toBe(taskPayload.taskHandle);
    expect(context.functionName).toBe("order-validate-customer");
  });

  it("SE-DISP-batch-failure: a handler batch item failure surfaces as an unsuccessful dispatch", async () => {
    const handler = jest.fn(async () => ({
      batchItemFailures: [{ itemIdentifier: taskPayload.taskHandle }],
    }));
    const handlerMap = { "order-validate-customer": handler };

    const result = await dispatchTask(handlerMap, taskPayload, makeContext);

    expect(result.success).toBe(false);
  });

  it("SE-DISP-unknown-queue: a task for a queue with no handler fails loudly, never silently", async () => {
    const result = await dispatchTask({}, taskPayload, makeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("order-validate-customer");
  });

  it("SE-DISP-throw: a throwing handler is reported, not propagated into the receive loop", async () => {
    const handler = jest.fn(async () => {
      throw new Error("boom");
    });
    const handlerMap = { "order-validate-customer": handler };

    const result = await dispatchTask(handlerMap, taskPayload, makeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("boom");
  });

  it("SE-DISP-factory: the envelope factory output is directly dispatchable (schema-level contract)", () => {
    const envelope = buildZmqTaskEnvelope(taskPayload);

    const event = buildSqsEventFromTask(envelope.payload);

    expect(event.Records[0].attributes.ApproximateReceiveCount).toBe("3");
  });
});
