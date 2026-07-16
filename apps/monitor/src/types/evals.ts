/** Mirrors services/orchestrator/src/evals/evals.types.ts (EvalSummary). */

export type EvalSuite = 'core' | 'order-processing' | 'iot-sensor-pipeline' | 'infra-provisioning';

export interface EvalPayload {
  raw: string;
  json?: Record<string, unknown>;
  parseError?: string;
}

export interface EvalSummary {
  suite: EvalSuite;
  id: string;
  name: string;
  category?: string;
  duration?: string;
  timeout?: string;
  isolation?: string;
  quick?: boolean;
  hasReadme: boolean;
  readme?: string;
  scenario?: string;
  payload?: EvalPayload;
}

export const SUITE_LABELS: Record<EvalSuite, string> = {
  core: 'Core',
  'order-processing': 'Order Processing',
  'iot-sensor-pipeline': 'IoT',
  'infra-provisioning': 'Infra',
};

export const SUITE_ORDER: EvalSuite[] = [
  'core',
  'order-processing',
  'iot-sensor-pipeline',
  'infra-provisioning',
];
