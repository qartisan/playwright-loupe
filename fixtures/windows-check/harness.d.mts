// The types of harness.mjs, plain JavaScript because the kit runs without a build step.

export type Launch = [command: string, args: string[], options: object];
export interface Row {
  form: string;
  required: boolean;
  expected: string[];
  text: string;
}
export interface Outcome {
  selected?: string[];
  code?: string;
  message?: string;
  raw?: string;
}
export interface BadRow {
  length: number;
  launchLength: number;
  command: string;
  expected: number;
  selected: number | 'error';
  code?: string;
  message?: string;
  raw?: string;
}
export type Stats = Record<string, { required: boolean; ok: number; bad: BadRow[] }>;

export function runCommand(launch: Launch, env?: Record<string, string>, spawnFn?: unknown): Promise<Outcome>;
export function selectedExpected(item: Pick<Row, 'expected'>, selected: string[] | undefined): boolean;
export function runRows(options: {
  commands: readonly Row[];
  toLaunch: (text: string) => Launch;
  spawnFn?: unknown;
  worker?: () => { env: Record<string, string>; dispose: () => void };
  concurrency?: number;
}): Promise<Stats>;
export function describeBad(bad: BadRow): string;
export function countRequired(stats: Stats): { bad: number; run: number };
