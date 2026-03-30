/**
 * Demo: IoT Sensor Pipeline Workflow
 *
 * Records a video of the DTM dashboard showing the iot-sensor-pipeline
 * workflow executing end-to-end.
 *
 * Uses fast simulation delays for a quick demo.
 */

import { test, expect } from '../fixtures/dashboard.fixture';
import { runDemoRecording } from './helpers';

test.describe('Demo: IoT Sensor Pipeline', () => {
  test.setTimeout(180_000);

  test('records iot-sensor-pipeline workflow', async ({ dashboardPage, dtmApi }) => {
    const { finalStatus } = await runDemoRecording({
      page: dashboardPage,
      dtmApi,
      workflow: 'iot-sensor-pipeline',
      payload: {
        variant: 'default',
        payload: { entityId: 'DEV-001', deviceId: 'DEV-001' },
        enableDeduplication: false,
        testOptions: {
          RegisterDevice: { simDelay: 1000 },
          ProvisionDevice: { simDelay: 1000, ackDelay: 500 },
          DiscoverSensors: { simDelay: 1000 },
          CalibrateSensor: { simDelay: 1000 },
          ActivateSensor: { simDelay: 1000, ackDelay: 500 },
          DiscoverReadings: { simDelay: 1000 },
          IngestReading: { simDelay: 1000 },
          PublishReading: { simDelay: 1000, ackDelay: 500 },
          EvaluateAlert: { simDelay: 1000 },
          DispatchAlert: { simDelay: 1000, ackDelay: 500 },
          ComputeAggregate: { simDelay: 1500 },
          PublishAggregate: { simDelay: 1000, ackDelay: 500 },
        },
      },
      maxPollSeconds: 100,
    });

    expect(finalStatus).toBe('completed');
  });
});
