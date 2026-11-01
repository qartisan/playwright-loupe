import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { derivedRoots, locationFile } from '../src/core/build.js';
import { createPathRewriter, isStrictlyUnder, rewriteReportPaths, rootsFromStack } from '../src/core/paths.js';
import { createRedactor, DEFAULT_REDACT, mapReportStrings } from '../src/core/redact.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { REDACTED } from '../src/shared/redaction.js';

const posixRewriter = createPathRewriter({ roots: ['/home/alice/shop/tests'], home: '/home/alice' });
const winRewriter = createPathRewriter({ roots: ['C:\\Users\\Alice\\shop\\tests'], home: 'C:\\Users\\Alice' });
// File-path contexts (frame lines, locations): rules 1 to 3.
const posix = posixRewriter.file;
const win = winRewriter.file;

describe('createPathRewriter, POSIX', () => {
  it('makes a path under the root relative to it (rule 1)', () => {
    expect(posix('    at /home/alice/shop/tests/cart.spec.ts:12:5')).toBe('    at cart.spec.ts:12:5');
    expect(posix('    at signIn (/home/alice/shop/tests/web/a.spec.ts:3:1)')).toBe('    at signIn (web/a.spec.ts:3:1)');
  });

  it('writes the root itself as `.`', () => {
    expect(posix('cwd /home/alice/shop/tests')).toBe('cwd .');
    expect(posix("dir '/home/alice/shop/tests/'")).toBe("dir ''");
  });

  it('writes a path sharing a named ancestor as `../` (rule 2)', () => {
    expect(posix('    at signIn (/home/alice/shop/support/session.ts:24:44)')).toBe('    at signIn (../support/session.ts:24:44)');
    expect(posix('at /home/alice/other-repo/lib/x.ts:1:1')).toBe('at ../../other-repo/lib/x.ts:1:1');
    expect(posix('at /home/alice/shop/node_modules/pkg/index.mjs:1:32')).toBe('at ../node_modules/pkg/index.mjs:1:32');
    expect(posix('cwd /home/alice/shop')).toBe('cwd ..');
  });

  it('keeps a path whose only common ancestor is `/` or `/home`, masking a home (rule 3)', () => {
    expect(posix("open '/opt/shared/x.ts'")).toBe("open '/opt/shared/x.ts'");
    expect(posix('at /usr/lib/node_modules/x/y.js:1:1')).toBe('at /usr/lib/node_modules/x/y.js:1:1');
    expect(posix('at /home/bob/x.ts:1:1')).toBe('at ~/x.ts:1:1');
  });

  it('masks the home of another machine and the home of this one outside every root', () => {
    const rewrite = createPathRewriter({ roots: ['/builds/app/tests'], home: '/var/lib/jenkins' });
    expect(rewrite.file('at /var/lib/jenkins/.cache/x.js:1:1')).toBe('at ~/.cache/x.js:1:1');
    expect(rewrite.file('at /home/runner/work/x.ts:1:1')).toBe('at ~/work/x.ts:1:1');
    expect(rewrite.file('at /Users/john/x.ts:1:1')).toBe('at ~/x.ts:1:1');
    expect(rewrite.file('at /Users/John Doe/x.ts:1:1')).toBe('at ~/x.ts:1:1');
    expect(rewrite.file('at /root/x.ts:1:1')).toBe('at ~/x.ts:1:1');
    expect(rewrite.file('home is /home/bob')).toBe('home is ~');
    // `/builds` is a named ancestor of the root.
    expect(rewrite.file('at /builds/lib/x.ts:1:1')).toBe('at ../../lib/x.ts:1:1');
  });

  it('rewrites paths inside message text', () => {
    expect(posixRewriter.text("Error: ENOENT: no such file or directory, open '/home/alice/shop/tests/missing.txt'")).toBe(
      "Error: ENOENT: no such file or directory, open 'missing.txt'",
    );
    expect(posixRewriter.text("Cannot find module '/home/alice/shop/tests/x.js' imported from /home/alice/shop/tests/a.spec.ts")).toBe(
      "Cannot find module 'x.js' imported from a.spec.ts",
    );
  });

  it('rewrites every path of a multi-line stack', () => {
    const stack = [
      'Error: boom',
      '    at helper (/home/alice/shop/support/h.ts:3:34)',
      '    at /home/alice/shop/tests/a.spec.ts:8:82',
      '    at node:internal/process/task_queues:95:5',
      '    at <anonymous>',
    ].join('\n');
    expect(posixRewriter.stack(stack)).toBe(
      ['Error: boom', '    at helper (../support/h.ts:3:34)', '    at a.spec.ts:8:82', '    at node:internal/process/task_queues:95:5', '    at <anonymous>'].join(
        '\n',
      ),
    );
  });

  it('handles paths with spaces', () => {
    const rewrite = createPathRewriter({ roots: ['/Users/John Doe/my shop/tests'], home: '/Users/John Doe' });
    expect(rewrite.file('at f (/Users/John Doe/my shop/tests/a b.spec.ts:1:2)')).toBe('at f (a b.spec.ts:1:2)');
    expect(rewrite.file('at /Users/John Doe/other/x.ts:1:2')).toBe('at ../../other/x.ts:1:2');
  });

  it('requires a boundary after a prefix', () => {
    expect(posix('at /home/alice/shop/tests-old/a.ts:1:1')).toBe('at ../tests-old/a.ts:1:1');
    expect(posix('at /home/alice2/a.ts:1:1')).toBe('at ~/a.ts:1:1');
  });

  it('requires a boundary before a root or a generic home: the path of a URL is left alone', () => {
    const rewrite = createPathRewriter({ roots: ['/srv/shop/tests'], home: '/home/alice' });
    expect(rewrite.text('GET http://localhost/srv/shop/tests/x')).toBe('GET http://localhost/srv/shop/tests/x');
    expect(rewrite.file('x/srv/shop/tests/a.ts')).toBe('x/srv/shop/tests/a.ts');
    expect(rewrite.text('GET http://localhost/home/bob/x')).toBe('GET http://localhost/home/bob/x');
  });

  it('masks the real home after anything: it is the user name', () => {
    expect(posixRewriter.text('GET http://localhost/home/alice/shop/tests/x')).toBe('GET http://localhost~/shop/tests/x');
    expect(posix('x/home/alice/shop/tests/a.ts')).toBe('x~/shop/tests/a.ts');
    expect(posixRewriter.text('-L/home/alice/lib')).toBe('-L~/lib');
    expect(posixRewriter.text('http://localhost:5173/@fs/home/alice/x.ts')).toBe('http://localhost:5173/@fs~/x.ts');
    expect(posixRewriter.text('/mnt/backup/home/alice/x')).toBe('/mnt/backup~/x');
    expect(winRewriter.text('\\\\?\\C:\\Users\\Alice\\x')).toBe('\\\\?\\~\\x');
  });

  it('keeps the boundary after the real home, and both around a single-segment one', () => {
    const rewrite = createPathRewriter({ roots: [], home: '/srv/me' });
    expect(rewrite.text('reads /srv/me2/x')).toBe('reads /srv/me2/x');
    expect(rewrite.text('in a/srv/me2/x')).toBe('in a/srv/me2/x');
    const single = createPathRewriter({ roots: [], home: '/app' });
    expect(single.text('open /app/x')).toBe('open ~/x');
    expect(single.text('GET http://host/app/x')).toBe('GET http://host/app/x');
    expect(single.text('/opt/app/x')).toBe('/opt/app/x');
    expect(single.selection('in a/app/x')).toBe('in a/app/x');
    expect(createPathRewriter({ roots: [], home: '/root' }).text('/usr/root/x')).toBe('/usr/root/x');
  });

  it('rewrites `file://` URLs, raw and percent-encoded, without the scheme', () => {
    expect(posix('at file:///home/alice/shop/tests/a.spec.ts:1:1')).toBe('at a.spec.ts:1:1');
    const rewrite = createPathRewriter({ roots: ['/home/alice/my shop/tests'], home: '/home/alice' });
    expect(rewrite.file('at f (file:///home/alice/my%20shop/tests/a%20b.mjs:1:1)')).toBe('at f (a b.mjs:1:1)');
    expect(rewrite.file('at f (file:///home/alice/my%20shop/lib/x.mjs:1:1)')).toBe('at f (../lib/x.mjs:1:1)');
  });

  it('is case-sensitive', () => {
    // `/home/alice/Shop` is not `/home/alice/shop`: only `/home/alice` is shared.
    expect(posix('at /home/alice/Shop/tests/a.ts:1:1')).toBe('at ../../Shop/tests/a.ts:1:1');
  });

  it('accepts roots with a trailing separator or dot segments', () => {
    const rewrite = createPathRewriter({ roots: ['/home/alice/shop/e2e/../tests/'], home: null });
    expect(rewrite.file('at /home/alice/shop/tests/a.ts:1:1')).toBe('at a.ts:1:1');
  });

  it('prefers the longest root, then the longest ancestor; for the same ancestor, the first root', () => {
    const rewrite = createPathRewriter({ roots: ['/w/app', '/w/app/tests/e2e', '/w/other/tests'], home: null });
    expect(rewrite.file('at /w/app/tests/e2e/a.ts:1:1')).toBe('at a.ts:1:1');
    expect(rewrite.file('at /w/app/lib/a.ts:1:1')).toBe('at lib/a.ts:1:1');
    expect(rewrite.file('at /w/other/lib/a.ts:1:1')).toBe('at ../lib/a.ts:1:1');
    // `/w` is an ancestor of the three roots: one level up from `/w/app`, listed first.
    expect(rewrite.file('at /w/shared/a.ts:1:1')).toBe('at ../shared/a.ts:1:1');
  });

  it('ignores a root without a named segment and works without a home', () => {
    const rewrite = createPathRewriter({ roots: ['/', 'relative/dir'], home: null });
    expect(rewrite.file('at /opt/x.ts:1:1')).toBe('at /opt/x.ts:1:1');
    expect(rewrite.file('at /home/carol/x.ts:1:1')).toBe('at ~/x.ts:1:1');
  });

  it('leaves text without a separator, relative paths and non-file locations alone', () => {
    for (const text of ['Error: boom', 'tests/a.spec.ts:1:1', '../support/x.ts', 'node:internal/x', '<anonymous>', 'at native']) {
      expect(posix(text)).toBe(text);
    }
  });

  it('is idempotent', () => {
    const once = posix('at /home/alice/shop/support/x.ts:1:1 /home/bob/y /opt/z');
    expect(posix(once)).toBe(once);
  });
});

