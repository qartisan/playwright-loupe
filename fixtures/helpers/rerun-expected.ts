import type { TestCase } from '../../src/schema/v1.js';
import { REDACTED } from '../../src/shared/redaction.js';
import { FIXTURE_SECRET } from '../redaction-values.js';

/**
 * What a rerun command must select in `fixtures/rerun/`, for
 * test/rerun.integration.test.ts and the Windows check (fixtures/windows-check/).
 */

type Identity = Pick<TestCase, 'project' | 'file' | 'suitePath' | 'title'>;

export function keyOf(test: Identity): string {
  return JSON.stringify([test.project, test.file, ...test.suitePath, test.title]);
}

/** The tests `rerun/twins.spec.ts` has in pairs: same string for `-g`, so they run together. Title paths. */
const TWINS: readonly (readonly [string, string])[] = [
  ['login', 'Login'],
  ['outer › same', 'outer same'],
  ['outer same › leaf', 'outer same leaf'],
  ['tail @smoke', 'tail'],
  ['tail2', 'tail2 @a'],
];

/** Project names differing by case only: `--project` and `-g` select both. */
const CASE_TWINS: Readonly<Record<string, string>> = { Case: 'case', case: 'Case' };

/** For a test of `rerun/redaction.spec.ts`: its real title; the secret and the marker read the same. */
function expectedForRedacted(test: Identity): string[] {
  const real = (text: string): string => text.split(REDACTED).join(FIXTURE_SECRET);
  const unmasked = { ...test, suitePath: test.suitePath.map(real), title: real(test.title) };
  return test.title === `with the secret ${REDACTED}` ? [keyOf(unmasked), keyOf(test)] : [keyOf(unmasked)];
}

/**
 * Titles of `rerun/paths-in-titles.spec.ts` as the report has them, once Loupe has
 * rewritten their paths. No real title reads like the first two: nothing is selected.
 */
export const REWRITTEN_TITLES: readonly string[] = ['reads data/a.json', 'reads ~/other/a.json'];

/** Rewritten too, but another test really has this title: its command selects that test. */
export const REWRITTEN_DECOY = 'reads decoy.json';

/** What a command must select for one test: the test, and the tests it cannot be told apart from. */
export function expectedFor(test: Identity): string[] {
  if (test.file === 'redaction.spec.ts') return expectedForRedacted(test);
  if (test.file === 'paths-in-titles.spec.ts' && REWRITTEN_TITLES.includes(test.title)) return [];
  const titlePath = [...test.suitePath, test.title].join(' › ');
  const pair = test.file === 'twins.spec.ts' ? TWINS.find((twins) => twins.includes(titlePath)) : undefined;
  const titles = (pair ?? [titlePath]).map((twin) => twin.split(' › '));
  const projects = test.project in CASE_TWINS ? [test.project, CASE_TWINS[test.project] ?? ''] : [test.project];
  return projects.flatMap((project) =>
    titles.map((parts) => keyOf({ project, file: test.file, suitePath: parts.slice(0, -1), title: parts.at(-1) ?? '' })),
  );
}
