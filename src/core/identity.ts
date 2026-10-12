import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Stable test id: first 16 hex chars of
 * sha256(project + '\0' + file + '\0' + titlePath.join('\0')), where `file` is
 * root-relative with POSIX separators and `titlePath` is the describe titles
 * followed by the test title.
 */
export function computeTestId(project: string, file: string, titlePath: readonly string[]): string {
  return createHash('sha256')
    .update([project, file, ...titlePath].join('\0'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Path of `target` relative to `base`, with POSIX separators; '.' when both are
 * the same directory. `pathImpl` is injectable so Windows paths can be tested
 * on any platform.
 */
export function relativePosix(base: string, target: string, pathImpl: path.PlatformPath = path): string {
  const relative = pathImpl.relative(base, target);
  if (relative === '') return '.';
  return pathImpl.sep === '/' ? relative : relative.split(pathImpl.sep).join('/');
}
