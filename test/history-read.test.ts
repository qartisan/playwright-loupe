import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedHistory } from '../src/config/types.js';
import { MAX_RUN_FILE_BYTES, WINDOW_RUNS, createReplay, decodeRunFile, listRunFiles, parseRunFile, readHistory, selectWindow, windowOfStream } from '../src/core/history/read.js';
import { runIdentity } from '../src/core/history/record.js';
import { parseRunFileName, runFileName, streamHash } from '../src/core/history/runFile.js';
import { daysAgo, makeRunFile, putRunFile, readRunFile } from './helpers/history.js';

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const A = { environment: 'staging', origin: 'ci' };
const B = { environment: 'prod', origin: 'ci' };
const identity = (text: string) => text;

describe('stream hash and file names', () => {
  it('is 8 hex characters, the same whatever the order of the key', () => {
    expect(streamHash({ environment: 'a', origin: 'local' })).toMatch(/^[0-9a-f]{8}$/);
    expect(streamHash({ origin: 'local', environment: 'a' })).toBe(streamHash({ environment: 'a', origin: 'local' }));
  });

  it('changes with any value, and when a part is added or removed (new streams)', () => {
    const base = streamHash({ environment: 'a', origin: 'local' });
    expect(streamHash({ environment: 'b', origin: 'local' })).not.toBe(base);
    expect(streamHash({ environment: 'a' })).not.toBe(base);
    expect(streamHash({ environment: 'a', origin: 'local', branch: null })).not.toBe(base);
  });

  it('parses its own names, run ids with dashes included', () => {
    const name = runFileName('2026-11-10T14:02:11.408Z', '0a1b2c3d', '6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f');
    expect(name).toBe('20261110T140211.408Z-0a1b2c3d-6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f.json.gz');
    expect(parseRunFileName(name)).toEqual({ name, startedAt: Date.parse('2026-11-10T14:02:11.408Z'), stream: '0a1b2c3d', runId: '6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f' });
  });

  it.each([
    ['a temporary file', `.${runFileName('2026-11-10T14:02:11.408Z', '0a1b2c3d', 'r')}.123-abcd.tmp`],
    ['a name without stream hash', '20261110T140211.408Z-merge-1a2b3c4d.json.gz'],
    ['a foreign file', 'notes.json'],
    ['a foreign gzipped file', 'notes.json.gz'],
    ['an impossible date', '20261399T999999.000Z-0a1b2c3d-r.json.gz'],
    // Run files of the development builds before gzip, left in a folder.
    ['a plain JSON run file', '20261110T140211.408Z-0a1b2c3d-r.json'],
  ])('ignores %s', (_label, name) => {
    expect(parseRunFileName(name)).toBeNull();
  });
});

describe('parseRunFile', () => {
  const file = makeRunFile();

  it('reads a run file, unknown optional keys included', () => {
    expect(parseRunFile(JSON.stringify(file))).toEqual(file);
    expect(parseRunFile(JSON.stringify({ ...file, later: { key: 1 } }))).toMatchObject({ run: file.run });
  });

  it('keeps a file of another signature version: statuses still compare', () => {
    expect(parseRunFile(JSON.stringify({ ...file, signatureVersion: 5 }))).toMatchObject({ signatureVersion: 5 });
  });

  it('a later history version is "newer", never corrupt', () => {
    expect(parseRunFile(JSON.stringify({ historyVersion: 2, whatever: true }))).toBe('newer');
  });

  it.each([
    ['not JSON', '{"historyVersion": 1,'],
    ['an array', '[]'],
    ['no history version', JSON.stringify({ ...file, historyVersion: undefined })],
    ['no tests', JSON.stringify({ ...file, tests: undefined })],
    ['a test without id', JSON.stringify({ ...file, tests: [{ t: [], o: 'P', d: 1 }] })],
    ['a failure without signatures', JSON.stringify({ ...file, tests: [{ id: 'x', t: [], o: 'F', d: 1, f: [{ i: 0 }] }] })],
    ['a run without stream', JSON.stringify({ ...file, run: { ...file.run, stream: undefined } })],
    ['a run without projects', JSON.stringify({ ...file, run: { ...file.run, projects: undefined } })],
    ['a project without retries', JSON.stringify({ ...file, run: { ...file.run, projects: [{ name: 'p' }] } })],
    ['a run without git', JSON.stringify({ ...file, run: { ...file.run, git: undefined } })],
  ])('%s is corrupt', (_label, text) => {
    expect(parseRunFile(text)).toBe('corrupt');
  });
});

