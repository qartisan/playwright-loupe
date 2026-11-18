import { homedir } from 'node:os';

// The home directories of the leak canary (see test/leak.integration.test.ts). The
// canary name lives here only: in the spec, a line near a failure would put it in
// a snippet, which only masks the real home.

/** A user name found nowhere else, for the home directories of other machines. */
export const CANARY = 'loupecanary';

const name = CANARY;
const real = homedir();

export const HOMES: readonly string[] = [
  // POSIX.
  `/home/${name}/a.json`,
  `/Users/${name}/a.json`,
  `/var/home/${name}/a.json`,
  `/home/${name}`,
  `/Users/John ${name}/a.json`,
  `/home/${name} and /home/${name}/x`,
  // Windows.
  `C:\\Users\\${name}\\a.json`,
  `C:/Users/${name}/a.json`,
  `C:\\Users\\${name} Smith\\a.json`,
  `C:\\Users\\John ${name}\\a.json`,
  `"C:\\Users\\John ${name}"`,
  `C:\\Users\\${name} and C:\\Users\\${name}\\x`,
  // WSL, MSYS, Cygwin, a WSL home seen from Windows.
  `/mnt/c/Users/${name}/a.json`,
  `/mnt/D/users/${name}/a.json`,
  `/mnt/c/Users/John ${name}/a.json`,
  `/mnt/c/Users/${name} and /mnt/c/Users/${name}/x`,
  `/c/Users/${name}/a.json`,
  `/cygdrive/c/Users/${name}/a.json`,
  `\\\\wsl$\\Ubuntu\\home\\${name}\\a.json`,
  `\\\\wsl.localhost\\Ubuntu\\home\\${name}\\a.json`,
  // Converted by Playwright on Windows: its own `fileURLToPath` turns a `file://` frame
  // into backslashes, without a drive for a POSIX path and without the `\\` of a share.
  `\\home\\${name}\\a b.json`,
  `\\Users\\${name}\\a.json`,
  `\\Users\\John ${name}\\a.json`,
  `\\var\\home\\${name}\\a.json`,
  `\\mnt\\c\\Users\\${name}\\a.json`,
  `\\c\\Users\\${name}\\a.json`,
  `\\cygdrive\\c\\Users\\${name}\\a.json`,
  `wsl.localhost\\Ubuntu\\home\\${name}\\a.json`,
  `wsl$\\Ubuntu\\home\\${name}\\a.json`,
  JSON.stringify(`\\home\\${name}\\a.json`),
  // Lists.
  `PATH=/home/${name}/bin:/home/${name}/.local/bin`,
  `PATH=/mnt/c/Users/${name}/bin:/c/Users/${name}/bin`,
  `C:\\Users\\${name}\\a;C:\\Users\\${name}\\b`,
  `/home/${name},/home/${name}/x`,
  `/home/${name}=/home/${name}/x`,
  `/home/${name}/a=/home/${name}/b`,
  // Escaped, as JSON.stringify prints it.
  JSON.stringify(`C:\\Users\\${name}\\a.json`),
  JSON.stringify(`C:\\Users\\John ${name}\\a.json`),
  // `file://` URLs.
  `file:///home/${name}/a%20b.json`,
  `file:///C:/Users/${name}/a.json`,
  `file:///mnt/c/Users/${name}/a.json`,
  // The real home.
  real,
  `${real}/.cache/a.json`,
  `PATH=${real}/bin:${real}/.local/bin`,
  `-L${real}/lib`,
  `http://localhost:5173/@fs${real}/a.ts`,
  `file://${real}/a.json`,
  JSON.stringify(`${real}\\a.json`),
];

/** Secrets of `redact.env` written in tags (leak/secrets.spec.ts): invented, and listed by name in leak.config.ts. */
export const SECRETS = { LOUPE_LEAK_SECRET: 's3cretvalue', LOUPE_LEAK_OTHER: 'an0ther-s3cret', LOUPE_LEAK_COLON: 'c0lon:s3cret' } as const;

/** A project name holding a home of each kind. */
export const PROJECT = `on /home/${name}/project and ${real}/project`;

/** The characters of stdout or stderr kept per attempt: `OUTPUT_LIMIT` (src/core/output.ts), checked equal by the canary. */
export const OUTPUT_LIMIT_CHARS = 32 * 1024;

/**
 * Values written across the cut of a long output (leak/cut.spec.ts), with the words that must never show,
 * not even in part: a `redact.env` value, a home of another machine (its name holds a space) and the real
 * home, glued to the text before it as in `-L<home>/lib`.
 */
export const ACROSS_CUT = [
  { stream: 'stdout', value: SECRETS.LOUPE_LEAK_OTHER, word: SECRETS.LOUPE_LEAK_OTHER },
  { stream: 'stderr', value: `/Users/John ${name}/a.json`, word: name },
  { stream: 'stdout', value: `-L${real}/lib`, word: real.split(/[\\/]/).filter(Boolean).at(-1) ?? '' },
] as const;

/**
 * An output of more than OUTPUT_LIMIT_CHARS whose cut falls before the last character of `word`, inside
 * `value`. Spaces before it (a boundary for the home rules), a line end after it: a Windows profile name
 * runs to the end of its line.
 */
export function acrossCut(value: string, word: string): string {
  const at = value.indexOf(word) + word.length - 1;
  return `${' '.repeat(OUTPUT_LIMIT_CHARS - at)}${value}\n${' '.repeat(1000)}\n`;
}

/**
 * A value in the message of a failing test (leak/late.spec.ts), added to
 * `redact.env` only when LOUPE_FIXTURE_LATE_REDACT is set: in clear in a run
 * recorded before, it must be masked in the history of the next report.
 */
export const LATE = { name: 'LOUPE_FIXTURE_LATE_VALUE', value: 'l4te-added-v4lue' } as const;

/** Characters of an exclusion reason a cut keeps before its `…` (`MAX_REASON` - 1, src/core/history/record.ts). */
export const EXCLUDE_KEPT_CHARS = 199;

/**
 * A `LOUPE_EXCLUDE` reason with a `redact.env` value running across the cut of exclusion reasons: cut before
 * masking, all of the value but its last character would stay.
 */
export const EXCLUDE_ACROSS_CUT = `${'r'.repeat(EXCLUDE_KEPT_CHARS - (SECRETS.LOUPE_LEAK_OTHER.length - 1) - 1)} ${SECRETS.LOUPE_LEAK_OTHER} end`;
