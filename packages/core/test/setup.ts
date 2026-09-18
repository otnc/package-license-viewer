import { afterEach, vi } from "vitest";

// Mirrors node:test's automatic per-test mock/timer reset, so a test that calls
// vi.useFakeTimers() never leaks real-timer confusion into the next one.
afterEach(() => {
  vi.useRealTimers();
});
