import type { ReactNode } from "react";
import { ToastRegion } from "../Toast";

export { dismissToast, showToast, type ToastOptions } from "../Toast";

/** desktop-ui's `ToastProvider`: its children and the window's toast stack. */
export function ToastProvider({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <ToastRegion />
    </>
  );
}
