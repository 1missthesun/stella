// Which account is signed in, for Stella Views: each account keeps its own copy of every view's
// saved values (src/views/view-host.ts), so a switch has to reach views before the new account's
// backend carries anything. Kept apart from the views host so the app's root can say it without
// loading views.

/** `account:<userId>`, null while signed out, undefined until the session is known. */
let current: string | null | undefined;
const listeners = new Set<() => void>();

export function setViewsAccount(account: string | null): void {
  if (account === current) return;
  current = account;
  for (const listener of listeners) listener();
}

export const viewsAccount = (): string | null | undefined => current;

export function onViewsAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