describe('createPathRewriter, file-path contexts', () => {
  const app = createPathRewriter({ roots: ['/app/tests'], home: null });

  it('applies rule 2 to file paths only: a URL path in a message stays as it is', () => {
    expect(app.text('Error: GET /app/items returned 500')).toBe('Error: GET /app/items returned 500');
    expect(app.file('/app/support/x.ts')).toBe('../support/x.ts');
    expect(app.stack('Error: boom\n    at helper (/app/support/x.ts:3:4)')).toBe('Error: boom\n    at helper (../support/x.ts:3:4)');
  });

  it('applies rules 1 and 3 to text: under the root relative, under a home masked, elsewhere absolute', () => {
    expect(posixRewriter.text("open '/home/alice/shop/tests/data.json'")).toBe("open 'data.json'");
    expect(posixRewriter.text("open '/home/alice/shop/support/x.json'")).toBe("open '~/shop/support/x.json'");
    expect(posixRewriter.text("open '/opt/data/x.json'")).toBe("open '/opt/data/x.json'");
  });

  it('masks a home that is also an ancestor of the root, in text', () => {
    const rewrite = createPathRewriter({ roots: ['/var/lib/jenkins/ws/tests'], home: '/var/lib/jenkins' });
    expect(rewrite.text("open '/var/lib/jenkins/.cache/x'")).toBe("open '~/.cache/x'");
    expect(rewrite.file('/var/lib/jenkins/.cache/x')).toBe('../../.cache/x');
  });

  it('rewrites the head of a stack like text and its frames like file paths', () => {
    const stack = [
      'Error: GET /app/items failed',
      '',
      'Call log:',
      '  - → GET /app/items',
      '    at fetchItems (/app/support/api.ts:12:3)',
      '    at /app/tests/items.spec.ts:5:1',
    ].join('\n');
    expect(app.stack(stack)).toBe(
      [
        'Error: GET /app/items failed',
        '',
        'Call log:',
        '  - → GET /app/items',
        '    at fetchItems (../support/api.ts:12:3)',
        '    at items.spec.ts:5:1',
      ].join('\n'),
    );
  });

  it('rewrites the head of a stack exactly like the message, so a frameless stack still equals it', () => {
    for (const message of [
      "Error: ENOENT: no such file or directory, open '/home/alice/shop/support/x.json'",
      "Error: Cannot find module '/home/alice/shop/tests/x.js' imported from /home/alice/shop/tests/a.spec.ts",
      'Error: No tests found',
    ]) {
      expect(posixRewriter.stack(message)).toBe(posixRewriter.text(message));
      const stack = `${message}\n    at /home/alice/shop/tests/a.spec.ts:1:1`;
      expect(posixRewriter.stack(stack).startsWith(`${posixRewriter.text(message)}\n`)).toBe(true);
    }
  });

  it('rewrites a non-frame line after the frames like text', () => {
    expect(app.stack('Error: x\n    at /app/tests/a.ts:1:1\nGET /app/items')).toBe('Error: x\n    at a.ts:1:1\nGET /app/items');
  });

  it('still applies rule 1 to text: a one-segment root rewrites a URL path (documented limit)', () => {
    const root = createPathRewriter({ roots: ['/app'], home: null });
    expect(root.text('GET /app/items')).toBe('GET items');
  });
});

