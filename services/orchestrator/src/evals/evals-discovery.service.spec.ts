import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EvalsDiscoveryService } from './evals-discovery.service';

const README = (title: string, extra = '') => `# ${title}

## Setpoint Eval Metadata

**Category**: demo · **Duration**: ~5s · **Timeout**: 30s · **Isolation**: parallel-safe

## Scenario
\`\`\`gherkin
Feature: demo
  Scenario: demo
    Given a fixture
    Then it works
\`\`\`
${extra}
`;

const PAYLOAD_BLOCK = `
## Payload
\`\`\`json
{ "variant": "default", "payload": { "id": 1 } }
\`\`\`
`;

function writeSe(dir: string, id: string, readme: string | undefined) {
  const seDir = path.join(dir, id);
  fs.mkdirSync(seDir, { recursive: true });
  fs.writeFileSync(path.join(seDir, 'test.sh'), '#!/usr/bin/env bash\nexit 0\n');
  if (readme !== undefined) {
    fs.writeFileSync(path.join(seDir, 'README.md'), readme);
  }
}

describe('EvalsDiscoveryService', () => {
  let tmpRoot: string;
  let setpointEvalsPath: string;
  let workflowsPath: string;
  let service: EvalsDiscoveryService;
  let mockConfigService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-discovery-spec-'));
    setpointEvalsPath = path.join(tmpRoot, 'setpoint-evals');
    workflowsPath = path.join(tmpRoot, 'workflows');
    fs.mkdirSync(setpointEvalsPath, { recursive: true });
    fs.mkdirSync(workflowsPath, { recursive: true });

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'evals.setpointEvalsPath') return setpointEvalsPath;
        if (key === 'evals.workflowsPath') return workflowsPath;
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [EvalsDiscoveryService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get(EvalsDiscoveryService);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('discovers exactly the SE-* dirs that have a test.sh — matching the runner predicate', () => {
    writeSe(setpointEvalsPath, 'SE-01-alpha', README('SE-01: alpha'));
    writeSe(setpointEvalsPath, 'SE-02-beta', README('SE-02: beta'));
    // 00-template excluded (mirrors se-run-suite.sh)
    writeSe(setpointEvalsPath, '00-template', README('template'));
    // "shared" dir (real convention) — not SE-prefixed, excluded
    fs.mkdirSync(path.join(setpointEvalsPath, 'shared'), { recursive: true });
    // an SE-looking dir with NO test.sh — excluded (matches what the runner would skip)
    fs.mkdirSync(path.join(setpointEvalsPath, 'SE-99-no-harness'), { recursive: true });

    const evals = service.listEvals();
    const ids = evals.map((e) => e.id).sort();
    expect(ids).toEqual(['SE-01-alpha', 'SE-02-beta']);
  });

  it('counts across all four suites (core + 3 workflow suites)', () => {
    writeSe(setpointEvalsPath, 'SE-01-core', README('SE-01: core'));
    for (const wf of ['order-processing', 'iot-sensor-pipeline', 'infra-provisioning']) {
      writeSe(
        path.join(workflowsPath, wf, 'setpoint-evals'),
        'SE-01-happy-path',
        README('SE-01: happy path'),
      );
    }

    const evals = service.listEvals();
    expect(evals).toHaveLength(4);
    expect(new Set(evals.map((e) => e.suite))).toEqual(
      new Set(['core', 'order-processing', 'iot-sensor-pipeline', 'infra-provisioning']),
    );
  });

  it('still counts an eval with no README (hasReadme=false), it is not silently dropped', () => {
    writeSe(setpointEvalsPath, 'SE-01-no-readme', undefined);
    const evals = service.listEvals();
    expect(evals).toHaveLength(1);
    expect(evals[0]).toMatchObject({
      id: 'SE-01-no-readme',
      hasReadme: false,
      name: 'SE-01-no-readme',
    });
    expect(evals[0].readme).toBeUndefined();
  });

  it('parses category/scenario/payload for a well-formed README', () => {
    writeSe(setpointEvalsPath, 'SE-01-full', README('SE-01: full', PAYLOAD_BLOCK));
    const [evalItem] = service.listEvals();
    expect(evalItem.category).toBe('demo');
    expect(evalItem.isolation).toBe('parallel-safe');
    expect(evalItem.scenario).toContain('Feature: demo');
    expect(evalItem.payload?.json).toEqual({ variant: 'default', payload: { id: 1 } });
    expect(evalItem.readme).toContain('# SE-01: full');
  });

  describe('getEval', () => {
    it('finds by suite+id', () => {
      writeSe(setpointEvalsPath, 'SE-01-full', README('SE-01: full'));
      expect(service.getEval('core', 'SE-01-full')).toBeDefined();
      expect(service.getEval('core', 'SE-99-missing')).toBeUndefined();
      expect(service.getEval('order-processing', 'SE-01-full')).toBeUndefined();
    });
  });

  describe('mtime-based cache', () => {
    it('serves cached results when nothing on disk changed', () => {
      writeSe(setpointEvalsPath, 'SE-01-full', README('SE-01: full'));
      const first = service.listEvals();
      const second = service.listEvals();
      // Same array reference proves the cache path was taken, not a re-scan.
      expect(second).toBe(first);
    });

    it('invalidates when a README is edited (content + mtime change)', async () => {
      const seDir = path.join(setpointEvalsPath, 'SE-01-full');
      writeSe(setpointEvalsPath, 'SE-01-full', README('SE-01: full'));
      const first = service.listEvals();
      expect(first[0].category).toBe('demo');

      // Ensure the mtime actually advances (some filesystems have 1s granularity).
      await new Promise((r) => setTimeout(r, 10));
      const edited = README('SE-01: full').replace('**Category**: demo', '**Category**: edited');
      fs.writeFileSync(path.join(seDir, 'README.md'), edited);
      const futureTime = new Date(Date.now() + 5000);
      fs.utimesSync(path.join(seDir, 'README.md'), futureTime, futureTime);

      const second = service.listEvals();
      expect(second).not.toBe(first);
      expect(second[0].category).toBe('edited');
    });

    it('invalidates when a new SE dir is added', () => {
      writeSe(setpointEvalsPath, 'SE-01-full', README('SE-01: full'));
      const first = service.listEvals();
      expect(first).toHaveLength(1);

      writeSe(setpointEvalsPath, 'SE-02-new', README('SE-02: new'));
      const second = service.listEvals();
      expect(second).toHaveLength(2);
    });
  });

  it('gracefully returns an empty suite when a workflow suite directory does not exist on disk', () => {
    // No workflows/*/setpoint-evals dirs created at all — must not throw.
    writeSe(setpointEvalsPath, 'SE-01-core', README('SE-01: core'));
    expect(() => service.listEvals()).not.toThrow();
    expect(service.listEvals()).toHaveLength(1);
  });
});
