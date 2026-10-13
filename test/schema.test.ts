import { describe, expect, it } from 'vitest';
import { INLINE_TEXT_LIMIT } from '../src/core/attachments.js';
import { OUTPUT_LIMIT } from '../src/core/output.js';
import {
  ATTACHMENT_KINDS,
  ATTEMPT_STATUSES,
  COMPARISON_ROLES,
  DIMENSION_SOURCES,
  OUTCOMES,
  RUN_SCOPES,
  RUN_STATUSES,
  SCHEMA_VERSION,
  type Attempt,
  type LoupeError,
  type LoupeReport,
  type Step,
  type TestCase,
} from '../src/schema/v1.js';
import { schema, schemaErrors } from './helpers/schema.js';

/*
 * How the TypeScript types (source of truth) and the JSON Schema stay in sync:
 *
 * 1. Every object in the schema is closed (`additionalProperties: false`) and
 *    lists every property as required — the TS types have no optional fields,
 *    absence is always an explicit `null`.
 * 2. The samples below are typed with `satisfies LoupeReport`: the compiler
 *    rejects a missing or unknown field, so they always have exactly the TS
 *    shape. They visit every object type, with both the null and non-null
 *    variant of each nullable field. Validating them proves the schema accepts
 *    every TS field and requires nothing the types lack.
 * 3. Enumerations are runtime constants in src/schema/v1.ts and are compared
 *    with the schema enums.
 * 4. Size limits in the schema are compared with the constants the reporter uses.
 */

type JsonObject = Record<string, unknown>;

const defs = schema['$defs'] as Record<string, JsonObject>;
const runProperties = (defs['Run']?.['properties'] ?? {}) as Record<string, JsonObject>;

function enumOf(node: JsonObject | undefined): unknown {
  return node?.['enum'];
}

/** Visits every sub-schema of the JSON Schema. */
function* subSchemas(node: unknown, path = '#'): Generator<[string, JsonObject]> {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) yield* subSchemas(item, `${path}/${index}`);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  yield [path, node as JsonObject];
  for (const [key, value] of Object.entries(node)) yield* subSchemas(value, `${path}/${key}`);
}

const error = (overrides: Partial<LoupeError> = {}): LoupeError => ({
  message: 'Error: expect(locator).toHaveText(expected) failed',
  stack: 'Error: expect(locator).toHaveText(expected) failed\n    at login.spec.ts:12:5',
  location: { file: 'auth/login.spec.ts', line: 12, column: 5 },
  snippet: '> 12 |   await expect(heading).toHaveText("Welcome");',
  signature: '0123456789ab',
  category: 'Assertion',
  ...overrides,
});

const step = (overrides: Partial<Step> = {}): Step => ({
  title: 'Click',
  subtitle: "getByRole('button')",
  category: 'pw:api',
  durationMs: 12,
  error: null,
  location: { file: 'auth/login.spec.ts', line: 10, column: 3 },
  steps: [],
  ...overrides,
});

const failedAttempt = {
  index: 0,
  status: 'failed',
  startedAt: '2026-10-12T10:00:00.000Z',
  durationMs: 1500,
  workerIndex: 0,
  errors: [error(), error({ stack: null, location: null, snippet: null, category: null })],
  steps: [
    step({
      title: 'log in',
      subtitle: null,
      category: 'test.step',
      error: error(),
      steps: [step(), step({ location: null })],
    }),
  ],
  attachments: [
    {
      name: 'square-expected.png',
      contentType: 'image/png',
      kind: 'screenshot',
      path: 'data/0123456789abcdef/0/square-expected.png',
      body: null,
      comparison: { group: 'square.png', role: 'expected' },
    },
    { name: 'note', contentType: 'text/plain', kind: 'text', path: null, body: 'hello', comparison: null },
    {
      name: 'trace',
      contentType: 'application/zip',
      kind: 'trace',
      path: 'data/0123456789abcdef-r1/0/trace.zip',
      body: null,
      comparison: null,
    },
  ],
  annotations: [{ type: 'issue', description: null }],
  stdout: { text: 'hello\n', truncated: false },
  stderr: { text: '', truncated: true },
} satisfies Attempt;

