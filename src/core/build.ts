import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Location,
  Suite,
  TestCase as PwTestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import type {
  Annotation,
  Attachment,
  Attempt,
  LoupeError,
  LoupeReport,
  Outcome,
  Project,
  RunError,
  RunScope,
  SourceLocation,
  Stats,
  Step,
  TestCase,
} from '../schema/v1.js';
import {
  INLINE_TEXT_LIMIT,
  attachmentKind,
  bodyFileName,
  comparisonOf,
  isTextContentType,
  safeFileName,
  uniqueFileName,
} from './attachments.js';
import { DEFAULT_CATEGORIES, createCategorizer, type CategoriesOptions, type ErrorText } from './categories.js';
import { DEFAULT_DIMENSIONS, createDimensions, type DimensionsOptions } from './dimensions.js';
import { computeTestId, relativePosix } from './identity.js';
import { detectEnvironment, detectGit, type LocalGitSource } from './metadata.js';
import { collectOutput } from './output.js';
import { createPathRewriter, isStrictlyUnder, rewriteReportPaths, rootsFromStack, type PathRewriter } from './paths.js';
import { esmImportLocation, isUsableLocation } from './runErrors.js';
import { detectScopeReasons, resolveScope } from './scope.js';
import { DEFAULT_REDACT, createRedactor, mapReportStrings, type AttemptRedactor, type RedactOptions } from './redact.js';
import { errorSignature, stripAnsi, stripMergeTagPrefix } from './signature.js';

/** Folder, inside the report folder, that holds the copied attachments. */
export const DATA_FOLDER = 'data';

export interface BuildOptions {
  runId: string;
  generatorVersion: string;
  /** Absolute report folder; attachments are copied under `<outputFolder>/data/`. */
  outputFolder: string;
  env: Readonly<Record<string, string | undefined>>;
  scopeOverride: RunScope | null;
  /** `run.environment.name`, from the config (`environment`, `LOUPE_ENV`). */
  environmentName: string | null;
  categories?: CategoriesOptions;
  dimensions?: DimensionsOptions;
  /** Errors received through `onError`, with the project of the worker when Playwright gives it. */
  runErrors?: ReadonlyArray<{ error: TestError; project: string | null }>;
  /** Secret redaction; default: the built-in names, no env values. */
  redact?: RedactOptions;
  /** Local repository state, the last source of `run.git`; omitted when the local read is off (`git.local`). */
  localGit?: LocalGitSource;
  /** Home directory of the machine writing the report (`os.homedir()`), masked as `~`; default: null, generic home forms only. */
  home?: string | null;
}

const OUTCOMES: Record<ReturnType<PwTestCase['outcome']>, Outcome> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
};

type PwAttachment = TestResult['attachments'][number];

/** Copies or writes attachments into the report folder, with collision-safe names per folder. */
class AttachmentStore {
  private readonly taken = new Map<string, Set<string>>();

  constructor(private readonly outputFolder: string) {}

  /** Removes attachments left by a previous report in the same folder. */
  async reset(): Promise<void> {
    await rm(path.join(this.outputFolder, DATA_FOLDER), { recursive: true, force: true });
  }

  async add(folder: string, attachment: PwAttachment): Promise<Attachment> {
    const { name, contentType } = attachment;
    const result: Attachment = {
      name,
      contentType,
      kind: attachmentKind(name, contentType),
      path: null,
      body: null,
      comparison: comparisonOf(name, contentType),
    };

    if (attachment.path) {
      result.path = await this.store(folder, safeFileName(path.basename(attachment.path)), (target) =>
        copyFile(attachment.path as string, target),
      );
    } else if (attachment.body) {
      const body = attachment.body;
      if (isTextContentType(contentType) && body.byteLength <= INLINE_TEXT_LIMIT) {
        result.body = body.toString('utf8');
      } else {
        result.path = await this.store(folder, bodyFileName(name, contentType), (target) => writeFile(target, body));
      }
    }
    return result;
  }

