// Intentional failure: gives the renderer's dev sample a run error (an error
// outside any test). Only used by sample.config.ts.

export default function globalTeardown(): void {
  throw new Error('connect ECONNREFUSED 127.0.0.1:5432 while cleaning up the test database (intentional)');
}
