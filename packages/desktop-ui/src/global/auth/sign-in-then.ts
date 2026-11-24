import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";

let pending: (() => void) | null = null;

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
