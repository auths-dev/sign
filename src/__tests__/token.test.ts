import { cleanupPaths } from '../token';

describe('cleanupPaths', () => {
  it('is a no-op (ephemeral signing has no temp files)', () => {
    cleanupPaths(['/nonexistent/path']);
  });
});