describe('createPathRewriter, Windows', () => {
  it('makes a path under the root relative, with POSIX separators (rule 1)', () => {
    expect(win('    at C:\\Users\\Alice\\shop\\tests\\web\\a.spec.ts:12:5')).toBe('    at web/a.spec.ts:12:5');
    expect(win('cwd C:\\Users\\Alice\\shop\\tests')).toBe('cwd .');
  });

  it('compares the whole prefix case-insensitively, `\\` and `/` alike', () => {
    expect(win('at c:\\users\\alice\\SHOP\\tests\\a.ts:1:1')).toBe('at a.ts:1:1');
    expect(win('at C:/Users/Alice/shop/tests/web\\a.ts:1:1')).toBe('at web/a.ts:1:1');
  });

  it('writes a path sharing a named ancestor as `../` (rule 2)', () => {
    expect(win('at f (C:\\Users\\alice\\shop\\support\\s.ts:2:3)')).toBe('at f (../support/s.ts:2:3)');
  });

  it('keeps another drive, a system location and a UNC path, masking homes (rule 3)', () => {
    expect(win("open 'D:\\shared\\x.ts'")).toBe("open 'D:\\shared\\x.ts'");
    expect(win('at C:\\Windows\\x.dll')).toBe('at C:\\Windows\\x.dll');
    expect(win('at \\\\server\\share\\x.ts:1:1')).toBe('at \\\\server\\share\\x.ts:1:1');
    expect(win('at D:\\Users\\bob\\x.ts:1:1')).toBe('at ~/x.ts:1:1');
    expect(win('at C:\\Users\\John Doe\\x.ts:1:1')).toBe('at ~/x.ts:1:1');
  });

  it('handles UNC roots', () => {
    const rewrite = createPathRewriter({ roots: ['\\\\server\\share\\shop\\tests'], home: null });
    expect(rewrite.file('at \\\\server\\share\\shop\\tests\\a.ts:1:1')).toBe('at a.ts:1:1');
    expect(rewrite.file('at \\\\SERVER\\share\\shop\\lib\\a.ts:1:1')).toBe('at ../lib/a.ts:1:1');
    // The share is the filesystem root: no named ancestor in common.
    expect(rewrite.file('at \\\\server\\share\\other.ts:1:1')).toBe('at \\\\server\\share\\other.ts:1:1');
  });

  it('rewrites `file:///C:/` URLs', () => {
    expect(win('at file:///C:/Users/Alice/shop/tests/a.spec.ts:1:1')).toBe('at a.spec.ts:1:1');
    const rewrite = createPathRewriter({ roots: ['C:\\Users\\John Doe\\shop\\tests'], home: null });
    expect(rewrite.file('at file:///C:/Users/John%20Doe/shop/tests/a.mjs:1:1')).toBe('at a.mjs:1:1');
  });

  it('does not touch POSIX paths with Windows roots, and the other way round', () => {
    expect(win('at /opt/x.ts:1:1')).toBe('at /opt/x.ts:1:1');
    expect(posix('at C:\\Program Files\\x.ts:1:1')).toBe('at C:\\Program Files\\x.ts:1:1');
  });
});

