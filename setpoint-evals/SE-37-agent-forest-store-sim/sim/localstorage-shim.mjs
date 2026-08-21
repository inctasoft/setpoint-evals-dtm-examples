// localStorage shim for the sim — zustand `persist` resolves window.localStorage at store-create
// time; node has neither `window` nor `localStorage`. Imported/evaluated BEFORE the real store
// module (run.mjs uses ordered dynamic imports). Map-backed, per-process (one scenario per process).
const m = new Map();
const storage = {
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => void m.set(k, String(v)),
  removeItem: (k) => void m.delete(k),
  clear: () => m.clear(),
  key: (i) => [...m.keys()][i] ?? null,
  get length() {
    return m.size;
  },
};
globalThis.localStorage = storage;
globalThis.window = globalThis.window ?? {};
globalThis.window.localStorage = storage;
