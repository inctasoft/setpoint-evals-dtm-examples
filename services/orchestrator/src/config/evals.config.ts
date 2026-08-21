/**
 * Setpoint Evals Discovery Configuration
 *
 * Paths where the orchestrator can find the repo's Setpoint Eval READMEs at
 * runtime. In Docker these are read-only bind mounts (see docker-compose.yml
 * `evals-src` mounts); outside Docker (unit tests, `pnpm --filter orchestrator
 * start:dev` run directly from `services/orchestrator/`) they default to the
 * relative path back to the repo root.
 *
 * NEVER bundle a manifest file — discovery always reads the filesystem live.
 */

import { registerAs } from '@nestjs/config';
import * as path from 'path';

export const evalsConfig = registerAs('evals', () => {
  return {
    /** Directory containing the flat "core" suite: setpoint-evals/SE-* */
    setpointEvalsPath:
      process.env.EVALS_SETPOINT_EVALS_PATH || path.resolve(process.cwd(), '../../setpoint-evals'),

    /** Directory containing workflows/<name>/setpoint-evals/SE-* per workflow */
    workflowsPath:
      process.env.EVALS_WORKFLOWS_PATH || path.resolve(process.cwd(), '../../workflows'),

    /**
     * Dev-only escape hatch for the run endpoint. Default true (dev compose);
     * set ENABLE_EVAL_RUN_API=false to disable POST /api/v1/evals/:suite/:id/run
     * (e.g. in any environment where re-issuing arbitrary suite fixtures as
     * real jobs is undesirable). Discovery (GET) is never gated by this flag.
     */
    enableRunApi: process.env.ENABLE_EVAL_RUN_API !== 'false',
  };
});

export type EvalsConfig = ReturnType<typeof evalsConfig>;