describe('createPathRewriter, fields that select a test', () => {
  const selection = (home: string | null, text: string, roots: readonly string[] = ['/srv/app/tests']): string => createPathRewriter({ roots, home }).selection(text);

  it('keeps a path under the root, outside home', () => {
    expect(selection('/home/alice', 'reads /srv/app/tests/data/a.json')).toBe('reads /srv/app/tests/data/a.json');
    expect(selection('/home/alice', 'cwd /srv/app/tests')).toBe('cwd /srv/app/tests');
  });

  it('keeps a path outside the root and home', () => {
    expect(selection('/home/alice', 'reads /opt/data/x.json')).toBe('reads /opt/data/x.json');
    expect(selection('C:\\Users\\alice', 'reads D:\\data\\x.json')).toBe('reads D:\\data\\x.json');
  });

  it('replaces a home directory, a root under it included', () => {
    expect(selection('/home/alice', 'reads /home/alice/x.json')).toBe('reads ~/x.json');
    expect(selection('/home/alice', 'cwd /home/alice')).toBe('cwd ~');
    expect(selection('/home/alice', 'reads /home/alice/shop/tests/a.json', ['/home/alice/shop/tests'])).toBe('reads ~/shop/tests/a.json');
  });

  it('replaces every occurrence', () => {
    expect(selection('/home/alice', 'list /home/alice/a:/home/alice/b /home/alice')).toBe('list ~/a:~/b ~');
    expect(selection('C:\\Users\\alice', 'C:\\Users\\alice\\a;C:\\Users\\alice\\b')).toBe('~\\a;~\\b');
  });

  it('keeps the rest as written: separators and percent-encoding', () => {
    expect(selection('C:\\Users\\me', 'reads C:\\Users\\me\\app\\b.json')).toBe('reads ~\\app\\b.json');
    expect(selection('C:\\Users\\me', 'reads C:/Users/me/app/b.json')).toBe('reads ~/app/b.json');
    expect(selection('/home/me', 'reads /home/me/a%20b.json')).toBe('reads ~/a%20b.json');
  });

  it('handles a `file://` URL as the other fields do, the rest as written', () => {
    expect(selection(null, 'reads file:///home/x/a%20b.json')).toBe('reads ~/a%20b.json');
    expect(selection('/srv/my home', 'reads file:///srv/my%20home/a%20b.json')).toBe('reads ~/a%20b.json');
    expect(selection('C:\\Users\\me', 'reads file:///C:/Users/me/a%20b.json')).toBe('reads ~/a%20b.json');
  });

  it('only matches a prefix followed by a separator, a delimiter or the end', () => {
    expect(selection('/srv/me', 'reads /srv/me2/x')).toBe('reads /srv/me2/x');
    expect(selection('/srv/me', 'reads /srv/me.old/x')).toBe('reads /srv/me.old/x');
    for (const after of ['/x', '\\x', ' x', "'", '"', ':1', ';x', ',x', '=x', ')', '']) {
      expect(selection('/srv/me', `(/srv/me${after}`)).toBe(`(~${after}`);
    }
  });

  it('does not take the home directory of another user for this one', () => {
    // Masked anyway, by the generic form: never left half rewritten as `~2/x`.
    expect(selection('/home/me', 'reads /home/me2/x')).toBe('reads ~/x');
    expect(selection('D:\\Home\\me', 'reads D:\\Home\\me2\\x')).toBe('reads D:\\Home\\me2\\x');
  });

  it('masks the real home after anything, a generic home only at a path boundary', () => {
    expect(selection('/srv/me', 'see http://host/srv/me/x')).toBe('see http://host~/x');
    expect(selection('/srv/me', 'in a/srv/me/x')).toBe('in a~/x');
    expect(selection('/srv/me', 'see http://host/home/bob/x')).toBe('see http://host/home/bob/x');
    expect(selection('/srv/me', 'in a/home/bob/x')).toBe('in a/home/bob/x');
  });

  it('keeps an escaped separator as written', () => {
    expect(selection('C:\\Users\\me', '"C:\\\\Users\\\\me\\\\a.json"')).toBe('"~\\\\a.json"');
    expect(selection(null, '"D:\\\\Users\\\\bob\\\\a.json"')).toBe('"~\\\\a.json"');
  });

  it('matches a Windows home with both separators, ignoring case', () => {
    for (const written of ['D:\\Home\\me', 'D:/Home/me', 'd:\\home\\ME', 'd:/HOME/Me', 'D:\\Home/me']) {
      expect(selection('D:\\Home\\me', `reads ${written}\\x.json`)).toBe('reads ~\\x.json');
      expect(selection('D:\\Home\\me', `reads ${written}/x.json`)).toBe('reads ~/x.json');
    }
  });

  it('applies the generic home forms, prefix only', () => {
    expect(selection(null, 'reads /home/runner/work/a.json')).toBe('reads ~/work/a.json');
    expect(selection(null, 'reads /Users/bob/a.json')).toBe('reads ~/a.json');
    expect(selection(null, 'reads /root/a.json')).toBe('reads ~/a.json');
    expect(selection(null, 'reads C:\\Users\\bob\\work\\a.json')).toBe('reads ~\\work\\a.json');
    expect(selection(null, 'reads c:/users/bob/work/a.json')).toBe('reads ~/work/a.json');
  });

  it('takes a URL path for a home directory, as the other fields do', () => {
    expect(selection('/home/alice', 'GET /home/dashboard returns 200')).toBe('GET ~ returns 200');
  });

  it('keeps relative paths and text without a path', () => {
    expect(selection('/home/alice', 'reads data/a.json')).toBe('reads data/a.json');
    expect(selection('/home/alice', 'about ~ 5 items')).toBe('about ~ 5 items');
    expect(selection('/home/alice', '')).toBe('');
  });
});

describe('rewriteReportPaths', () => {
  const UNDER_ROOT = '/srv/app/tests/data/a.json';
  const IN_HOME = '/home/alice/x.json';
  const both = `${UNDER_ROOT} ${IN_HOME}`;
  const kept = `${UNDER_ROOT} ~/x.json`;
  const rewritten = 'data/a.json ~/x.json';
  const paths = createPathRewriter({ roots: ['/srv/app/tests'], home: '/home/alice' });

  const error = { message: both, stack: null, location: null, snippet: both, signature: both, category: both };
  const step = { title: both, subtitle: both, category: 'test.step', durationMs: 1, error, location: null, steps: [] };
  const attachment = { name: both, contentType: 'text/plain', kind: 'text', path: 'data/x/0/a.txt', body: both, comparison: null };
  const report = {
    schemaVersion: 1,
    generator: { name: 'playwright-loupe', version: '0' },
    run: { id: 'run', errors: [{ ...error, project: both }, { ...error, project: null }] },
    projects: [{ name: both, testDir: 'tests', retries: 0, timeoutMs: 1, stats: {} }],
    tests: [
      {
        id: both,
        project: both,
        file: 'a.spec.ts',
        suitePath: [both, 'plain'],
        title: both,
        tags: [`@${both}`],
        annotations: [{ type: 'note', description: both }],
        dimensions: { layer: [both] },
        category: both,
        errorSignature: both,
        attempts: [{ errors: [error], steps: [step], attachments: [attachment], annotations: [{ type: 'note', description: both }], stdout: { text: both, truncated: false } }],
      },
    ],
    categories: [{ name: both, color: 'x', builtIn: false }],
    dimensions: [{ name: both, source: 'tag', key: both, values: [both] }],
  } as unknown as LoupeReport;
  const result = rewriteReportPaths(report, paths);
  const test = result.tests[0] as unknown as (typeof report.tests)[number];

  it('only replaces the home directory in the five fields that select a test', () => {
    expect(test.title).toBe(kept);
    expect(test.suitePath).toEqual([kept, 'plain']);
    expect(test.project).toBe(kept);
    expect(result.projects[0]?.name).toBe(kept);
    expect(result.run.errors[0]?.project).toBe(kept);
    expect(result.run.errors[1]?.project).toBeNull();
  });

  it('still rewrites every field that has the same key elsewhere', () => {
    const attempt = test.attempts[0];
    expect(attempt?.steps[0]?.title).toBe(rewritten);
    expect(attempt?.steps[0]?.subtitle).toBe(rewritten);
    expect(attempt?.attachments[0]?.name).toBe(rewritten);
    expect(attempt?.attachments[0]?.body).toBe(rewritten);
  });

  it('still rewrites messages, tags, annotations, outputs and dimensions', () => {
    const attempt = test.attempts[0];
    expect(attempt?.errors[0]?.message).toBe(rewritten);
    expect(attempt?.stdout.text).toBe(rewritten);
    expect(result.run.errors[0]?.message).toBe(rewritten);
    expect(test.tags).toEqual([`@${rewritten}`]);
    expect(test.annotations[0]?.description).toBe(rewritten);
    expect(test.dimensions['layer']).toEqual([rewritten]);
    expect(result.dimensions[0]).toEqual({ name: rewritten, source: 'tag', key: rewritten, values: [rewritten] });
  });

  it('keeps ids, signatures, category names, snippets and attachment paths', () => {
    expect(test.id).toBe(both);
    expect(test.errorSignature).toBe(both);
    expect(test.category).toBe(both);
    expect(result.categories[0]?.name).toBe(both);
    expect(test.attempts[0]?.errors[0]?.signature).toBe(both);
    expect(test.attempts[0]?.errors[0]?.snippet).toBe(both);
    expect(test.attempts[0]?.attachments[0]?.path).toBe('data/x/0/a.txt');
  });

  it('keeps the order of the keys of the JSON, and leaves the report as it was', () => {
    expect(Object.keys(result)).toEqual(Object.keys(report));
    expect(Object.keys(test)).toEqual(Object.keys(report.tests[0] as object));
    expect(Object.keys(result.run.errors[0] as object)).toEqual(Object.keys(report.run.errors[0] as object));
    expect(report.tests[0]?.title).toBe(both);
  });

  it('keeps a redacted value masked in a title', () => {
    const secret = 'inv3nted-Secret';
    const strings = createRedactor({ ...DEFAULT_REDACT, values: [secret] }).strings;
    const withSecret = { ...report, tests: [{ ...report.tests[0], title: `reads ${secret} at /home/alice/${secret}/a.json` }] } as LoupeReport;
    const masked = rewriteReportPaths(mapReportStrings(withSecret, strings), paths);
    expect(masked.tests[0]?.title).toBe(`reads ${REDACTED} at ~/${REDACTED}/a.json`);
  });
});

