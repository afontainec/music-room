import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database tests start a fresh PGlite per test; the first one in a file also loads its
    // WASM and takes seconds on a busy runner, too close to the 5s default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
