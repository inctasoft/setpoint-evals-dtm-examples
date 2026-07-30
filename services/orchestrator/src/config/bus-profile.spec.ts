/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: the shim
 * runs at import time, so each case re-requires it inside jest.isolateModules
 * with a fresh environment. */

/**
 * Phase 4 — BUS_PROFILE umbrella expansion (RED-first).
 *
 * `BUS_PROFILE=zmq` expands to QUEUE_TRANSPORT=zmq + EVENT_BUS=zmq; an
 * explicit per-var env ALWAYS wins over the umbrella; unset profile is a
 * no-op; an unknown profile fails fast at boot (fail-closed).
 */
describe('Phase 4 — BUS_PROFILE umbrella expansion', () => {
  const KEYS = ['BUS_PROFILE', 'QUEUE_TRANSPORT', 'EVENT_BUS'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.resetModules();
  });

  function loadShim() {
    jest.isolateModules(() => {
      require('./bus-profile');
    });
  }

  it('SE-PROF-expand: BUS_PROFILE=zmq expands both transports when no explicit env is set', () => {
    process.env.BUS_PROFILE = 'zmq';

    loadShim();

    expect(process.env.QUEUE_TRANSPORT).toBe('zmq');
    expect(process.env.EVENT_BUS).toBe('zmq');
  });

  it('SE-PROF-precedence: an explicit per-var env wins over the umbrella (mixed mode stays one env away)', () => {
    process.env.BUS_PROFILE = 'zmq';
    process.env.EVENT_BUS = 'kafka';

    loadShim();

    expect(process.env.QUEUE_TRANSPORT).toBe('zmq'); // umbrella fills the unset var
    expect(process.env.EVENT_BUS).toBe('kafka'); // explicit wins
  });

  it('SE-PROF-unset: no BUS_PROFILE leaves the environment untouched', () => {
    loadShim();

    expect(process.env.QUEUE_TRANSPORT).toBeUndefined();
    expect(process.env.EVENT_BUS).toBeUndefined();
  });

  it('SE-PROF-aws: BUS_PROFILE=aws is an explicit no-op (today’s world)', () => {
    process.env.BUS_PROFILE = 'aws';

    loadShim();

    expect(process.env.QUEUE_TRANSPORT).toBeUndefined();
    expect(process.env.EVENT_BUS).toBeUndefined();
  });

  it('SE-PROF-unknown: an unknown profile fails fast at boot', () => {
    process.env.BUS_PROFILE = 'gcp';

    expect(() => loadShim()).toThrow(/Unknown BUS_PROFILE 'gcp'/);
  });
});