describe('rootsFromStack', () => {
  const stack = [
    'Error: boom',
    '    at helper (/home/runner/work/shop/support/h.ts:3:34)',
    '    at /home/runner/work/shop/tests/web/a.spec.ts:8:82',
    '    at async Context.<anonymous> (/home/runner/work/shop/tests/web/a.spec.ts:9:1)',
    '    at node:internal/process/task_queues:95:5',
  ].join('\n');

  it("gives the root shown by the frames of the test's own file", () => {
    expect(rootsFromStack(stack, 'web/a.spec.ts')).toEqual(['/home/runner/work/shop/tests']);
  });

  it('requires a separator right before the test file', () => {
    expect(rootsFromStack('    at /w/tests/xa.spec.ts:1:1', 'a.spec.ts')).toEqual([]);
    expect(rootsFromStack('    at /w/tests/a.spec.ts:1:1', 'a.spec.ts')).toEqual(['/w/tests']);
  });

  it('is empty when no frame is in the test file, or the test file is outside the root', () => {
    expect(rootsFromStack(stack, 'web/b.spec.ts')).toEqual([]);
    expect(rootsFromStack('    at /w/other/a.spec.ts:1:1', '../other/a.spec.ts')).toEqual([]);
    expect(rootsFromStack('Error: boom', 'a.spec.ts')).toEqual([]);
  });

  it('ignores a frame at the filesystem root', () => {
    expect(rootsFromStack('    at /a.spec.ts:1:1', 'a.spec.ts')).toEqual([]);
    expect(rootsFromStack('    at C:\\a.spec.ts:1:1', 'a.spec.ts')).toEqual([]);
  });

  it('reads Windows paths case-insensitively and `file://` URLs', () => {
    expect(rootsFromStack('    at f (C:\\Work\\Shop\\Tests\\Web\\A.spec.ts:1:1)', 'web/a.spec.ts')).toEqual(['C:\\Work\\Shop\\Tests']);
    expect(rootsFromStack('    at f (file:///C:/w/my%20shop/tests/a.mjs:1:1)', 'a.mjs')).toEqual(['C:/w/my shop/tests']);
    expect(rootsFromStack('    at file:///w/tests/a.mjs:1:1', 'a.mjs')).toEqual(['/w/tests']);
  });

  it('gives roots that the rewriter makes relative', () => {
    const rewrite = createPathRewriter({ roots: ['/merge/tests', ...rootsFromStack(stack, 'web/a.spec.ts')], home: '/home/gil' });
    expect(rewrite.stack(stack)).toBe(
      [
        'Error: boom',
        '    at helper (../support/h.ts:3:34)',
        '    at web/a.spec.ts:8:82',
        '    at async Context.<anonymous> (web/a.spec.ts:9:1)',
        '    at node:internal/process/task_queues:95:5',
      ].join('\n'),
    );
  });
});

describe('isStrictlyUnder', () => {
  it('is true for a directory strictly inside another, false for the same one', () => {
    expect(isStrictlyUnder('/r/tests/lib', '/r/tests')).toBe(true);
    expect(isStrictlyUnder('/r/tests/', '/r/tests')).toBe(false);
    expect(isStrictlyUnder('/r/tests-old', '/r/tests')).toBe(false);
    expect(isStrictlyUnder('/r', '/r/tests')).toBe(false);
  });

  it('compares Windows paths case-insensitively, and never mixes POSIX and Windows', () => {
    expect(isStrictlyUnder('c:\\R\\Tests\\lib', 'C:\\r\\tests')).toBe(true);
    expect(isStrictlyUnder('D:\\r\\tests\\lib', 'C:\\r\\tests')).toBe(false);
    expect(isStrictlyUnder('/r/tests/lib', 'C:\\r\\tests')).toBe(false);
  });
});

describe('derivedRoots', () => {
  const at = (file: string) => `Error: x\n    at ${file}:1:1`;

  it('gives the roots the stacks show, by votes, then shortest', () => {
    const sources = [
      { file: 'a.spec.ts', stacks: [at('/ci/tests/a.spec.ts'), at('/ci/tests/a.spec.ts')] },
      { file: 'b.spec.ts', stacks: [at('/other/tests/b.spec.ts')] },
    ];
    expect(derivedRoots(sources, '/merge/tests')).toEqual(['/ci/tests', '/other/tests']);
  });

  it('keeps a root shown by a single stack', () => {
    expect(derivedRoots([{ file: 'a.spec.ts', stacks: [at('/ci/tests/a.spec.ts')] }], '/merge/tests')).toEqual(['/ci/tests']);
  });

  it('gives the root dir itself in a direct run', () => {
    expect(derivedRoots([{ file: 'web/a.spec.ts', stacks: [at('/r/tests/web/a.spec.ts')] }], '/r/tests')).toEqual(['/r/tests']);
  });

  it('discards a root strictly inside the root dir or inside another derived root', () => {
    // `lib/a.spec.ts` is not the test file `a.spec.ts`, but is named like it.
    const sources = [
      { file: 'a.spec.ts', stacks: [`Error: x\n    at helper (/r/tests/lib/a.spec.ts:1:1)\n    at /r/tests/a.spec.ts:2:2`] },
      { file: 'b.spec.ts', stacks: [at('/ci/tests/b.spec.ts'), at('/ci/tests/sub/b.spec.ts')] },
    ];
    expect(derivedRoots(sources, '/r/tests')).toEqual(['/r/tests', '/ci/tests']);
  });
});

