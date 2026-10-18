/**
 * URL parameters of the test detail, next to the filter parameters in the
 * query of the fragment:
 *
 *   #/test/<id>?status=failed&attempt=1&steps=all
 *
 * `attempt` is the attempt index (0 for the first run); `steps=all` shows
 * every step category. Both belong to the test detail only: other pages drop
 * them, and `attempt` is not carried to another test.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export interface DetailParams {
  attempt: number | null;
  allSteps: boolean;
}

export const NO_DETAIL_PARAMS: DetailParams = { attempt: null, allSteps: false };

const INDEX = /^(0|[1-9]\d{0,5})$/;

/** Reads the detail parameters from a raw query (without `?`); malformed values are ignored. */
export function parseDetailParams(search: string): DetailParams {
  let attempt: number | null = null;
  let allSteps = false;
  for (const pair of search.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === 'attempt' && INDEX.test(value)) attempt = Number(value);
    if (key === 'steps' && value === 'all') allSteps = true;
  }
  return { attempt, allSteps };
}

/** The canonical form, without `?`; empty when both are at their default. */
export function serializeDetailParams(params: DetailParams): string {
  const parts: string[] = [];
  if (params.attempt !== null) parts.push(`attempt=${params.attempt}`);
  if (params.allSteps) parts.push('steps=all');
  return parts.join('&');
}

/** Joins query parts, skipping empty ones. */
export function joinQuery(...parts: string[]): string {
  return parts.filter((part) => part !== '').join('&');
}