describe('decodeRunFile', () => {
  const file = makeRunFile();
  const text = JSON.stringify(file);

  it('gunzips, then parses', async () => {
    expect(await decodeRunFile(gzipSync(text))).toEqual(file);
    expect(await decodeRunFile(gzipSync(JSON.stringify({ historyVersion: 2 })))).toBe('newer');
  });

  it.each([
    ['plain JSON', Buffer.from(text)],
    ['a truncated gzip', gzipSync(text).subarray(0, 40)],
    ['an empty file', Buffer.alloc(0)],
  ])('%s is corrupt', async (_label, content) => {
    expect(await decodeRunFile(content)).toBe('corrupt');
  });

  it('a file that decompresses beyond the limit is corrupt, even when its JSON is valid', async () => {
    const padded = gzipSync(text + ' '.repeat(1000));
    expect(await decodeRunFile(padded, text.length + 1000)).toEqual(file);
    expect(await decodeRunFile(padded, text.length + 999)).toBe('corrupt');
  });

  it('the default limit is about 64 MB: a decompression bomb is corrupt', async () => {
    expect(MAX_RUN_FILE_BYTES).toBe(64 * 1024 * 1024);
    // 65 MB of a valid run file once decompressed, 64 kB on disk.
    const bomb = gzipSync(text + ' '.repeat(MAX_RUN_FILE_BYTES + 1024 * 1024 - text.length));
    expect(bomb.byteLength).toBeLessThan(100_000);
    expect(await decodeRunFile(bomb)).toBe('corrupt');
  });
});

