import type { APIRequestContext } from '@playwright/test';

// Shared by specs of both projects. Two of its accounts no longer sign in,
// which makes `signIn` the demo report's common failure point: see README.md.

export const accounts = {
  /** Signs in. */
  customer: { email: 'ana@example.test', password: 'demo-password' },
  /** Its password expired after the last data refresh. */
  returningCustomer: { email: 'ben@example.test', password: 'demo-password' },
  /** Now needs a two-factor code the suite does not provide. */
  staff: { email: 'staff@example.test', password: 'demo-password' },
};

export type Account = (typeof accounts)[keyof typeof accounts];

/**
 * Opens a session through the API. With `page.request`, the session cookie is
 * shared with the page, so the page is signed in too.
 */
export async function signIn(request: APIRequestContext, account: Account): Promise<string> {
  const response = await request.post('/api/session', { data: account });
  const body = (await response.json()) as { token?: string; error?: string };
  if (!response.ok() || !body.token) throw new Error(`Sign-in failed for ${account.email}: ${response.status()} ${body.error ?? 'no token'}`);
  return body.token;
}
