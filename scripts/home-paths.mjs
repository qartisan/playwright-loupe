// Home directory paths in the text of a report, for the scripts that check a
// report before it is published (run-demo.mjs, demo-screenshots.mjs). The
// reporter rewrites them (src/core/paths.ts): any one left is a leak.

import { homedir } from 'node:os';

/**
 * `/home/<user>/`, `/Users/<user>/`, `/var/home/<user>/`, `/root/`,
 * `/mnt/x/Users/`, `/cygdrive/x/Users/`, `/x/Users/`, `X:\Users\` and
 * `\\wsl$\<distro>\home\` (raw or JSON-escaped), not inside a URL
 * (`http://host/home/…`).
 */
const GENERIC_HOME =
  /(?<![\w.~%/-])(?:\/(?:home|Users|var\/home)\/[^/\s"'\\]+\/|\/root\/|\/(?:mnt|cygdrive)\/[A-Za-z]\/[Uu][Ss][Ee][Rr][Ss]\/|\/[A-Za-z]\/Users\/)|(?<!\w)[A-Za-z]:(?:\\+|\/)[Uu][Ss][Ee][Rr][Ss](?:\\+|\/)|\\{2,}[Ww][Ss][Ll](?:\$|\.[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt])\\+[^\\/\s"']+\\+home\\+/g;

/** Home directory paths found in `text`: this machine's home directory, then the generic forms. */
export function homePaths(text, home = homedir()) {
  const found = home && text.includes(home) ? [home] : [];
  return [...found, ...(text.match(GENERIC_HOME) ?? [])];
}
