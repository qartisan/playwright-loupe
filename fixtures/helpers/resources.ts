import type { APIRequestContext, APIResponse } from '@playwright/test';
import { withStatusServer } from './status-server.js';

// A shared response helper, outside testDir, used by unrelated tests in
// tests/resources/. Their failures are intentional and have nothing to do
// with each other: the helper is a false common failure point, on purpose.
// See fixtures/README.md. Do not "fix" these tests.

/**
 * Fails unless the response status is 2xx. The message names the status and
 * its reason phrase, so each status gets its own error signature (a failed
 * `toBeOK()` keeps the status in its call log, which signatures leave out).
 */
export function checkResponse(response: APIResponse): void {
  if (!response.ok()) throw new Error(`Unexpected response: ${response.status()} ${response.statusText()} for ${response.url()}`);
}

/** Gets `pathname` from a local server answering `status`, then checks the response. */
export async function fetchResource(request: APIRequestContext, pathname: string, status: number): Promise<APIResponse> {
  const response = await withStatusServer(status, (url) => request.get(url), pathname);
  checkResponse(response);
  return response;
}
