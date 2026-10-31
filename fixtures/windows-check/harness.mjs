// Runs commands and judges what they select, for check.mjs. Nothing here can throw or reject
// because of a command: a launch failure (Windows refuses a command line above 32,767
// characters) is a result, and one row's failure never stops the others.
import { spawn } from 'node:child_process';

const SELECTION = 'LOUPE_SELECTION ';

/** Starts `[command, args, options]`. Resolves `{ selected }`, or `{ code, message, raw }` when it failed. */
export function runCommand(launch, env = {}, spawnFn = spawn) {
  const [command, args, options] = launch;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(command, args, { ...options, env: { ...process.env, ...env } });
    } catch (error) {
      // Refused before it started: on Windows, ENAMETOOLONG is thrown here.
      resolve({ code: error?.code ?? 'SPAWN_FAILED', message: String(error?.message ?? error) });
      return;
    }
    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    // Then `close` can follow: only the first settles the promise.
    child.on('error', (error) => resolve({ code: error?.code ?? 'SPAWN_FAILED', message: String(error?.message ?? error) }));
    child.on('close', () => {
      const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(SELECTION));
      if (!line) {
        resolve({ raw: output.slice(0, 400) });
        return;
      }
      try {
        resolve({ selected: JSON.parse(line.slice(SELECTION.length)).map((parts) => JSON.stringify(parts)) });
      } catch (error) {
        resolve({ code: 'BAD_OUTPUT', message: String(error), raw: output.slice(0, 400) });
      }
    });
  });
}

/** Whether a command selected exactly what is expected. A dependency project selected for a project asked is expected. */
export function selectedExpected(item, selected) {
  if (!selected) return false;
  const asked = new Set(item.expected.map((key) => JSON.parse(key)[0]));
  const kept = selected.filter((key) => asked.has(JSON.parse(key)[0]) || JSON.parse(key)[0] !== 'setup');
  return kept.length === item.expected.length && item.expected.every((key) => kept.includes(key));
}

/** The length of the command line the system is given, which can be far above the command's: see check.mjs. */
function launchLength([command, args]) {
  return [command, ...args].join(' ').length;
}

/**
 * Runs each command, `concurrency` at once. `toLaunch(text)` gives what to spawn; `worker()`
 * gives each worker its `env` and a `dispose`. Returns, per form, `{ required, ok, bad }`.
 */
export async function runRows({ commands, toLaunch, spawnFn = spawn, worker = () => ({ env: {}, dispose() {} }), concurrency = 4 }) {
  const stats = {};
  const queue = [...commands];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const { env, dispose } = worker();
      for (let item = queue.shift(); item; item = queue.shift()) {
        const launch = toLaunch(`${item.text} --list`);
        const stat = (stats[item.form] ??= { required: item.required, ok: 0, bad: [] });
        const { selected, code, message, raw } = await runCommand(launch, env, spawnFn);
        if (selectedExpected(item, selected)) stat.ok += 1;
        else {
          stat.bad.push({
            length: item.text.length,
            launchLength: launchLength(launch),
            command: item.text.slice(0, 300),
            expected: item.expected.length,
            selected: selected ? selected.length : 'error',
            ...(code ? { code, message } : {}),
            ...(raw ? { raw } : {}),
          });
        }
      }
      dispose();
    }),
  );
  return stats;
}

/** One bad row, for the log. A launch refused says at which length: the limit of the system, as data. */
export function describeBad(bad) {
  if (bad.code) {
    const refused = bad.code === 'ENAMETOOLONG' || bad.code === 'E2BIG';
    const what = refused ? `refused by the system at ${bad.launchLength} characters` : 'could not start';
    return `${what} (${bad.code}), for a command of ${bad.length}`;
  }
  return `length ${bad.length}, selected ${bad.selected} of ${bad.expected}${bad.raw ? `: ${bad.raw.slice(0, 200).replace(/\s+/g, ' ')}` : ''}`;
}

/** Bad results on REQUIRED rows, and how many REQUIRED commands ran. Measure rows never count. */
export function countRequired(stats) {
  let bad = 0;
  let run = 0;
  for (const stat of Object.values(stats)) {
    if (!stat.required) continue;
    bad += stat.bad.length;
    run += stat.ok + stat.bad.length;
  }
  return { bad, run };
}