describe('the final sweep', () => {
  const real = createPathRewriter({ roots: ['/srv/app/tests'], home: '/home/me' });
  const windows = createPathRewriter({ roots: ['D:\\app\\tests'], home: 'C:\\Users\\Me' });

  it('masks every home of a `PATH` list', () => {
    expect(real.text('PATH=/home/me/bin:/home/me/.local/bin')).toBe('PATH=~/bin:~/.local/bin');
    expect(real.text('PATH=/home/bob/bin:/home/bob/.local/bin')).toBe('PATH=~/bin:~/.local/bin');
    expect(real.text('PATH=/home/me/bin:/usr/bin:/home/bob/bin')).toBe('PATH=~/bin:/usr/bin:~/bin');
  });

  it('masks every home of a Windows list', () => {
    expect(windows.text('C:\\Users\\Me\\a;C:\\Users\\Me\\b')).toBe('~/a;~/b');
    expect(windows.text('C:\\Users\\bob\\a;C:\\Users\\bob\\b')).toBe('~/a;~/b');
    expect(windows.selection('C:\\Users\\bob\\a;C:\\Users\\bob\\b')).toBe('~\\a;~\\b');
  });

  it('masks a home after `:` and after `=` in a message', () => {
    expect(real.text('copy from /tmp/a:/home/me/x')).toBe('copy from /tmp/a:~/x');
    expect(real.text('Error: /home/me/a:/home/bob/b')).toBe('Error: ~/a:~/b');
    expect(real.text('--out=/home/me/x')).toBe('--out=~/x');
    expect(real.text('/home/me/a=/home/me/b')).toBe('~/a=~/b');
    expect(real.text('/home/bob/a=/home/bob/b')).toBe('~/a=~/b');
  });

  it('masks a home inside a stack line', () => {
    expect(real.stack('Error: x\n    at f (/opt/a:/home/me/b.ts:1:1)\n    at /home/bob/a:/home/bob/c.ts:2:2')).toBe(
      'Error: x\n    at f (/opt/a:~/b.ts:1:1)\n    at ~/a:~/c.ts:2:2',
    );
    expect(real.file('at /srv/app/tests/a:/home/me/b.ts:1:1')).toBe('at a:~/b.ts:1:1');
  });

  it('keeps a path under the root relative, inside the real home', () => {
    const rewrite = createPathRewriter({ roots: ['/home/me/proj/tests'], home: '/home/me' });
    expect(rewrite.text('/home/me/proj/tests/a.ts:3:4')).toBe('a.ts:3:4');
    expect(rewrite.file('at /home/me/proj/lib/a.ts:3:4')).toBe('at ../lib/a.ts:3:4');
  });

  it('applies to an error location', () => {
    expect(locationFile('/home/me/a:/home/me/b.ts', '/srv/app/tests', real, path.posix)).toBe('~/a:~/b.ts');
  });

  it('masks a real home holding a space, every occurrence', () => {
    const rewrite = createPathRewriter({ roots: [], home: 'C:\\Users\\Real Name' });
    expect(rewrite.text('C:\\Users\\Real Name\\a and C:\\Users\\Real Name and "C:/users/real name/b"')).toBe('~/a and ~ and "~/b"');
    const posix = createPathRewriter({ roots: [], home: '/srv/real name' });
    expect(posix.text('/srv/real name/a:/srv/real name/b, x/srv/real name')).toBe('~/a:~/b, x~');
  });

  it('leaves the known false positive and a path outside every home as they are', () => {
    expect(real.text('GET /home/dashboard returns 200')).toBe('GET ~ returns 200');
    expect(real.text('open /opt/data/x.json:/usr/bin')).toBe('open /opt/data/x.json:/usr/bin');
  });
});

describe('lists of generic homes', () => {
  const rewrite = createPathRewriter({ roots: [], home: null });

  it('stops a user name before a list separator', () => {
    expect(rewrite.text('/home/bob,/home/bob/x')).toBe('~,~/x');
    expect(rewrite.text('/home/bob;/home/bob/x')).toBe('~;~/x');
    expect(rewrite.text('/home/bob=/home/bob/x')).toBe('~=~/x');
    expect(rewrite.selection('/home/bob,/home/bob/x')).toBe('~,~/x');
  });

  it('keeps a user name holding such a character, the name still masked', () => {
    expect(rewrite.text('/home/a,b/x')).toBe('~/x');
    expect(rewrite.text('/home/a=b')).toBe('~');
  });

  it('accepts `=` as a delimiter after a root', () => {
    const rooted = createPathRewriter({ roots: ['/srv/app'], home: null });
    expect(rooted.text('/srv/app=x')).toBe('.=x');
  });
});