describe('listing and the window', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'loupe-history-read-')), 'loupe-history');
  });
  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it('a missing folder is an empty history', async () => {
    expect(await listRunFiles(dir)).toEqual([]);
    expect(await readHistory(dir, streamHash(A), identity)).toEqual({ stream: streamHash(A), runs: [], others: [], skipped: 0, problems: [] });
  });

  it('lists run files newest first, without temporary, foreign or plain JSON files', async () => {
    const old = putRunFile(dir, makeRunFile({ id: 'old', startedAt: daysAgo(NOW, 2), stream: A }));
    const recent = putRunFile(dir, makeRunFile({ id: 'recent', startedAt: daysAgo(NOW, 1), stream: A }));
    writeFileSync(path.join(dir, 'runs', `.${recent}.1-ab.tmp`), '{');
    writeFileSync(path.join(dir, 'runs', 'notes.json'), '{}');
    // A plain JSON run file, newer than both, as development builds before gzip wrote them.
    writeFileSync(path.join(dir, 'runs', recent.replace(/^\d{8}/, '20991231').replace(/\.gz$/, '')), JSON.stringify(makeRunFile()));
    expect((await listRunFiles(dir)).map((file) => file.name)).toEqual([recent, old]);
  });

  it(`reads the ${WINDOW_RUNS} newest runs of the stream and the newest run of every other stream`, async () => {
    for (let day = 1; day <= WINDOW_RUNS + 5; day++) putRunFile(dir, makeRunFile({ id: `a${day}`, startedAt: daysAgo(NOW, day), stream: A }));
    putRunFile(dir, makeRunFile({ id: 'b-old', startedAt: daysAgo(NOW, 3), stream: B }));
    putRunFile(dir, makeRunFile({ id: 'b-new', startedAt: daysAgo(NOW, 2), stream: B }));
    const read = await readHistory(dir, streamHash(A), identity);
    expect(read.runs.map((run) => run.run.id)).toEqual(Array.from({ length: WINDOW_RUNS }, (_, index) => `a${index + 1}`));
    expect(read.others.map((run) => run.run.id)).toEqual(['b-new']);
    expect(read.problems).toEqual([]);
  });

  it('selects from names alone', () => {
    const names = [
      parseRunFileName(runFileName(daysAgo(NOW, 1), 'aaaaaaaa', 'x')),
      parseRunFileName(runFileName(daysAgo(NOW, 2), 'bbbbbbbb', 'y')),
      parseRunFileName(runFileName(daysAgo(NOW, 3), 'aaaaaaaa', 'z')),
    ].filter((file) => file !== null);
    const window = selectWindow(names, 'aaaaaaaa', 1);
    expect([window.own.map((file) => file.runId), window.others.map((file) => file.runId)]).toEqual([['x'], ['y']]);
  });

  it('skips corrupt files and files of a newer Loupe, names them in problems, and never touches them', async () => {
    const good = putRunFile(dir, makeRunFile({ id: 'good', startedAt: daysAgo(NOW, 1), stream: A }));
    const corrupt = putRunFile(dir, makeRunFile({ id: 'corrupt', startedAt: daysAgo(NOW, 2), stream: A }), '{"historyVersion":1');
    const newer = putRunFile(dir, makeRunFile({ id: 'newer', startedAt: daysAgo(NOW, 3), stream: A }), '{"historyVersion":2}');
    const plain = putRunFile(dir, makeRunFile({ id: 'plain', startedAt: daysAgo(NOW, 4), stream: A }), Buffer.from(JSON.stringify(makeRunFile({ id: 'plain', stream: A }))));
    const truncated = putRunFile(dir, makeRunFile({ id: 'truncated', startedAt: daysAgo(NOW, 5), stream: A }), gzipSync(JSON.stringify(makeRunFile())).subarray(0, 40));
    const read = await readHistory(dir, streamHash(A), identity);
    expect(read.runs.map((run) => run.run.id)).toEqual(['good']);
    expect(read.problems).toEqual([
      `skipped 3 corrupt run files: ${[corrupt, plain, truncated].sort().map((name) => `runs/${name}`).join(', ')}`,
      `skipped a run file written by a newer Loupe: runs/${newer}`,
    ]);
    expect(readdirSync(path.join(dir, 'runs')).sort()).toEqual([good, corrupt, newer, plain, truncated].sort());
    expect(readRunFile(path.join(dir, 'runs', newer))).toBe('{"historyVersion":2}');
    expect(readFileSync(path.join(dir, 'runs', plain), 'utf8')).toContain('"id":"plain"');
    // The window is four files shorter, and says so.
    expect(read.skipped).toBe(4);
  });

  it("counts as skipped only the files of the stream's window, not those of other streams", async () => {
    putRunFile(dir, makeRunFile({ id: 'good', startedAt: daysAgo(NOW, 1), stream: A }));
    putRunFile(dir, makeRunFile({ id: 'newer', startedAt: daysAgo(NOW, 2), stream: A }), '{"historyVersion":2}');
    putRunFile(dir, makeRunFile({ id: 'other', startedAt: daysAgo(NOW, 1), stream: B }), '{"historyVersion":2}');
    const read = await readHistory(dir, streamHash(A), identity);
    expect([read.runs.length, read.others.length, read.skipped, read.problems.length]).toEqual([1, 0, 1, 1]);
  });

  it('names three files at most', async () => {
    for (let day = 1; day <= 5; day++) putRunFile(dir, makeRunFile({ id: `c${day}`, startedAt: daysAgo(NOW, day), stream: A }), 'x');
    const [problem] = (await readHistory(dir, streamHash(A), identity)).problems;
    expect(problem).toMatch(/^skipped 5 corrupt run files: runs\/\S+, runs\/\S+, runs\/\S+ and 2 more$/);
  });

  it('an unreadable folder is an empty history with one problem, never a throw', async () => {
    mkdirSync(dir, { recursive: true });
    // A file where the runs folder should be: fails on every platform.
    writeFileSync(path.join(dir, 'runs'), '');
    const read = await readHistory(dir, streamHash(A), identity);
    expect([read.runs, read.others]).toEqual([[], []]);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toMatch(/^the history folder could not be read \(/);
  });
});

