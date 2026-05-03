/**
 * Demo: Infrastructure Provisioning Workflow
 *
 * Records a video of the DTM dashboard showing the infra-provisioning
 * workflow executing end-to-end.
 *
 * Uses fast simulation delays for a quick demo.
 */

import { test, expect } from '../fixtures/dashboard.fixture';
import { runDemoRecording } from './helpers';

test.describe('Demo: Infra Provisioning', () => {
  test.setTimeout(240_000);

  test('records infra-provisioning workflow', async ({ dashboardPage, dtmApi }) => {
    const { finalStatus } = await runDemoRecording({
      page: dashboardPage,
      dtmApi,
      workflow: 'infra-provisioning',
      payload: {
        variant: 'default',
        payload: {
          entityId: 'ENV-DEV',
          environmentId: 'ENV-DEV',
          networkId: 'NET-DEV-1',
          instanceId: 'INST-DEV-1',
          dnsRecordId: 'DNS-DEV-1',
          certificateId: 'CERT-DEV-1',
          loadBalancerId: 'LB-DEV-1',
        },
        enableDeduplication: false,
        testOptions: {
          PlanEnvironment: { simDelay: 1000 },
          ApplyEnvironment: { simDelay: 1000, ackDelay: 500 },
          PlanNetwork: { simDelay: 1000 },
          ApplyNetwork: { simDelay: 1000, ackDelay: 500 },
          DiscoverCompute: { simDelay: 1000 },
          PlanCompute: { simDelay: 1000 },
          ApplyCompute: { simDelay: 1000, ackDelay: 500 },
          PlanStorage: { simDelay: 1000 },
          ApplyStorage: { simDelay: 1000, ackDelay: 500 },
          PlanDNS: { simDelay: 1000 },
          ApplyDNS: { simDelay: 1000, ackDelay: 500 },
          PlanCertificate: { simDelay: 1000 },
          ApplyCertificate: { simDelay: 1000, ackDelay: 500 },
          PlanLoadBalancer: { simDelay: 1000 },
          ApplyLoadBalancer: { simDelay: 1000, ackDelay: 500 },
        },
      },
      maxPollSeconds: 180,
    });

    expect(finalStatus).toBe('completed');
  });
});
