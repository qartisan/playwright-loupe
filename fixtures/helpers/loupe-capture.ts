import { appendFileSync } from 'node:fs';
import type { LoupeReporterOptions } from '../../src/config/index.js';
import type LoupeReporterType from '../../src/index.js';

// The built reporter, as the other configs load it: by path at run time (typecheck runs before the build).
const built = '../../dist/index.js';
const LoupeReporter = ((await import(built)) as { default: typeof LoupeReporterType }).default;

// The leak canary's reporter (see test/leak.integration.test.ts): Loupe's own, wrapped so that everything Loupe
// writes, and only that, is also appended to LOUPE_FIXTURE_CAPTURE. Playwright's own output (its progress
// lines print the canary's test titles in clear) never reaches the file, so the test searches all of Loupe's
// output, every line of a multi-line message included. Without the variable, it is Loupe's reporter unchanged.

const file = process.env['LOUPE_FIXTURE_CAPTURE'];

const record = (text: string): void => {
  if (file) appendFileSync(file, text);
};
const show = (args: unknown[]): string => `${args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? (arg.stack ?? arg.message) : String(arg))).join(' ')}\n`;

/**
 * Runs `run` with the standard streams teed to the file, a thrown error recorded too. `console.*` writes through
 * them, so it is captured once, as written.
 */
function captured<T>(run: () => T): T {
  if (!file) return run();
  const saved = { out: process.stdout.write, err: process.stderr.write };
  const tee = (stream: NodeJS.WriteStream, original: typeof process.stdout.write) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      record(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return (original as (...args: unknown[]) => boolean).call(stream, chunk, ...rest);
    }) as typeof process.stdout.write;
  process.stdout.write = tee(process.stdout, saved.out);
  process.stderr.write = tee(process.stderr, saved.err);
  const restore = (): void => {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
  };
  const thrown = (error: unknown): never => {
    record(show([error]));
    throw error;
  };
  let result: T;
  try {
    result = run();
  } catch (error) {
    restore();
    return thrown(error);
  }
  if (result instanceof Promise) return result.then((value) => (restore(), value), (error: unknown) => (restore(), thrown(error))) as T;
  restore();
  return result;
}

export default class CapturedLoupe {
  constructor(options: LoupeReporterOptions) {
    const inner = captured(() => new LoupeReporter(options));
    // Every hook Loupe has, called on Loupe itself, its writes captured.
    return new Proxy(inner, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (...args: unknown[]) => captured(() => (value as (...args: unknown[]) => unknown).apply(target, args)) : value;
      },
    });
  }
}
