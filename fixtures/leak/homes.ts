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

/** A project name holding a home of each kind. */
export const PROJECT = `on /home/${name}/project and ${real}/project`;
