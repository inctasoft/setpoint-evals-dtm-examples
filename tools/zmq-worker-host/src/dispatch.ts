/**
 * Task Dispatch — zmq-worker-host
 *
 * Turns a zmq task envelope into the SQSEvent-shaped input the workflow
 * handlers already expect (the same synthesis the sqs-poller performs), and
 * invokes the handler IN-PROCESS through the shared handlerMap. Workflow
 * handler code stays byte-untouched:
 *
 * - `messageId`                  ← envelope taskHandle (orchestrator-minted uuid)
 * - `ApproximateReceiveCount`    ← envelope attemptNumber (the synthetic
 *                                  dtm_steps attempt counter — the worker-sdk
 *                                  surfaces it as retryMetadata.attemptNumber)
 * - `body`                       ← the step payload verbatim (same shape the
 *                                  SQS path places in the message body)
 */

import type { SQSEvent, Context } from "aws-lambda";
import { createHash } from "crypto";
import type { ZmqTaskPayload } from "@dtm/core";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "000000000000";

/** Handler signature shared with the sqs-poller debug-server mode. */
export type WorkflowHandler = (
  event: SQSEvent,
  context: Context,
) => Promise<{ batchItemFailures?: { itemIdentifier: string }[] } | void>;

export interface DispatchResult {
  success: boolean;
  error?: string;
}

/**
 * Synthesize the single-record SQSEvent a workflow handler expects from one
 * zmq task envelope.
 */
export function buildSqsEventFromTask(task: ZmqTaskPayload): SQSEvent {
  const body = JSON.stringify(task.message);
  const now = Date.now().toString();

  return {
    Records: [
      {
        messageId: task.taskHandle,
        receiptHandle: task.taskHandle,
        body,
        attributes: {
          // The synthetic attempt counter rides the SAME attribute the worker-sdk
          // reads on the SQS path — handlers stay byte-untouched.
          ApproximateReceiveCount: String(task.attemptNumber),
          SentTimestamp: now,
          SenderId: "zmq-worker-host",
          ApproximateFirstReceiveTimestamp: now,
        },
        messageAttributes: {},
        md5OfBody: createHash("md5").update(body).digest("hex"),
        eventSource: "aws:sqs",
        eventSourceARN: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${task.queueName}`,
        awsRegion: AWS_REGION,
      },
    ],
  } as unknown as SQSEvent;
}

/**
 * Invoke the handler registered for the task's queue. A handler error (or a
 * batch item failure) is REPORTED, never thrown back into the receive loop —
 * the worker already sent its failure callback, and an undelivered task is
 * re-dispatched by the orchestrator's redelivery engine on lease expiry.
 */
export async function dispatchTask(
  handlerMap: Record<string, WorkflowHandler>,
  task: ZmqTaskPayload,
  createContext: (functionName: string) => Context,
): Promise<DispatchResult> {
  const handler = handlerMap[task.queueName];
  if (!handler) {
    return {
      success: false,
      error: `No handler registered for queue '${task.queueName}'`,
    };
  }

  try {
    const event = buildSqsEventFromTask(task);
    const result = await handler(event, createContext(task.queueName));
    const failures = (result as { batchItemFailures?: unknown[] } | void)
      ?.batchItemFailures;
    if (failures && failures.length > 0) {
      return {
        success: false,
        error: `Handler reported ${failures.length} batch item failure(s)`,
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
