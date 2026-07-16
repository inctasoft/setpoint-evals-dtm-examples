import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseMetadata,
  parsePayload,
  parseScenario,
  parseTitle,
} from './parsing/eval-readme-parser';
import { EvalSuite, EvalSummary } from './evals.types';

interface SuiteRoot {
  suite: EvalSuite;
  dir: string;
}

/**
 * Filesystem discovery for the Setpoint Eval estate — the SAME `SE-*` dirs
 * (with a `test.sh`) that `scripts/se-run-suite.sh` actually executes, so the
 * count this service reports can never drift from what the SE runner counts
 * (the predicate-drift trap: `MEMORY.md` → gotchas_predicate_drift). NEVER a
 * bundled manifest — every call re-derives from the live filesystem, gated
 * only by an mtime-based cache for cheap repeat polling.
 */
@Injectable()
export class EvalsDiscoveryService {
  private readonly logger = new Logger(EvalsDiscoveryService.name);

  private cacheKey: string | undefined;
  private cache: EvalSummary[] = [];

  constructor(private readonly configService: ConfigService) {}

  private suiteRoots(): SuiteRoot[] {
    const setpointEvalsPath = this.configService.get<string>('evals.setpointEvalsPath')!;
    const workflowsPath = this.configService.get<string>('evals.workflowsPath')!;

    return [
      { suite: 'core', dir: setpointEvalsPath },
      {
        suite: 'order-processing',
        dir: path.join(workflowsPath, 'order-processing', 'setpoint-evals'),
      },
      {
        suite: 'iot-sensor-pipeline',
        dir: path.join(workflowsPath, 'iot-sensor-pipeline', 'setpoint-evals'),
      },
      {
        suite: 'infra-provisioning',
        dir: path.join(workflowsPath, 'infra-provisioning', 'setpoint-evals'),
      },
    ];
  }

  /** SE-<...> directories directly under `dir` that se-run-suite.sh would execute. */
  private seDirs(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('SE-') &&
          entry.name !== '00-template' &&
          fs.existsSync(path.join(dir, entry.name, 'test.sh')),
      )
      .map((entry) => entry.name)
      .sort();
  }

  /** Cheap signature (no file reads) — invalidates the cache on add/remove/rename/edit. */
  private computeCacheKey(roots: SuiteRoot[]): string {
    const parts: string[] = [];
    for (const { suite, dir } of roots) {
      for (const id of this.seDirs(dir)) {
        const seDir = path.join(dir, id);
        const readmePath = path.join(seDir, 'README.md');
        const seDirMtime = fs.statSync(seDir).mtimeMs;
        const readmeMtime = fs.existsSync(readmePath) ? fs.statSync(readmePath).mtimeMs : -1;
        parts.push(`${suite}/${id}:${seDirMtime}:${readmeMtime}`);
      }
    }
    return parts.join('|');
  }

  private parseOne(suite: EvalSuite, dir: string, id: string): EvalSummary {
    const readmePath = path.join(dir, id, 'README.md');
    const hasReadme = fs.existsSync(readmePath);

    if (!hasReadme) {
      return { suite, id, name: id, hasReadme: false };
    }

    let content: string;
    try {
      content = fs.readFileSync(readmePath, 'utf-8');
    } catch (err) {
      this.logger.warn(`Failed to read ${readmePath}: ${err instanceof Error ? err.message : err}`);
      return { suite, id, name: id, hasReadme: false };
    }

    const metadata = parseMetadata(content);
    return {
      suite,
      id,
      name: parseTitle(content) ?? id,
      category: metadata.category,
      duration: metadata.duration,
      timeout: metadata.timeout,
      isolation: metadata.isolation,
      quick: metadata.quick,
      hasReadme: true,
      readme: content,
      scenario: parseScenario(content),
      payload: parsePayload(content),
    };
  }

  /** All evals across all four suites, freshly re-derived if anything on disk changed. */
  listEvals(): EvalSummary[] {
    const roots = this.suiteRoots();
    const key = this.computeCacheKey(roots);
    if (key === this.cacheKey) {
      return this.cache;
    }

    const evals: EvalSummary[] = [];
    for (const { suite, dir } of roots) {
      for (const id of this.seDirs(dir)) {
        evals.push(this.parseOne(suite, dir, id));
      }
    }

    this.cacheKey = key;
    this.cache = evals;
    this.logger.log(`Discovered ${evals.length} setpoint evals across ${roots.length} suites`);
    return evals;
  }

  getEval(suite: string, id: string): EvalSummary | undefined {
    return this.listEvals().find((e) => e.suite === suite && e.id === id);
  }
}
