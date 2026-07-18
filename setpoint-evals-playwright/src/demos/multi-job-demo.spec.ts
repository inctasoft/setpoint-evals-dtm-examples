/**
 * Demo: Multi-Job Concurrent Execution
 *
 * Records a video of the DTM dashboard showing ALL THREE workflows
 * triggered simultaneously, demonstrating the orchestrator handling
 * concurrent jobs across different workflows.
 */

import { test, expect } from '../fixtures/dashboard.fixture';
import { waitForJobInUI, selectJobInUI } from './helpers';
import { pollUntilTerminal } from '../helpers/polling';

test.describe('Demo: Multi-Job Concurrent', () => {
  test.setTimeout(240_000);

  test('records 3 workflows running simultaneously', async ({ dashboardPage, dtmApi }) => {
    // 1. Trigger all 3 workflows in rapid succession
    const [order, iot, infra] = await Promise.all([
      dtmApi.initiateJob({
        variant: 'quick-order',
        payload: { entityId: crypto.randomUUID(), customerId: 1, orderId: 1 },
        enableDeduplication: false,
        testOptions: {
          ValidateCustomer: { simDelay: 1500 },
          ValidateProduct: { simDelay: 1500 },
          SubmitCustomer: { simDelay: 2000, ackDelay: 1000 },
          SubmitOrder: { simDelay: 2000, ackDelay: 1000 },
        },
      }, 'order-processing'),

      dtmApi.initiateJob({
        variant: 'default',
        payload: { entityId: 'greenhouse-1', deviceId: 'greenhouse-1' },
        enableDeduplication: false,
        testOptions: {
          RegisterDevice: { simDelay: 1500 },
          ProvisionDevice: { simDelay: 1500, ackDelay: 500 },
          DiscoverSensors: { simDelay: 1500 },
          CalibrateSensor: { simDelay: 1500 },
          ActivateSensor: { simDelay: 1500, ackDelay: 500 },
          DiscoverReadings: { simDelay: 1500 },
          IngestReading: { simDelay: 2000 },
          PublishReading: { simDelay: 1500, ackDelay: 500 },
          EvaluateAlert: { simDelay: 1500 },
          DispatchAlert: { simDelay: 1500, ackDelay: 500 },
          ComputeAggregate: { simDelay: 2000 },
          PublishAggregate: { simDelay: 1500, ackDelay: 500 },
        },
      }, 'iot-sensor-pipeline'),

      dtmApi.initiateJob({
        variant: 'default',
        payload: {
          entityId: 'staging-eu',
          environmentId: 'staging-eu',
          networkId: 'NET-STAGING-EU-1',
          instanceId: 'INST-STAGING-EU-1',
          dnsRecordId: 'DNS-STAGING-EU-1',
          certificateId: 'CERT-STAGING-EU-1',
          loadBalancerId: 'LB-STAGING-EU-1',
        },
        enableDeduplication: false,
        testOptions: {
          PlanEnvironment: { simDelay: 1500 },
          ApplyEnvironment: { simDelay: 1500, ackDelay: 500 },
          PlanNetwork: { simDelay: 2000 },
          ApplyNetwork: { simDelay: 2000, ackDelay: 500 },
          DiscoverCompute: { simDelay: 1500 },
          PlanCompute: { simDelay: 2000 },
          ApplyCompute: { simDelay: 2000, ackDelay: 500 },
          PlanStorage: { simDelay: 1500 },
          ApplyStorage: { simDelay: 1500, ackDelay: 500 },
          PlanDNS: { simDelay: 1500 },
          ApplyDNS: { simDelay: 1500, ackDelay: 500 },
          PlanCertificate: { simDelay: 1500 },
          ApplyCertificate: { simDelay: 1500, ackDelay: 500 },
          PlanLoadBalancer: { simDelay: 1500 },
          ApplyLoadBalancer: { simDelay: 1500, ackDelay: 500 },
        },
      }, 'infra-provisioning'),
    ]);

    // 2. Wait for all 3 to appear in the dashboard
    await waitForJobInUI(dashboardPage, order.jobId);
    await waitForJobInUI(dashboardPage, iot.jobId);
    await waitForJobInUI(dashboardPage, infra.jobId);

    // 3. Click through each job to show their details
    await selectJobInUI(dashboardPage, order.jobId);
    await dashboardPage.waitForTimeout(2000);

    await selectJobInUI(dashboardPage, iot.jobId);
    await dashboardPage.waitForTimeout(2000);

    await selectJobInUI(dashboardPage, infra.jobId);
    await dashboardPage.waitForTimeout(2000);

    // 4. Go back to the first job and watch all complete
    await selectJobInUI(dashboardPage, order.jobId);

    // 5. Poll all 3 until terminal
    const [r1, r2, r3] = await Promise.all([
      pollUntilTerminal((id) => dtmApi.getJobStatus(id), order.jobId, { maxSeconds: 200 }),
      pollUntilTerminal((id) => dtmApi.getJobStatus(id), iot.jobId, { maxSeconds: 200 }),
      pollUntilTerminal((id) => dtmApi.getJobStatus(id), infra.jobId, { maxSeconds: 200 }),
    ]);

    // 6. Hold final frame
    await dashboardPage.waitForTimeout(4000);

    expect(r1.status.toLowerCase()).toBe('completed');
    expect(r2.status.toLowerCase()).toBe('completed');
    expect(r3.status.toLowerCase()).toBe('completed');
  });
});
