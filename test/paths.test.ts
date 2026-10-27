import { describe, expect, it } from 'vitest';
import { createPathRewriter, rootsFromStack } from '../src/core/paths.js';

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

  it('requires a boundary before a prefix: the path of a URL is left alone', () => {
    expect(posixRewriter.text('GET http://localhost/home/alice/shop/tests/x')).toBe('GET http://localhost/home/alice/shop/tests/x');
    expect(posix('x/home/alice/shop/tests/a.ts')).toBe('x/home/alice/shop/tests/a.ts');
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
