/**
 * Tests live in backend/tests/ — nowhere else. `roots` enforces that: a
 * *.test.js file dropped next to the source it covers simply will not run,
 * which is the intended signal to move it into tests/.
 *
 * Helpers under tests/helpers/ are plain modules (no .test.js suffix), so they
 * are required by suites without being collected as suites themselves.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Nothing here should ever reach Atlas or the Gmail API; a suite that hangs
  // is almost always an un-mocked network call, so fail fast rather than sit.
  testTimeout: 10_000,
};
