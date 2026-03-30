/**
 * IoT Sensor Pipeline Workers — Handler Registry
 *
 * Exports all Lambda handlers and a handlerMap for the SQS poller
 * to route messages to the correct handler based on queue name.
 */

// Named handler exports
export { handler as registerDevice } from "./handlers/register-device";
export { handler as provisionDevice } from "./handlers/provision-device";
export { handler as discoverSensors } from "./handlers/discover-sensors";
export { handler as calibrateSensor } from "./handlers/calibrate-sensor";
export { handler as activateSensor } from "./handlers/activate-sensor";
export { handler as discoverReadings } from "./handlers/discover-readings";
export { handler as ingestReading } from "./handlers/ingest-reading";
export { handler as publishReading } from "./handlers/publish-reading";
export { handler as evaluateAlert } from "./handlers/evaluate-alert";
export { handler as dispatchAlert } from "./handlers/dispatch-alert";
export { handler as computeAggregate } from "./handlers/compute-aggregate";
export { handler as publishAggregate } from "./handlers/publish-aggregate";

// Import for handlerMap
import { handler as registerDevice } from "./handlers/register-device";
import { handler as provisionDevice } from "./handlers/provision-device";
import { handler as discoverSensors } from "./handlers/discover-sensors";
import { handler as calibrateSensor } from "./handlers/calibrate-sensor";
import { handler as activateSensor } from "./handlers/activate-sensor";
import { handler as discoverReadings } from "./handlers/discover-readings";
import { handler as ingestReading } from "./handlers/ingest-reading";
import { handler as publishReading } from "./handlers/publish-reading";
import { handler as evaluateAlert } from "./handlers/evaluate-alert";
import { handler as dispatchAlert } from "./handlers/dispatch-alert";
import { handler as computeAggregate } from "./handlers/compute-aggregate";
import { handler as publishAggregate } from "./handlers/publish-aggregate";

/**
 * Handler map: Maps SQS queue names to their Lambda handler functions.
 *
 * Used by the SQS poller to route messages from each queue to the
 * correct handler function. Queue names match those defined in
 * workflow.config.ts step definitions.
 */
export const handlerMap: Record<string, (event: any, context: any) => Promise<any>> = {
  // Device (root entity)
  "iot-register-device": registerDevice,
  "iot-provision-device": provisionDevice,

  // Sensor (fan-out from device)
  "iot-discover-sensors": discoverSensors,
  "iot-calibrate-sensor": calibrateSensor,
  "iot-activate-sensor": activateSensor,

  // Reading (nested fan-out from sensor)
  "iot-discover-readings": discoverReadings,
  "iot-ingest-reading": ingestReading,
  "iot-publish-reading": publishReading,

  // Alert (depends on device)
  "iot-evaluate-alert": evaluateAlert,
  "iot-dispatch-alert": dispatchAlert,

  // Aggregate (depends on sensor)
  "iot-compute-aggregate": computeAggregate,
  "iot-publish-aggregate": publishAggregate,
};