describe('generic home forms', () => {
  const rewrite = createPathRewriter({ roots: ['/opt/app'], home: '/home/other' });
  const { text, selection } = rewrite;

  it('masks WSL paths, any case on the drive and on `Users`', () => {
    expect(text('/mnt/c/Users/me/app/a.json')).toBe('~/app/a.json');
    expect(text('/mnt/D/users/me/a.json')).toBe('~/a.json');
    expect(text('/mnt/c/USERS/me')).toBe('~');
    expect(text('file:///mnt/c/Users/me/a%20b.json')).toBe('~/a b.json');
  });

  it('leaves other mounted paths alone', () => {
    expect(text('/mnt/c/Windows/x')).toBe('/mnt/c/Windows/x');
    expect(text('/mnt/data/Users/me/x')).toBe('/mnt/data/Users/me/x');
    expect(text('/mnt/wsl/x')).toBe('/mnt/wsl/x');
  });

  it('masks Cygwin paths', () => {
    expect(text('/cygdrive/c/Users/me/a.json')).toBe('~/a.json');
    expect(text('/cygdrive/D/users/John Smith/a.json')).toBe('~/a.json');
  });

  it('masks MSYS paths, with a capital `Users` only', () => {
    expect(text('/c/Users/me/a.json')).toBe('~/a.json');
    expect(text('PATH=/c/Users/me/bin:/c/Users/me/.local/bin')).toBe('PATH=~/bin:~/.local/bin');
    expect(text('GET /a/users/42')).toBe('GET /a/users/42');
  });

  it('masks a WSL home seen from Windows', () => {
    expect(text('\\\\wsl$\\Ubuntu\\home\\bob\\a\\b.json')).toBe('~/a/b.json');
    expect(text('\\\\wsl.localhost\\Ubuntu-22.04\\home\\bob\\a.json')).toBe('~/a.json');
    expect(text('\\\\WSL$\\Ubuntu\\home\\bob')).toBe('~');
    expect(text('//wsl.localhost/Ubuntu/home/bob/a.json')).toBe('~/a.json');
    expect(text('"\\\\\\\\wsl$\\\\Ubuntu\\\\home\\\\bob\\\\a.json"')).toBe('"~/a.json"');
    expect(text('\\\\wsl$\\Ubuntu\\opt\\a.json')).toBe('\\\\wsl$\\Ubuntu\\opt\\a.json');
  });

  it('masks a home of an atomic desktop', () => {
    expect(text('/var/home/bob/a.json')).toBe('~/a.json');
    expect(text('/var/home/bob')).toBe('~');
    expect(text('/var/lib/bob/a.json')).toBe('/var/lib/bob/a.json');
  });

  it('keeps the rest verbatim in the fields that select a test', () => {
    expect(selection('reads /mnt/c/Users/me/app\\a%20b.json')).toBe('reads ~/app\\a%20b.json');
    expect(selection('/c/Users/me/a')).toBe('~/a');
    expect(selection('/cygdrive/c/Users/me/a')).toBe('~/a');
    expect(selection('\\\\wsl$\\Ubuntu\\home\\bob\\a\\b')).toBe('~\\a\\b');
    expect(selection('/var/home/bob/a')).toBe('~/a');
  });

  it('applies to the home of the machine under WSL, the root staying relative', () => {
    const wsl = createPathRewriter({ roots: ['/mnt/c/Users/me/proj/tests'], home: '/home/me' });
    expect(wsl.text('/mnt/c/Users/me/proj/tests/a.ts:1:1')).toBe('a.ts:1:1');
    expect(wsl.text('/mnt/c/Users/me/other/a.ts')).toBe('~/other/a.ts');
    expect(wsl.selection('/mnt/c/Users/me/proj/tests/a.ts')).toBe('~/proj/tests/a.ts');
  });
});

