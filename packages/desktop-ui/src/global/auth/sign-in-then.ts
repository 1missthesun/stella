import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";

let pending: (() => void) | null = null;

/**
 * Opens the sign-in dialog. `action` runs after the next sign-in, once the
 * account's own model choice has loaded, unless the dialog is closed first.
 */
export const signInThen = (action: () => void): void => {
  pending = action;
  SIGN_IN_TOAST_ACTION.onClick();
};

export const runAfterSignIn = (): void => {
  const action = pending;
  pending = null;
  action?.();
};

export const dropAfterSignIn = (): void => {
  pending = null;
};
