// Sim harness for store FSM suites — replays a scenario JSON against the REAL store.
// Scenario shape: { name, initial, steps: [{ action, args?, expect? }], final }
// - action: a named store action (invoked with args)
// - expect/final: PARTIAL-state matchers — every named path must exist and deep-equal;
//   objects match RECURSIVELY (an expected object is a subset of the actual one).
export function runScenario(useStore, transitions, scenario) {
  const store = useStore;
  let failures = 0;

  const matches = (actual, want) => {
    if (Array.isArray(want)) {
      if (!Array.isArray(actual) || actual.length !== want.length) return false;
      return want.every((w, i) => matches(actual[i], w));
    }
    if (want && typeof want === 'object') {
      if (actual === null || typeof actual !== 'object') return false;
      return Object.entries(want).every(([k, v]) => matches(actual[k], v));
    }
    return JSON.stringify(actual) === JSON.stringify(want);
  };

  const check = (label, matcher) => {
    const state = store.getState();
    for (const [path, want] of Object.entries(matcher || {})) {
      const got = path.split('.').reduce((o, k) => (o == null ? o : o[k]), state);
      if (!matches(got, want)) {
        console.error(`    ✗ ${label}: ${path} = ${JSON.stringify(got)} (want subset ${JSON.stringify(want)})`);
        failures++;
      }
    }
  };

  check('initial', scenario.initial || {});
  for (const step of scenario.steps || []) {
    const fn = store.getState().actions[step.action];
    if (typeof fn !== 'function') {
      console.error(`    ✗ unknown action: ${step.action}`);
      return false;
    }
    fn(...(step.args || []));
    check(`after ${step.action}`, step.expect || {});
  }
  check('final', scenario.final || {});
  if (failures === 0) console.log(`    scenario "${scenario.name}" green`);
  return failures === 0;
}
