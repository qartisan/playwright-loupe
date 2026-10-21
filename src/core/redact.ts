import { readFileSync } from 'node:fs';
import type { RedactMode } from '../config/types.js';

/**
 * Secret redaction, applied by the core before signatures and categories are
 * computed and before anything is written. Three mechanisms (see "Secret
 * redaction" in docs/config.md):
 *
 * - A, input steps: the value typed by `fill`, `type`, `pressSequentially`,
 *   `keyboard.type` or `keyboard.insertText` is replaced when the target
 *   (step subtitle, from Playwright 1.63) or the source line of the call has a
 *   secret-looking name. The same value is then redacted in the attempt's
 *   errors (Playwright repeats it in the call log: `fill("<value>")`).
 * - C, HTTP headers and URL parameters: values of header lines with a
 *   secret-looking name, as Playwright prints them in call logs
 *   (`- cookie: <value>`), and of URL query or fragment parameters with a
 *   secret-looking name (`?token=<value>`), wherever URLs appear.
 * - B, environment values: the values of the variables listed in
 *   `redact.env`, everywhere in the report except snippets and attachment paths.
 *
 * A and C share one list of secret-looking names. Attachment files (traces,
 * screenshots, videos) are never altered.
 */

/** What replaces a secret. */
export const REDACTED = '[redacted]';

/** Values shorter than this are only redacted in quoted form (A), or not used at all (B): too many false matches. */
export const MIN_SECRET_LENGTH = 6;

/**
 * Default secret-looking names, for A (locators, source lines) and C (header
 * and URL parameter names). A string matches whole words, see `createNameMatcher`; a RegExp is
 * tested as is.
 */
export const DEFAULT_SECRET_NAMES: ReadonlyArray<string | RegExp> = [
  // As a substring: newPassword, passwordConfirm, Passphrase, passwd.
  /pass(?:word|wd|phrase)/i,
  'pwd',
  'passcode',
  'secret',
  'token',
  'otp',
  'totp',
  'pin',
  'api key',
  'apikey',
  'private key',
  'credential',
  'cookie',
  'session',
  'authorization',
  'auth',
  'bearer',
  'jwt',
  'csrf',
  'xsrf',
];

/**
 * Lowercase words of a name or a line: split on anything but ASCII letters and
 * digits, and on camelCase boundaries (`passwordInput` → password, input;
 * `APIKey` → api, key).
 */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/**
 * Tells whether a text has a secret-looking name. A string pattern matches
 * consecutive whole words, case-insensitively, each word allowing a trailing
 * "s": `auth` matches `x-auth-token` and `authToken` but not `Author`; `pin`
 * matches `PIN code` but not `spinner`; `api key` matches `x-api-key`, `apiKey`
 * and `API_KEY`. A RegExp is tested on the text as is.
 */
export function createNameMatcher(patterns: ReadonlyArray<string | RegExp>): (text: string) => boolean {
  const regexps = patterns.filter((pattern): pattern is RegExp => pattern instanceof RegExp);
  const sequences = patterns.filter((pattern): pattern is string => typeof pattern === 'string').map(words).filter((list) => list.length > 0);
  if (regexps.length === 0 && sequences.length === 0) return () => false;
  return (text) => {
    if (regexps.some((pattern) => pattern.test(text))) return true;
    if (sequences.length === 0) return false;
    const textWords = words(text);
    return sequences.some((sequence) =>
      textWords.some((_, start) =>
        sequence.every((word, offset) => {
          const candidate = textWords[start + offset];
          return candidate === word || candidate === `${word}s`;
        }),
      ),
    );
  };
}

/**
 * Value input steps, as Playwright titles them:
 * - 1.53+: `Fill "<value>"`, `Type "<value>"` (`type`, `pressSequentially`,
 *   `keyboard.type`), `Insert "<value>"` (`keyboard.insertText`). Quotes in
 *   the value are not escaped, so the value runs to the last quote; newlines
 *   are written `\n`.
 * - 1.52: `locator.fill(<value>)`, `locator.getByLabel('Password').type(<value>)`,
 *   `locator.getByLabel('Password').pressSequentially(<value>)`,
 *   `keyboard.type(<value>)`, `keyboard.insertText(<value>)`. The target is
 *   part of the title for `type` and `pressSequentially` only.
 */