  /** Writes one file and returns its report-relative path, or null when the source file is missing. */
  private async store(folder: string, fileName: string, write: (target: string) => Promise<void>): Promise<string | null> {
    const taken = this.taken.get(folder) ?? new Set<string>();
    this.taken.set(folder, taken);
    const unique = uniqueFileName(fileName, taken);
    const target = path.join(this.outputFolder, ...folder.split('/'), unique);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await write(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return `${folder}/${unique}`;
  }
}

/** A test as `derivedRoots` reads it: its file, relative to the root dir, and the stacks of its errors. */
export interface StackSource {
  file: string;
  stacks: readonly string[];
}

/** The stacks of every error of a test: attempts and steps, at any depth. */
export function stackSource(test: TestCase): StackSource {
  const stacks: string[] = [];
  const add = (error: LoupeError | null): void => {
    if (error?.stack) stacks.push(error.stack);
  };
  const visitSteps = (steps: readonly Step[]): void => {
    for (const step of steps) {
      add(step.error);
      visitSteps(step.steps);
    }
  };
  for (const attempt of test.attempts) {
    attempt.errors.forEach(add);
    visitSteps(attempt.steps);
  }
  return { file: test.file, stacks };
}

/**
 * Roots shown by the stacks of the tests' own files (see `rootsFromStack`).
 * They differ from `rootDir` when the stacks were recorded on another
 * machine (`merge-reports` with a merge config); in a direct run, they equal
 * it.
 *
 * Each stack votes once for each root it shows. A single vote is enough: a
 * root needs a frame ending in `/<test file>`, the test's own file. The
 * order (most votes, then shortest, then code point order) only decides,
 * after `rootDir`, which root an ancestor shared by several roots is
 * relative to (rule 2 of src/core/paths.ts).
 *
 * A root strictly inside `rootDir` or inside another derived root is
 * discarded: the longest root wins, so it would cut the segments between
 * the two out of every path under it. It can only come from a file of
 * another directory named like the test file.
 */
export function derivedRoots(sources: readonly StackSource[], rootDir: string): string[] {
  const votes = new Map<string, number>();
  for (const { file, stacks } of sources) {
    for (const stack of stacks) {
      for (const root of rootsFromStack(stack, file)) votes.set(root, (votes.get(root) ?? 0) + 1);
    }
  }
  const pool = [rootDir, ...votes.keys()];
  return [...votes]
    .filter(([root]) => !pool.some((other) => isStrictlyUnder(root, other)))
    .sort(([a, aVotes], [b, bVotes]) => bVotes - aVotes || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([root]) => root);
}

/** A relative path with POSIX separators, as the schema's `RelativePath` accepts it. */
function isRelativePath(file: string): boolean {
  return file !== '' && !file.includes('\\') && !file.startsWith('/') && !/^[A-Za-z]:/.test(file);
}

/**
 * `location.file` from the absolute `file` of a location: the file rules of
 * `paths` (rules 1 to 3 of src/core/paths.ts); when they leave it absolute
 * (`/opt/x.ts`), the path relative to `rootDir` (`../../opt/x.ts`). Null when
 * neither is a relative POSIX path, as the schema requires: another drive or
 * a UNC share on Windows. The stack frame still shows the path.
 */
export function locationFile(file: string, rootDir: string, paths: PathRewriter, pathImpl: path.PlatformPath = path): string | null {
  const rewritten = paths.file(file);
  if (isRelativePath(rewritten)) return rewritten;
  if (!pathImpl.isAbsolute(file) || !pathImpl.isAbsolute(rootDir)) return null;
  const relative = relativePosix(rootDir, file, pathImpl);
  return isRelativePath(relative) ? relative : null;
}

/** Playwright reports -1 for steps and attempts that never finished. */
function toMs(duration: number): number {
  return Math.max(0, Math.round(duration));
}

function emptyStats(): Stats {
  return { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
}

function countOutcome(stats: Stats, outcome: Outcome): void {
  stats.total++;
  stats[outcome]++;
}

function toAnnotation(annotation: { type: string; description?: string | undefined }): Annotation {
  return { type: annotation.type, description: annotation.description ?? null };
}

function isDefaultGrep(grep: RegExp | RegExp[]): boolean {
  return grep instanceof RegExp && grep.source === '.*' && grep.flags === '';
}

/**
 * Names of the projects with `default: false` (Playwright 1.64+). Only
 * Playwright's internal config has the flag, under a private symbol; undefined
 * when it is missing (older versions, merge-reports) or has another shape.
 */
function nonDefaultProjects(config: FullConfig): string[] | undefined {
  const symbol = Object.getOwnPropertySymbols(config).find((candidate) => candidate.description === 'configInternalSymbol');
  const internal = symbol ? (config as unknown as Record<symbol, unknown>)[symbol] : undefined;
  const projects = (internal as { projects?: unknown } | undefined)?.projects;
  if (!Array.isArray(projects)) return undefined;
  const names: string[] = [];
  for (const project of projects as Array<{ default?: unknown; project?: { name?: unknown } }>) {
    if (typeof project.default !== 'boolean' || typeof project.project?.name !== 'string') return undefined;
    if (!project.default) names.push(project.project.name);
  }
  return names;
}

/** `test.only` / `describe.only` leave Playwright's internal `_only` flag on the node or an ancestor. */
function isFocused(test: PwTestCase): boolean {
  for (let node: PwTestCase | Suite | undefined = test; node; node = node.parent) {
    if ((node as { _only?: unknown })._only === true) return true;
  }
  return false;
}

/**
 * Titles of the failing steps leading to `error`, outermost first: the path to
 * the deepest step that ended with the same message. Empty when no step did.
 */
export function failingSteps(
  steps: readonly TestStep[],
  error: TestError,
  title: (step: TestStep) => string = (step) => step.title,
): string[] {
  const message = error.message ?? error.value;
  if (message === undefined) return [];
  for (const step of [...steps].reverse()) {
    if (!step.error || (step.error.message ?? step.error.value) !== message) continue;
    return [title(step), ...failingSteps(step.steps, error, title)];
  }
  // A step may fail with a wrapped message while one of its children has the exact one.
  for (const step of [...steps].reverse()) {
    const inner = failingSteps(step.steps, error, title);
    if (inner.length > 0) return [title(step), ...inner];
  }
  return [];
}

/**
 * Text an error is categorized on. `steps`: titles of the failing steps, outermost first.
 * Run errors lose the `merge-reports` tag prefix, so rules match the same text merged or not.
 */
export function errorText(
  message: string,
  stack: string | null,
  steps: readonly string[],
  runError: boolean,
): ErrorText {
  return {
    message: runError ? stripMergeTagPrefix(message) : message,
    stack: runError && stack !== null ? stripMergeTagPrefix(stack) : stack,
    step: steps.length > 0 ? steps.join('\n') : null,
  };
}

export async function buildReport(
  config: FullConfig,
  suite: Suite,
  result: FullResult,
  options: BuildOptions,
): Promise<LoupeReport> {
  const rootDir = config.rootDir;
  const store = new AttachmentStore(options.outputFolder);
  const categorizer = createCategorizer(options.categories ?? DEFAULT_CATEGORIES);
  const redactor = createRedactor(options.redact ?? DEFAULT_REDACT);
  const dimensionSet = createDimensions(options.dimensions ?? DEFAULT_DIMENSIONS);
  const categories = new Set<string>();
  const usedDimensions = new Set<string>();

  /** Absolute file of every location, rewritten once every stack is known (see the end). */
  const locationFiles = new Map<SourceLocation, string>();
  // `<anonymous>` and other non-paths are not locations.
  const toLocation = (location: Location | undefined): SourceLocation | null => {
    if (!isUsableLocation(location)) return null;
    const result = { file: relativePosix(rootDir, location.file), line: location.line, column: location.column };
    locationFiles.set(result, location.file);
    return result;
  };

  /**
   * `steps`: titles of the failing steps leading to the error, outermost first.
   * `runError`: the `merge-reports` tag prefix is ignored by categories and the signature, kept in `message` and `stack`.
   * `redact`: applied to the message and the stack before the signature and the category, so they never depend on a secret.
   */
  const toError = (
    error: TestError,
    redact: (text: string) => string,
    steps: readonly string[] = [],
    location = error.location,
    runError = false,
  ): LoupeError => {
    const message = redact(stripAnsi(error.message ?? error.value ?? ''));
    const stack = error.stack ? redact(stripAnsi(error.stack)) : null;
    const category = categorizer.categorize(errorText(message, stack, steps, runError));
    categories.add(category);
    return {
      message,
      stack,
      location: toLocation(location),
      snippet: error.snippet ? stripAnsi(error.snippet) : null,
      signature: errorSignature(message, { runError }),
      category,
    };
  };

  const toStep = (step: TestStep, parents: readonly string[], redact: AttemptRedactor): Step => {
    const title = redact.title(step);
    const chain = [...parents, title];
    // `subtitle` exists from Playwright 1.63. Before, the target of an action is in
    // the title on 1.52 (`locator.getByRole('button').click`), and nowhere on
    // 1.53–1.62 (`Click`, `Fill "<value>"`).
    const subtitle = (step as { subtitle?: string }).subtitle;
    return {
      title,
      subtitle: subtitle === undefined ? null : redact.text(subtitle),
      category: step.category,
      durationMs: toMs(step.duration),
      error: step.error ? toError(step.error, redact.text, chain) : null,
      location: toLocation(step.location),
      steps: step.steps.map((child) => toStep(child, chain, redact)),
    };
  };

  const toAttempt = async (attempt: TestResult, folder: string): Promise<Attempt> => {
    const attachments: Attachment[] = [];
    for (const attachment of attempt.attachments) {
      attachments.push(await store.add(`${folder}/${attempt.retry}`, attachment));
    }
    const redact = redactor.attempt(attempt.steps);
    return {
      index: attempt.retry,
      status: attempt.status,
      startedAt: attempt.startTime.toISOString(),
      durationMs: toMs(attempt.duration),
      workerIndex: attempt.workerIndex,
      errors: attempt.errors.map((error) => toError(error, redact.text, failingSteps(attempt.steps, error, redact.title))),
      steps: attempt.steps.map((step) => toStep(step, [], redact)),
      attachments,
      annotations: attempt.annotations.map(toAnnotation),
      stdout: collectOutput(attempt.stdout),
      stderr: collectOutput(attempt.stderr),
    };
  };

  await store.reset();

  const tests: TestCase[] = [];
  for (const test of suite.allTests()) {
    // titlePath() is ['', project, file, ...describes, title]; anonymous describes are omitted.
    const suitePath = test.titlePath().slice(3, -1);
    const project = test.parent.project()?.name ?? '';
    const file = relativePosix(rootDir, test.location.file);
    const id = computeTestId(project, file, [...suitePath, test.title]);
    const folder = `${DATA_FOLDER}/${id}${test.repeatEachIndex > 0 ? `-r${test.repeatEachIndex}` : ''}`;

    const attempts: Attempt[] = [];
    for (const attempt of test.results) attempts.push(await toAttempt(attempt, folder));

    const annotations = [
      ...test.annotations.map(toAnnotation),
      ...attempts.flatMap((attempt) => attempt.annotations),
    ];
    const dimensions = dimensionSet.of(test.tags, annotations);
    for (const name of Object.keys(dimensions)) usedDimensions.add(name);

    // A failing attempt did not end as expected (a test.fail() failing as expected is not one).
    const lastFailing = attempts.findLast(
      (attempt) => attempt.status !== test.expectedStatus && attempt.status !== 'skipped',
    );
    const firstError = lastFailing?.errors[0];

    tests.push({
      id,
      repeatEachIndex: test.repeatEachIndex,
      project,
      file,
      line: test.location.line,
      column: test.location.column,
      suitePath,
      title: test.title,
      tags: [...test.tags],
      annotations: test.annotations.map(toAnnotation),
      outcome: OUTCOMES[test.outcome()],
      expectedStatus: test.expectedStatus,
      durationMs: attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
      dimensions,
      category: firstError?.category ?? null,
      errorSignature: firstError?.signature ?? null,
      attempts,
    });
  }

  const projectStats = new Map<string, Stats>();
  const runStats = emptyStats();
  for (const test of tests) {
    countOutcome(runStats, test.outcome);
    const stats = projectStats.get(test.project) ?? emptyStats();
    projectStats.set(test.project, stats);
    countOutcome(stats, test.outcome);
  }

  const projects: Project[] = [];
  for (const projectSuite of suite.suites) {
    const project = projectSuite.project();
    if (!project || projects.some((known) => known.name === project.name)) continue;
    projects.push({
      name: project.name,
      testDir: relativePosix(rootDir, project.testDir),
      retries: project.retries,
      timeoutMs: project.timeout,
      stats: projectStats.get(project.name) ?? emptyStats(),
    });
  }

  // Newer Playwright versions expose more about the CLI; read them when present.
  const extra = config as { argv?: string[]; filteredProjects?: Array<{ name: string }> };
  const detected = detectScopeReasons({
    argv: extra.argv ?? process.argv,
    configGrep: !isDefaultGrep(config.grep) || config.grepInvert !== null,
    shard: config.shard !== null,
    projects: config.projects.map((project) => ({
      name: project.name,
      dependencies: project.dependencies,
      teardown: project.teardown,
    })),
    filteredProjects: extra.filteredProjects?.map((project) => project.name),
    nonDefaultProjects: nonDefaultProjects(config),
    runProjects: projects.map((project) => project.name),
    only: suite.allTests().some(isFocused),
  });
  const actualWorkers = config.metadata['actualWorkers'];

  const errors: RunError[] = [];
  for (const { error, project } of options.runErrors ?? []) {
    const message = stripAnsi(error.message ?? error.value ?? '');
    const location = isUsableLocation(error.location) ? error.location : ((await esmImportLocation(message)) ?? undefined);
    errors.push({ ...toError(error, redactor.text, [], location, true), project });
  }

  const report: LoupeReport = {
    schemaVersion: 1,
    generator: { name: 'playwright-loupe', version: options.generatorVersion },
    run: {
      id: options.runId,
      startedAt: result.startTime.toISOString(),
      durationMs: toMs(result.duration),
      status: result.status,
      ...resolveScope(detected, options.scopeOverride),
      playwrightVersion: config.version,
      workers: typeof actualWorkers === 'number' ? actualWorkers : config.workers,
      shard: config.shard ? { current: config.shard.current, total: config.shard.total } : null,
      environment: detectEnvironment(options.env, options.environmentName, process.platform, process.arch, process.version),
      git: detectGit(config.metadata, options.env, options.localGit),
      excluded: null,
      notes: [],
      stats: runStats,
      errors,
    },
    projects,
    tests,
    categories: categorizer.definitions(categories),
    dimensions: dimensionSet.definitions(usedDimensions),
  };

  // Absolute paths, last: ids, signatures and categories are computed from the original text, and
  // redaction sees it too. Roots: the root dir, then those the stacks show (merge-reports -c).
  const paths = createPathRewriter({ roots: [rootDir, ...derivedRoots(tests.map(stackSource), rootDir)], home: options.home ?? null });
  // Merged reports: Playwright does not rebase error locations, which point to the blob's machine.
  const relocate = (holder: { location: SourceLocation | null }): void => {
    const file = holder.location ? locationFiles.get(holder.location) : undefined;
    if (!holder.location || file === undefined) return;
    const relative = locationFile(file, rootDir, paths);
    if (relative === null) holder.location = null;
    else holder.location.file = relative;
  };
  const relocateSteps = (steps: readonly Step[]): void => {
    for (const step of steps) {
      relocate(step);
      if (step.error) relocate(step.error);
      relocateSteps(step.steps);
    }
  };
  for (const test of tests) {
    for (const attempt of test.attempts) {
      attempt.errors.forEach(relocate);
      relocateSteps(attempt.steps);
    }
  }
  errors.forEach(relocate);
  // URL parameters and env values (redact.env) are redacted in every other string: test titles, annotations, outputs, attachment bodies...
  const redacted = redactor.rewritesStrings ? mapReportStrings(report, redactor.strings) : report;
  return rewriteReportPaths(redacted, paths);
}
