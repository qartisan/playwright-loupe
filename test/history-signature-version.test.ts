import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src/core/redact.js';
import { SIGNATURE_VERSION, errorSignature } from '../src/core/signature.js';

/**
 * Messages that go through every rule of the signature algorithm, and the
 * default redaction applied before it (as src/core/build.ts does). Their
 * signatures, hashed together, are pinned for each SIGNATURE_VERSION.
 *
 * When this test fails, the computation changed: signatures of recorded runs
 * no longer match new ones. Do not update the digest of the current version.
 * Bump SIGNATURE_VERSION in src/core/signature.ts, add the new digest under
 * the new number, add a row to the table in docs/schema/history-v1.md and a
 * CHANGELOG note.
 */
const CORPUS: ReadonlyArray<{ message: string; runError?: boolean }> = [
  { message: '\u001b[31mError: Order 3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b failed\u001b[39m' },
  { message: 'Error: event evt_3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b rejected' },
  { message: 'GET https://api.example.com/v1/users?id=42&token=abc123secret failed' },
  { message: 'mail to jane.doe@example.com bounced at 2024-03-01T12:34:56.789Z, then 09:15:02, ts 1717171717171' },
  { message: 'ENOENT: no such file /home/runner/work/app/data.json or C:\\Users\\jane\\app\\x.json' },
  { message: 'id V1StGXR8_Z5jdHi6B-myT and cuid cjld2cjxh0000qzrmn831i7rn, hash deadbeefcafe1234' },
  { message: 'Timed out after 5000ms, then 2.5 seconds, 3 items' },
  {
    message:
      "Error: locator.click: Error: strict mode violation: getByRole('button') resolved to 3 elements:\n    1) <button>A</button> aka getByRole('button', { name: 'A' })\n    2) <button>B</button> aka getByRole('button', { name: 'B' })\n    ...\n\nCall log:\n  - waiting for getByRole('button')",
  },
  {
    message:
      "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByRole('heading')\nExpected: \"Cart\"\nReceived: \"Basket\"\nTimeout: 5000ms\n\nCall log:\n  - Expect \"toHaveText\" with timeout 5000ms",
  },
  {
    message:
      'Error: expect(response).toBeOK() failed\n\nCall log:\n  - → GET http://127.0.0.1:4000/a\n  - ← 302 Found\n  - ← 503 Service Unavailable\n',
  },
  { message: 'Error: request failed with status 429 Too Many Requests, then error 500' },
  { message: 'apiRequestContext.get: Authorization: Bearer abc.def.ghi rejected' },
  { message: '(@nightly @smoke) Error: global setup failed', runError: true },
];

/** Digest of the corpus signatures, per signature algorithm version. Never edit an existing entry. */
const DIGESTS: Readonly<Record<number, string>> = {
  6: '269d266fae71c4fd',
};

function corpusDigest(): string {
  const redactor = createRedactor();
  const signatures = CORPUS.map(({ message, runError }) => errorSignature(redactor.text(message), { runError: runError ?? false }));
  return createHash('sha256').update(signatures.join('\n')).digest('hex').slice(0, 16);
}

describe('SIGNATURE_VERSION', () => {
  it('is 6, numbered from 0.0.1', () => {
    expect(SIGNATURE_VERSION).toBe(6);
  });

  it('matches the signatures the algorithm computes (bump it when they change)', () => {
    expect(
      corpusDigest(),
      `Signatures changed: bump SIGNATURE_VERSION (src/core/signature.ts) and add the new digest under the new number; never edit the digest of version ${SIGNATURE_VERSION}.`,
    ).toBe(DIGESTS[SIGNATURE_VERSION]);
  });
});