const INPUT_TITLE = /^(Fill|Type|Insert) "([\s\S]*)"$/;
const LEGACY_INPUT_TITLE = /^((?:locator|page|frame|keyboard|elementHandle)\b.*?)\.(fill|type|pressSequentially|insertText)\(([\s\S]*)\)$/;

export interface InputStep {
  /** The title with the value replaced by `[redacted]`. */
  redacted: string;
  value: string;
  /** Target written in the title (Playwright 1.52), null otherwise. */
  target: string | null;
}

export function parseInputStep(title: string): InputStep | null {
  const current = INPUT_TITLE.exec(title);
  if (current) return { redacted: `${current[1]} "${REDACTED}"`, value: current[2] as string, target: null };
  const legacy = LEGACY_INPUT_TITLE.exec(title);
  if (legacy) {
    const [, target, action, value] = legacy as unknown as [string, string, string, string];
    return { redacted: `${target}.${action}(${REDACTED})`, value, target };
  }
  return null;
}

/** The part of a Playwright step redaction reads. */
export interface StepLike {
  title: string;
  category: string;
  location?: { file: string; line: number } | undefined;
  steps: readonly StepLike[];
}

/**
 * A header line as Playwright prints it in a call log (`  - cookie: <value>`),
 * or a bare `Name: value` line. Header names are tokens: no spaces.
 */