describe('user names', () => {
  const { text, selection } = createPathRewriter({ roots: [], home: null });

  it('never leaves the name of a spaced POSIX span in clear', () => {
    expect(text('/home/bob and /home/bob/x')).toBe('~ and ~/x');
    expect(selection('/home/bob and /home/bob/x')).toBe('~ and ~/x');
    expect(text('/Users/John Doe/x.ts')).toBe('~/x.ts');
    expect(text('GET /home/dashboard returns 200')).toBe('GET ~ returns 200');
  });

  it('masks a spaced Windows profile', () => {
    expect(text('C:\\Users\\John Smith\\a.json')).toBe('~/a.json');
    expect(selection('C:\\Users\\John Smith\\a.json')).toBe('~\\a.json');
    expect(text('"C:\\Users\\John Smith"')).toBe('"~"');
    expect(selection('"C:\\Users\\John Smith"')).toBe('"~"');
    expect(text('C:/Users/John Smith/a.json')).toBe('~/a.json');
    expect(text('C:\\Users\\John Smith')).toBe('~');
    expect(text('/mnt/c/Users/John Smith/a.json')).toBe('~/a.json');
    expect(text('"/mnt/c/Users/John Smith"')).toBe('"~"');
    expect(text('/c/Users/John Smith/a.json')).toBe('~/a.json');
    expect(text('"C:\\\\Users\\\\John Smith\\\\a.json"')).toBe('"~/a.json"');
  });

  it('masks a name with an apostrophe or a bracket', () => {
    expect(text("C:\\Users\\O'Brien\\x")).toBe('~/x');
    expect(text('C:\\Users\\John (Work)\\x')).toBe('~/x');
  });

  it('stops before a drive, so the next home is masked too', () => {
    expect(text('C:\\Users\\bob and C:\\Users\\bob\\x')).toBe('~ ~/x');
    expect(selection('C:\\Users\\bob and C:\\Users\\bob\\x')).toBe('~ ~\\x');
    expect(text('C:\\Users\\bob;C:\\Users\\bob\\x')).toBe('~;~/x');
    expect(text('C:\\Users\\bob,D:\\Users\\bob')).toBe('~,~');
    expect(text('/mnt/c/Users/bob and C:\\Users\\bob\\x')).toBe('~ ~/x');
  });

  it('does not take the next path for the rest of a home', () => {
    expect(text('/mnt/c/Users/bob and /mnt/c/Users/bob/x')).toBe('~ ~/x');
    expect(text('/mnt/c/Users/bob;/mnt/c/Users/bob/x')).toBe('~;~/x');
    expect(text('C:/Users/bob and /tmp/x')).toBe('~ /tmp/x');
  });

  it('stops at a character Windows forbids, or a line break', () => {
    expect(text('C:\\Users\\bob: no access')).toBe('~: no access');
    expect(text('C:\\Users\\bob is here\nnext line')).toBe('~\nnext line');
    expect(text('see C:\\Users\\bob|next')).toBe('see ~|next');
  });

  it('swallows the rest of a line after an unbounded home of another machine: an accepted limit', () => {
    expect(text('Could not open C:\\Users\\bob for reading, retry 3')).toBe('Could not open ~');
    expect(selection('opens C:\\Users\\bob first')).toBe(selection('opens C:\\Users\\bob last'));
    expect(text('at f (C:\\Users\\bob)')).toBe('at f (~');
    expect(text("'C:\\Users\\John Smith'")).toBe("'~");
  });

  it('does not swallow anything after the real home, known exactly', () => {
    const real = createPathRewriter({ roots: [], home: 'C:\\Users\\bob' });
    expect(real.text('Could not open C:\\Users\\bob for reading, retry 3')).toBe('Could not open ~ for reading, retry 3');
  });

  it('stays fast on a long text without a separator', () => {
    const started = performance.now();
    text(`C:\\Users\\${'a'.repeat(1_000_000)}*`);
    text(`/mnt/c/Users/a b *`.repeat(50_000));
    text(`C:\\Users\\${'x:'.repeat(500_000)}`);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('rule 2 and the ancestors holding home directories', () => {
  const file = (root: string, home: string, line: string) => createPathRewriter({ roots: [root], home }).file(line);

  it('never writes the `Users` of a mounted drive as `../`', () => {
    expect(file('/mnt/c/Dev/proj', '/home/me', 'at /mnt/c/Users/me/.cache/x.js:1:1')).toBe('at ~/.cache/x.js:1:1');
    expect(file('/mnt/c/Users/me/proj', '/home/me', 'at /mnt/c/Users/other/x.js:1:1')).toBe('at ~/x.js:1:1');
    expect(file('/cygdrive/c/Dev/proj', '/home/me', 'at /cygdrive/c/Users/me/x.js:1:1')).toBe('at ~/x.js:1:1');
  });

  it('keeps a mounted path absolute, like the path of another directory of a drive', () => {
    expect(file('/mnt/c/Dev/proj', '/home/me', 'at /mnt/c/other/x.js:1:1')).toBe('at /mnt/c/other/x.js:1:1');
    expect(file('C:\\Dev\\proj', 'C:\\Users\\me', 'at C:\\other\\x.js:1:1')).toBe('at C:\\other\\x.js:1:1');
  });

  it('still relates what shares a named directory with the root', () => {
    expect(file('/mnt/c/Dev/proj', '/home/me', 'at /mnt/c/Dev/lib/x.js:1:1')).toBe('at ../lib/x.js:1:1');
    expect(file('/mnt/c/Users/me/proj', '/home/me', 'at /mnt/c/Users/me/lib/x.js:1:1')).toBe('at ../lib/x.js:1:1');
    expect(file('/mnt/data/proj', '/home/me', 'at /mnt/data/lib/x.js:1:1')).toBe('at ../lib/x.js:1:1');
    expect(file('/var/lib/app/tests', '/home/me', 'at /var/lib/other/x.js:1:1')).toBe('at ../../other/x.js:1:1');
  });

  it('never writes `/var/home` as `../`', () => {
    expect(file('/var/lib/app/tests', '/home/me', 'at /var/home/bob/x.js:1:1')).toBe('at ~/x.js:1:1');
    expect(file('/var/home/me/proj', '/var/home/me', 'at /var/home/other/x.js:1:1')).toBe('at ~/x.js:1:1');
    expect(file('/var/home/me/proj', '/var/home/me', 'at /var/home/me/lib/x.js:1:1')).toBe('at ../lib/x.js:1:1');
  });

  it('never writes the `home` of a WSL share as `../`', () => {
    const root = '\\\\wsl$\\Ubuntu\\home\\me\\proj';
    expect(file(root, 'C:\\Users\\me', 'at \\\\wsl$\\Ubuntu\\home\\other\\x.js:1:1')).toBe('at ~/x.js:1:1');
    expect(file(root, 'C:\\Users\\me', 'at \\\\wsl$\\Ubuntu\\home\\me\\lib\\x.js:1:1')).toBe('at ../lib/x.js:1:1');
  });
});

describe('escaped separators', () => {
  const real = createPathRewriter({ roots: ['D:\\app\\tests'], home: 'C:\\Users\\Real Name' });

  it('masks a real home as `expect` and `JSON.stringify` print it', () => {
    expect(real.text('Received: "C:\\\\Users\\\\Real Name\\\\a.json"')).toBe('Received: "~/a.json"');
    expect(real.text('{"p":"C:\\\\Users\\\\Real Name"}')).toBe('{"p":"~"}');
  });

  it('masks a generic home the same way, escaped once or more', () => {
    expect(real.text('Received: "C:\\\\Users\\\\bob\\\\a.json"')).toBe('Received: "~/a.json"');
    expect(real.text('"E:\\\\\\\\Users\\\\\\\\bob\\\\\\\\a\\\\\\\\b"')).toBe('"~/a/b"');
  });

  it('applies rule 1 to an escaped root', () => {
    expect(real.text('"D:\\\\app\\\\tests\\\\web\\\\a.ts"')).toBe('"web/a.ts"');
  });

  it('leaves a POSIX path alone', () => {
    expect(real.text('/opt/a\\\\b')).toBe('/opt/a\\\\b');
  });
});

describe('locationFile', () => {
  const win = createPathRewriter({ roots: ['C:\\r\\tests'], home: 'C:\\Users\\alice' });
  const posix = createPathRewriter({ roots: ['/r/tests'], home: '/home/alice' });
  const winFile = (file: string) => locationFile(file, 'C:\\r\\tests', win, path.win32);
  const posixFile = (file: string) => locationFile(file, '/r/tests', posix, path.posix);

  it('is relative to the root dir, `../` outside it', () => {
    expect(winFile('C:\\r\\tests\\web\\a.spec.ts')).toBe('web/a.spec.ts');
    expect(winFile('c:\\R\\lib\\h.ts')).toBe('../lib/h.ts');
    expect(posixFile('/r/lib/h.ts')).toBe('../lib/h.ts');
  });

  it('masks a home outside the root as `~/`', () => {
    expect(winFile('D:\\Users\\bob\\h.ts')).toBe('~/h.ts');
    expect(posixFile('/home/bob/h.ts')).toBe('~/h.ts');
  });

  it('falls back to the path relative to the root dir when the rules leave it absolute', () => {
    expect(winFile('C:\\Windows\\x.ts')).toBe('../../Windows/x.ts');
    expect(posixFile('/opt/shared/x.ts')).toBe('../../opt/shared/x.ts');
  });

  it('is null without a relative form: another drive, a UNC share, a path of the other kind', () => {
    expect(winFile('D:\\shared\\h.ts')).toBeNull();
    expect(winFile('\\\\server\\share\\h.ts')).toBeNull();
    expect(posixFile('C:\\r\\tests\\a.spec.ts')).toBeNull();
    expect(posixFile('D:/shared/h.ts')).toBeNull();
  });
});

describe('the renderer dev sample', () => {
  const text = readFileSync(new URL('../src/renderer/dev/sample.json', import.meta.url), 'utf8');
  const absolute = /^(?:\/|[A-Za-z]:|\\)/;

  it('holds no machine path: no placeholder, home, drive or file:// URL', () => {
    expect(text).not.toMatch(/<root>|file:\/\/|\/(?:home|Users|root)\/|[A-Za-z]:\\\\/);
  });

  it('has relative stack frames and locations', () => {
    const frames: string[] = [];
    const files: string[] = [];
    JSON.parse(text, (key: string, value: unknown) => {
      if (key === 'stack' && typeof value === 'string') {
        for (const line of value.split('\n')) {
          const location = /^\s+at (?:.+? \()?(.+?)\)?$/.exec(line)?.[1];
          if (location !== undefined) frames.push(location);
        }
      }
      if (key === 'location' && value !== null && typeof value === 'object') files.push((value as { file: string }).file);
      return value;
    });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((frame) => absolute.test(frame))).toEqual([]);
    expect(files.filter((file) => absolute.test(file))).toEqual([]);
  });
});
