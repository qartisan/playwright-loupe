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
import { DEFAULT_CATEGORIES, createCategorizer, type CategoriesOptions } from './categories.js';
import { DEFAULT_DIMENSIONS, createDimensions, type DimensionsOptions } from './dimensions.js';
import { computeTestId, relativePosix } from './identity.js';
import { detectEnvironment, detectGit } from './metadata.js';
import { collectOutput } from './output.js';
import { esmImportLocation, isUsableLocation } from './runErrors.js';
import { detectScopeReasons, resolveScope } from './scope.js';
import { errorSignature, stripAnsi } from './signature.js';

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
export function failingSteps(steps: readonly TestStep[], error: TestError): string[] {
  const message = error.message ?? error.value;
  if (message === undefined) return [];
  for (const step of [...steps].reverse()) {
    if (!step.error || (step.error.message ?? step.error.value) !== message) continue;
    return [step.title, ...failingSteps(step.steps, error)];
  }
  // A step may fail with a wrapped message while one of its children has the exact one.
  for (const step of [...steps].reverse()) {
    const inner = failingSteps(step.steps, error);
    if (inner.length > 0) return [step.title, ...inner];
  }
  return [];
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
  const dimensionSet = createDimensions(options.dimensions ?? DEFAULT_DIMENSIONS);
  const categories = new Set<string>();
  const usedDimensions = new Set<string>();

  // `<anonymous>` and other non-paths are not locations.
  const toLocation = (location: Location | undefined): SourceLocation | null =>
    isUsableLocation(location)
      ? { file: relativePosix(rootDir, location.file), line: location.line, column: location.column }
      : null;

  /** `steps`: titles of the failing steps leading to the error, outermost first. */
  const toError = (error: TestError, steps: readonly string[] = [], location = error.location): LoupeError => {
    const message = stripAnsi(error.message ?? error.value ?? '');
    const stack = error.stack ? stripAnsi(error.stack) : null;
    const category = categorizer.categorize({ message, stack, step: steps.length > 0 ? steps.join('\n') : null });
    categories.add(category);
    return {
      message,
      stack,
      location: toLocation(location),
      snippet: error.snippet ? stripAnsi(error.snippet) : null,
      signature: errorSignature(message),
      category,
    };
  };

  const toStep = (step: TestStep, parents: readonly string[]): Step => {
    const chain = [...parents, step.title];
    return {
      title: step.title,
      // `subtitle` exists from Playwright 1.61; older versions keep the target in the title.
      subtitle: (step as { subtitle?: string }).subtitle ?? null,
      category: step.category,
      durationMs: toMs(step.duration),
      error: step.error ? toError(step.error, chain) : null,
      location: toLocation(step.location),
      steps: step.steps.map((child) => toStep(child, chain)),
    };
  };

  const toAttempt = async (attempt: TestResult, folder: string): Promise<Attempt> => {
    const attachments: Attachment[] = [];
    for (const attachment of attempt.attachments) {
      attachments.push(await store.add(`${folder}/${attempt.retry}`, attachment));
    }
    return {
      index: attempt.retry,
      status: attempt.status,
      startedAt: attempt.startTime.toISOString(),
      durationMs: toMs(attempt.duration),
      workerIndex: attempt.workerIndex,
      errors: attempt.errors.map((error) => toError(error, failingSteps(attempt.steps, error))),
      steps: attempt.steps.map((step) => toStep(step, [])),
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
    runProjects: projects.map((project) => project.name),
    only: suite.allTests().some(isFocused),
  });
  const actualWorkers = config.metadata['actualWorkers'];

  const errors: RunError[] = [];
  for (const { error, project } of options.runErrors ?? []) {
    const message = stripAnsi(error.message ?? error.value ?? '');
    const location = isUsableLocation(error.location) ? error.location : ((await esmImportLocation(message)) ?? undefined);
    errors.push({ ...toError(error, [], location), project });
  }

  return {
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
      git: detectGit(config.metadata, options.env),
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
}