const HEADER_LINE = /^([ \t]*(?:-[ \t]+)?)([A-Za-z0-9!#$%&'*+.^_`|~-]+):[ \t]+\S.*$/gm;

/**
 * A URL query or fragment parameter: `?token=<value>`, `&access_token=<value>`,
 * `#access_token=<value>` (OAuth implicit flow). Only after `?`, `&` or `#`, so
 * a bare `token=abc` in prose is left alone. The value stops at the next
 * parameter, the fragment, whitespace, a quote, a bracket or a parenthesis.
 */
const URL_PARAM = /([?&#])([A-Za-z0-9_.~%-]+)=(\[redacted\]|[^&#\s"'`<>()[\]]+)/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces every occurrence of `values` with `[redacted]`, longest first. An
 * existing `[redacted]` is left alone, so applying it twice changes nothing
 * even when a value is part of the word "redacted".
 */
function valueReplacer(values: readonly string[]): (text: string) => string {
  const unique = [...new Set(values)].filter((value) => value !== '').sort((a, b) => b.length - a.length);
  if (unique.length === 0) return (text) => text;
  const pattern = new RegExp([escapeRegExp(REDACTED), ...unique.map(escapeRegExp)].join('|'), 'g');
  return (text) => text.replace(pattern, REDACTED);
}

export interface RedactOptions {
  /** `extend`: `patterns` add to the default names. `replace`: only `patterns`; `[]` turns A and C off. */
  mode: RedactMode;
  patterns: ReadonlyArray<string | RegExp>;
  /** Values of the `redact.env` variables, already filtered by `secretValues`. */
  values: readonly string[];
  /** Reads a source file; null when it cannot be read. Default: from disk. */
  readSource?: (file: string) => string | null;
}

export const DEFAULT_REDACT: RedactOptions = { mode: 'extend', patterns: [], values: [] };

/** Redaction for the steps and errors of one attempt. */
export interface AttemptRedactor {
  /** A step title: input value (A), values typed in this attempt, URL parameters (C), env values (B). */
  title(step: StepLike): string;
  /** An error message or stack, a subtitle: values typed in this attempt, header values and URL parameters (C), env values (B). */
  text(text: string): string;
}

export interface Redactor {
  /** Finds the secret input steps of an attempt (A) and returns the redaction for its steps and errors. */
  attempt(steps: readonly StepLike[]): AttemptRedactor;
  /** Text outside any attempt (run errors): header values and URL parameters (C), env values (B). */
  text(text: string): string;
  /** Env values only (B). */
  values(text: string): string;
  /** URL parameters (C) and env values (B), for every other string of the report: outputs, annotations, test titles... */
  strings(text: string): string;
  /** False when `strings` never changes anything (no names and no env values): the report needs no rewriting pass. */
  rewritesStrings: boolean;
}

function readFromDisk(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function createRedactor(options: RedactOptions = DEFAULT_REDACT): Redactor {
  const namePatterns = options.mode === 'extend' ? [...DEFAULT_SECRET_NAMES, ...options.patterns] : options.patterns;
  const names = createNameMatcher(namePatterns);
  const envValues = valueReplacer(options.values);
  const readSource = options.readSource ?? readFromDisk;
  const sources = new Map<string, string[] | null>();

  /** The source line of a step, from disk; null when the file cannot be read (merge-reports without the code). */
  const sourceLine = (location: StepLike['location']): string | null => {
    if (!location) return null;
    if (!sources.has(location.file)) sources.set(location.file, readSource(location.file)?.split(/\r?\n/) ?? null);
    return sources.get(location.file)?.[location.line - 1] ?? null;
  };

  const headers = (text: string): string =>
    text.replace(HEADER_LINE, (line, indent: string, name: string) => (names(name) ? `${indent}${name}: ${REDACTED}` : line));
  const urlParams = (text: string): string =>
    text.replace(URL_PARAM, (param, separator: string, name: string) => (names(name) ? `${separator}${name}=${REDACTED}` : param));

  /** A: the target (subtitle from 1.63, title on 1.52), else the source line of the call, has a secret-looking name. */
  const isSecret = (step: StepLike, input: InputStep): boolean => {
    const subtitle = (step as { subtitle?: unknown }).subtitle;
    if (typeof subtitle === 'string' && names(subtitle)) return true;
    if (input.target !== null && names(input.target)) return true;
    const line = sourceLine(step.location);
    return line !== null && names(line);
  };

  return {
    rewritesStrings: namePatterns.length > 0 || options.values.length > 0,
    text: (text) => envValues(urlParams(headers(text))),
    values: envValues,
    strings: (text) => envValues(urlParams(text)),
    attempt(steps) {
      const titles = new Map<StepLike, string>();
      const typed = new Set<string>();
      const visit = (list: readonly StepLike[]): void => {
        for (const step of list) {
          const input = step.category === 'pw:api' ? parseInputStep(step.title) : null;
          if (input && isSecret(step, input)) {
            titles.set(step, input.redacted);
            typed.add(input.value);
            // Titles from 1.53 write newlines as `\n`; call logs keep the real ones.
            typed.add(input.value.replaceAll('\\n', '\n'));
          }
          visit(step.steps);
        }
      };
      visit(steps);

      // A short value (a PIN) would also match line numbers and other text: only its quoted form is redacted.
      const long = [...typed].filter((value) => value.length >= MIN_SECRET_LENGTH);
      const short = [...typed].filter((value) => value !== '' && value.length < MIN_SECRET_LENGTH).map((value) => `"${value}"`);
      const replaceLong = valueReplacer(long);
      const shortPattern = short.length > 0 ? new RegExp(short.map(escapeRegExp).join('|'), 'g') : null;
      const typedValues = (text: string): string => {
        const replaced = replaceLong(text);
        return shortPattern ? replaced.replace(shortPattern, `"${REDACTED}"`) : replaced;
      };

      return {
        title: (step) => envValues(urlParams(titles.get(step) ?? typedValues(step.title))),
        text: (text) => envValues(urlParams(headers(typedValues(text)))),
      };
    },
  };
}

/**
 * Values of the `redact.env` variables. A variable that is unset or empty, or
 * whose value is shorter than MIN_SECRET_LENGTH, is left out with a warning
 * that names the variable, never its value.
 */
export function secretValues(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  warn: (message: string) => void,
): string[] {
  const values: string[] = [];
  for (const name of names) {
    const value = env[name];
    if (value === undefined || value === '') {
      warn(`Loupe: redact.env: ${name} is not set or empty; nothing to redact for it.`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      warn(`Loupe: redact.env: the value of ${name} is shorter than ${MIN_SECRET_LENGTH} characters and is not redacted (too many false matches).`);
    } else {
      values.push(value);
    }
  }
  return values;
}

/**
 * Keys whose strings B never rewrites: identifiers and signatures (hex that a
 * short value could match), snippets (source code, already in the
 * repository) and attachment paths (the files keep their names).
 */
const KEPT_KEYS = new Set(['id', 'signature', 'errorSignature', 'snippet', 'path']);

/** Applies `replace` to every string of a JSON value, except under KEPT_KEYS. Returns a copy. */
export function mapReportStrings<T>(value: T, replace: (text: string) => string): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return replace(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, KEPT_KEYS.has(key) ? child : visit(child)]));
    }
    return node;
  };
  return visit(value) as T;
}