describe('redaction replayed on read', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'loupe-history-replay-')), 'loupe-history');
  });
  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  const SECRET = 'added-later-s3cr3t';
  const HOME = path.join(path.sep === '/' ? '/home' : 'C:\\Users', 'replay-canary');

  it('masks a redact.env value added after the run, and the home directory, in every extract and the exclusion reason', async () => {
    const text = `token ${SECRET} in ${path.join(HOME, 'project', 'a.spec.ts')}`;
    putRunFile(
      dir,
      makeRunFile(
        { id: 'r', stream: A, excluded: { reason: text }, errors: [{ sig: 'e', cat: null, x: text, at: null }] },
        [{ id: 't', t: ['p', 'a.spec.ts', 'fails'], o: 'F', d: 1, a: 'F', f: [{ i: 0, sig: ['s'], cat: null, x: text, at: null }] }],
      ),
    );
    const read = await readHistory(dir, streamHash(A), createReplay({ mode: 'extend', patterns: [], values: [SECRET] }, HOME));
    const out = JSON.stringify(read.runs);
    expect(out).toContain('token ');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('replay-canary');
    // The file itself is never rewritten.
    expect(readRunFile(path.join(dir, 'runs', readdirSync(path.join(dir, 'runs'))[0] as string))).toContain(SECRET);
  });
});

describe('the window when the stream changes during the run', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'loupe-history-reread-')), 'loupe-history');
  });
  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  const history: ResolvedHistory = {
    enabled: true,
    dir: '',
    stream: { key: ['environment', 'origin', 'branch'] },
    retention: { maxRuns: 200, maxAgeDays: 90 },
    include: 'full',
  };
  // Hermetic: no CI variable, so the origin is local wherever the test runs.
  const identity = (branch: string | null) => runIdentity({ history, env: {}, argv: ['node', 'playwright', 'test'], environmentName: 'staging', branch });

  it('reads the window of the end stream, not the one computed at the start', async () => {
    const start = identity(null);
    const end = identity('feature');
    expect(start.streamHash).not.toBe(end.streamHash);
    putRunFile(dir, makeRunFile({ id: 'start-stream', startedAt: daysAgo(NOW, 1), stream: start.stream }));
    putRunFile(dir, makeRunFile({ id: 'end-stream', startedAt: daysAgo(NOW, 2), stream: end.stream }));
    const read = (stream: string) => readHistory(dir, stream, (text) => text);
    const reads: string[] = [];
    const window = await windowOfStream(await read(start.streamHash), end.streamHash, (stream) => {
      reads.push(stream);
      return read(stream);
    });
    expect(reads).toEqual([end.streamHash]);
    expect([window.stream, window.runs.map((run) => run.run.id), window.others.map((run) => run.run.id)]).toEqual([end.streamHash, ['end-stream'], ['start-stream']]);
  });

  it('keeps the window read at the start when the stream did not change', async () => {
    const same = identity('main');
    putRunFile(dir, makeRunFile({ id: 'r', startedAt: daysAgo(NOW, 1), stream: same.stream }));
    const started = await readHistory(dir, same.streamHash, (text) => text);
    let reads = 0;
    const window = await windowOfStream(started, identity('main').streamHash, async (stream) => {
      reads++;
      return readHistory(dir, stream, (text) => text);
    });
    expect([reads, window]).toEqual([0, started]);
  });
});
