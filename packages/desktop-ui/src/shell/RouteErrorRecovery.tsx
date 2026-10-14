import type { ErrorComponentProps } from "@tanstack/react-router";
import { CrashSurface } from "./CrashSurface";

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function RouteErrorRecovery(props: ErrorComponentProps) {
  return (
    <CrashSurface
      error={asError(props.error)}
      componentStack={props.info?.componentStack ?? null}
    />
  );
}