const failedTest = {
  id: '0123456789abcdef',
  repeatEachIndex: 0,
  project: 'chromium',
  file: 'auth/login.spec.ts',
  line: 8,
  column: 1,
  suitePath: ['auth', 'login'],
  title: 'logs in',
  tags: ['@layer:ui', '@smoke'],
  annotations: [
    { type: 'bug', description: 'BUG-1' },
    { type: 'slow', description: null },
  ],
  outcome: 'failed',
  expectedStatus: 'passed',
  durationMs: 1500,
  dimensions: { layer: ['ui'] },
  category: 'Assertion',
  errorSignature: '0123456789ab',
  attempts: [failedAttempt],
} satisfies TestCase;

const passedTest = {
  ...failedTest,
  id: 'fedcba9876543210',
  repeatEachIndex: 1,
  outcome: 'passed',
  dimensions: {},
  category: null,
  errorSignature: null,
  attempts: [{ ...failedAttempt, status: 'passed', errors: [], steps: [], attachments: [], annotations: [] }],
} satisfies TestCase;

const stats = { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 };

/** Uses the non-null variant of every nullable field. */
const fullReport = {
  schemaVersion: 1,
  generator: { name: 'playwright-loupe', version: '1.0.0' },
  run: {
    id: '3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b',
    startedAt: '2026-10-12T10:00:00.000Z',
    durationMs: 4200,
    status: 'failed',
    scope: 'partial',
    scopeReasons: ['grep', 'shard'],
    playwrightVersion: '1.64.0',
    workers: 4,
    shard: { current: 1, total: 2 },
    environment: { name: 'staging', ci: true, ciProvider: 'github-actions', os: 'linux-x64', nodeVersion: 'v22.0.0' },
    git: { commit: 'abc123', branch: 'main', remote: 'https://github.com/qartisan/playwright-loupe' },
    excluded: { reason: 'infrastructure outage' },
    notes: [
      { createdAt: '2026-10-12T11:00:00Z', author: 'qa', text: 'Known outage', testId: null },
      { createdAt: '2026-10-12T11:00:00+02:00', author: null, text: 'BUG-1', testId: '0123456789abcdef' },
    ],
    stats,
    errors: [
      { ...error(), project: 'chromium' },
      { ...error({ stack: null, location: null, snippet: null, category: null }), project: null },
    ],
  },
  projects: [{ name: 'chromium', testDir: '.', retries: 1, timeoutMs: 30000, stats }],
  tests: [failedTest, passedTest],
  categories: [{ name: 'Assertion', color: '#dc2626', builtIn: true }],
  dimensions: [
    { name: 'layer', source: 'tag', key: 'layer', values: ['api', 'ui'] },
    { name: 'bug', source: 'annotation', key: 'bug', values: null },
  ],
} satisfies LoupeReport;

/** Uses the null variant of every nullable field of the run. */
const minimalReport = {
  ...fullReport,
  run: {
    ...fullReport.run,
    scope: 'full',
    scopeReasons: [],
    shard: null,
    environment: { name: null, ci: false, ciProvider: null, os: 'darwin-arm64', nodeVersion: 'v24.0.0' },
    git: { commit: null, branch: null, remote: null },
    excluded: null,
    notes: [],
    errors: [],
  },
  projects: [],
  tests: [],
  categories: [],
  dimensions: [],
} satisfies LoupeReport;

