import type { AttachmentKind, ComparisonRole } from '../schema/v1.js';

/** Text bodies up to this size (UTF-8 bytes) are inlined in the JSON; larger ones are written to files. */
export const INLINE_TEXT_LIMIT = 4 * 1024;

const TEXT_TYPE = /^(?:text\/|application\/(?:json|xml|javascript)\b|application\/[\w.+-]+\+(?:json|xml)\b)/i;

export function isTextContentType(contentType: string): boolean {
  return TEXT_TYPE.test(contentType);
}

export function attachmentKind(name: string, contentType: string): AttachmentKind {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) return 'screenshot';
  if (type.startsWith('video/')) return 'video';
  if (name === 'trace' || (type === 'application/zip' && /trace/i.test(name))) return 'trace';
  if (isTextContentType(type)) return 'text';
  return 'other';
}

const COMPARISON_NAME = /^(.+)-(expected|actual|diff)(\.[a-z0-9]+)?$/i;

/**
 * toHaveScreenshot / toMatchSnapshot attach images named `<name>-expected.png`,
 * `<name>-actual.png` and `<name>-diff.png`. The group is the name without the
 * role suffix (`<name>.png`), shared by the three images.
 */
export function comparisonOf(name: string, contentType: string): { group: string; role: ComparisonRole } | null {
  if (!contentType.toLowerCase().startsWith('image/')) return null;
  const match = COMPARISON_NAME.exec(name);
  if (!match) return null;
  const [, base = '', role = '', extension = ''] = match;
  return { group: base + extension, role: role.toLowerCase() as ComparisonRole };
}

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'application/zip': '.zip',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/csv': '.csv',
};

/** File extension for a content type, '.bin' when unknown. */
export function extensionFor(contentType: string): string {
  const type = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  return EXTENSIONS[type] ?? (isTextContentType(type) ? '.txt' : '.bin');
}

/** Turns an attachment name into a safe single-segment file name. */
export function safeFileName(name: string): string {
  const safe = name
    .replace(/[^\w.@+-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 100);
  return safe || 'attachment';
}

/** File name for a body attachment: the safe name, plus an extension from the content type when it has none. */
export function bodyFileName(name: string, contentType: string): string {
  const safe = safeFileName(name);
  return /\.[a-z0-9]{1,8}$/i.test(safe) ? safe : safe + extensionFor(contentType);
}

/** Returns `fileName`, or `name-1.ext`, `name-2.ext`, ... when taken; records the result in `taken`. */
export function uniqueFileName(fileName: string, taken: Set<string>): string {
  let candidate = fileName;
  if (taken.has(candidate)) {
    const dot = fileName.lastIndexOf('.');
    const [stem, extension] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
    for (let i = 1; taken.has(candidate); i++) candidate = `${stem}-${i}${extension}`;
  }
  taken.add(candidate);
  return candidate;
}
