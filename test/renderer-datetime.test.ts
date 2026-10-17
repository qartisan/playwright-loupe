import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatRunStart } from '../src/renderer/datetime.js';

describe('formatRunStart', () => {
  // The viewer's time zone comes from the system: fixed through TZ for the test.
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env['TZ'];
    process.env['TZ'] = 'Europe/Paris';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env['TZ'];
    else process.env['TZ'] = previous;
  });

  it('formats in the viewer time zone, with the zone written out', () => {
    const start = formatRunStart('2026-10-16T15:04:31.484Z', { locale: 'en-GB' });
    expect(start?.utc).toBe('2026-10-16T15:04:31.484Z');
    expect(start?.label).toBe('16 Oct 2026, 17:04 CEST');
    expect(start?.timeZone).toBe('Europe/Paris');
    // Punctuation varies between ICU versions: the parts are checked, not the exact string.
    expect(start?.full).toMatch(/^Friday,? 16 October 2026 at 17:04:31 CEST$/);
  });

  it('follows daylight saving time', () => {
    expect(formatRunStart('2026-12-01T08:00:00Z', { locale: 'en-GB' })?.label).toBe('1 Dec 2026, 09:00 CET');
  });

  it('uses the locale for the format', () => {
    expect(formatRunStart('2026-10-16T15:04:31.484Z', { locale: 'en-US' })?.label).toMatch(/^Oct 16, 2026, 05:04\s(?:PM|pm) GMT\+2$/u);
  });

  it('accepts an explicit time zone', () => {
    const start = formatRunStart('2026-10-16T15:04:31.484Z', { locale: 'en-GB', timeZone: 'America/New_York' });
    expect(start?.label).toBe('16 Oct 2026, 11:04 GMT-4');
    expect(start?.timeZone).toBe('America/New_York');
  });

  it.each([undefined, null, '', 'not a date', 42, '2026-13-45T99:00:00Z'])('returns null for %j', (value) => {
    expect(formatRunStart(value)).toBeNull();
  });
});
