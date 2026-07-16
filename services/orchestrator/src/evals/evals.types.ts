import { EvalPayload } from './parsing/eval-readme-parser';

export type EvalSuite = 'core' | 'order-processing' | 'iot-sensor-pipeline' | 'infra-provisioning';

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
  /** Full raw README.md text (undefined if hasReadme is false). */
  readme?: string;
  /** Gherkin block from "## Scenario" (sans fences). */
  scenario?: string;
  /** Parsed "## Payload" json fence, if the README has one. */
  payload?: EvalPayload;
}
