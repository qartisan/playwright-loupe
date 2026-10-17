/**
 * Run start date and time, in the viewer's time zone and locale, the time
 * zone always written out. Never relative ("2 hours ago"): a static report is
 * often read long after the run. Pure: unit-tested with a fixed time zone.
 */

export interface RunStart {
  /** UTC ISO 8601, for `<time datetime>`. */
  utc: string;
  /** Short form: `Oct 16, 2026, 05:04 PM GMT+2` (depends on the locale). */
  label: string;
  /** Full date with seconds: `Friday, October 16, 2026 at 5:04:31 PM GMT+2`. */
  full: string;
  /** IANA time zone of the viewer: `Europe/Paris`. */
  timeZone: string;
}

export interface DateFormatOptions {
  /** Defaults to the browser locale. */
  locale?: string;
  /** Defaults to the system time zone. */
  timeZone?: string;
}

/** Null when `startedAt` is missing or not a valid date (older JSON, unusual merge). */
export function formatRunStart(startedAt: unknown, options: DateFormatOptions = {}): RunStart | null {
  if (typeof startedAt !== 'string' || startedAt === '') return null;
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return null;
  const zone = options.timeZone === undefined ? {} : { timeZone: options.timeZone };
  const short = new Intl.DateTimeFormat(options.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...zone,
  });
  const full = new Intl.DateTimeFormat(options.locale, { dateStyle: 'full', timeStyle: 'long', ...zone });
  return {
    utc: date.toISOString(),
    label: short.format(date),
    full: full.format(date),
    timeZone: short.resolvedOptions().timeZone,
  };
}