describe('JSON Schema structure', () => {
  it('closes every object and requires every property', () => {
    const problems: string[] = [];
    for (const [path, node] of subSchemas(schema)) {
      const properties = node['properties'];
      if (properties === undefined || path.endsWith('/properties')) continue;
      if (node['additionalProperties'] !== false) problems.push(`${path}: additionalProperties is not false`);
      const declared = Object.keys(properties as JsonObject).sort();
      const required = [...((node['required'] as string[] | undefined) ?? [])].sort();
      if (JSON.stringify(declared) !== JSON.stringify(required)) {
        problems.push(`${path}: required ${JSON.stringify(required)} != properties ${JSON.stringify(declared)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has the same schema version as the types', () => {
    expect((schema['properties'] as Record<string, JsonObject>)['schemaVersion']?.['const']).toBe(SCHEMA_VERSION);
  });
});

describe('JSON Schema enums match the TypeScript constants', () => {
  const attachmentProperties = defs['Attachment']?.['properties'] as Record<string, JsonObject>;
  const comparison = (attachmentProperties['comparison']?.['oneOf'] as JsonObject[])[1];
  const dimensionProperties = defs['DimensionDefinition']?.['properties'] as Record<string, JsonObject>;

  it.each([
    ['run status', enumOf(runProperties['status']), RUN_STATUSES],
    ['run scope', enumOf(runProperties['scope']), RUN_SCOPES],
    ['outcome', enumOf(defs['Outcome']), OUTCOMES],
    ['attempt status', enumOf(defs['AttemptStatus']), ATTEMPT_STATUSES],
    ['attachment kind', enumOf(attachmentProperties['kind']), ATTACHMENT_KINDS],
    ['comparison role', enumOf((comparison?.['properties'] as Record<string, JsonObject>)['role']), COMPARISON_ROLES],
    ['dimension source', enumOf(dimensionProperties['source']), DIMENSION_SOURCES],
  ])('%s', (_label, fromSchema, fromTypes) => {
    expect(fromSchema).toEqual([...fromTypes]);
  });
});

describe('JSON Schema limits match the reporter constants', () => {
  it('output size', () => {
    expect((defs['Output']?.['properties'] as Record<string, JsonObject>)['text']?.['maxLength']).toBe(OUTPUT_LIMIT);
  });

  it('inline attachment body size', () => {
    const body = (defs['Attachment']?.['properties'] as Record<string, JsonObject>)['body'];
    expect((body?.['oneOf'] as JsonObject[])[1]?.['maxLength']).toBe(INLINE_TEXT_LIMIT);
  });
});

describe('typed samples validate against the JSON Schema', () => {
  it('accepts every field with non-null values', () => {
    expect(schemaErrors(fullReport)).toEqual([]);
  });

  it('accepts every nullable field as null', () => {
    expect(schemaErrors(minimalReport)).toEqual([]);
  });

  it('rejects unknown fields', () => {
    const report = structuredClone(fullReport) as unknown as { tests: Array<Record<string, unknown>> };
    report.tests[0] = { ...report.tests[0], extra: true };
    expect(schemaErrors(report)).toContain('/tests/0 must NOT have additional properties');
  });

  it('rejects missing fields', () => {
    const { errorSignature: _removed, ...test } = failedTest;
    expect(schemaErrors({ ...fullReport, tests: [test] })).toContain("/tests/0 must have required property 'errorSignature'");
  });

  it('rejects absolute and Windows paths', () => {
    for (const file of ['/repo/tests/a.spec.ts', 'C:/repo/a.spec.ts', 'auth\\a.spec.ts']) {
      expect(schemaErrors({ ...fullReport, tests: [{ ...failedTest, file }] }), file).not.toEqual([]);
    }
  });

  it('rejects a run error without project', () => {
    const report = structuredClone(fullReport) as unknown as { run: { errors: Array<Record<string, unknown>> } };
    delete report.run.errors[0]?.['project'];
    expect(schemaErrors(report)).toContain("/run/errors/0 must have required property 'project'");
  });

  it('rejects duplicate expected dimension values', () => {
    const dimensions = [{ name: 'layer', source: 'tag', key: 'layer', values: ['api', 'api'] }];
    expect(schemaErrors({ ...fullReport, dimensions })).not.toEqual([]);
  });

  it('rejects a wrong schema version', () => {
    expect(schemaErrors({ ...fullReport, schemaVersion: 2 })).not.toEqual([]);
  });
});
