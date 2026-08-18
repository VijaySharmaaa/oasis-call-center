/**
 * Vitest setup — referenced by `test.setupFiles` in vite.config.js.
 *
 * Adds the jest-dom matchers (toBeInTheDocument, toHaveTextContent, …) and
 * guarantees each test starts with a clean DOM and no leaked fetch stub, so a
 * test that stubs global.fetch cannot silently affect the next one.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
