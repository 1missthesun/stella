import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportRendererError } from "@/platform/diagnostics/report-error";
import { STELLA_BUILD_ERROR_CLEARED_EVENT, STELLA_BUILD_ERROR_EVENT, type StellaBuildErrorDetail } from "@/platform/dev/vite-error-recovery";
import { CrashSurface } from "../shell/CrashSurface";

type Props = { children: ReactNode; fallback?: (error: Error | null, componentStack: string | null) => ReactNode };

type State = { hasError: boolean; caughtError: Error | null; componentStack: string | null; source: "react" | "build" };

/** desktop-ui's `ErrorBoundary`: a render error or a build error shows the crash surface. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, caughtError: null, componentStack: null, source: "react" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, caughtError: error, source: "react" };
  }

  componentDidMount() {
    window.addEventListener(STELLA_BUILD_ERROR_EVENT, this.handleBuildError as EventListener);
    window.addEventListener(STELLA_BUILD_ERROR_CLEARED_EVENT, this.handleBuildErrorCleared);
  }

  componentWillUnmount() {
    window.removeEventListener(STELLA_BUILD_ERROR_EVENT, this.handleBuildError as EventListener);
    window.removeEventListener(STELLA_BUILD_ERROR_CLEARED_EVENT, this.handleBuildErrorCleared);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    reportRendererError({
      kind: "react",
      message: error.message,
      stack: error.stack,
      source: info.componentStack?.trim().split("\n")[0]?.trim(),
    });
    this.setState({ caughtError: error, componentStack: info.componentStack ?? null, source: "react" });
  }

  private handleBuildError = (event: CustomEvent<StellaBuildErrorDetail>) => {
    const detail = event.detail;
    if (!detail?.error) return;
    this.setState({ hasError: true, caughtError: detail.error, componentStack: detail.frame ?? null, source: "build" });
  };

  private handleBuildErrorCleared = () => {
    if (this.state.source !== "build" || !this.state.hasError) return;
    this.setState({ hasError: false, caughtError: null, componentStack: null, source: "react" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { caughtError, componentStack } = this.state;
    return this.props.fallback ? this.props.fallback(caughtError, componentStack) : <CrashSurface error={caughtError} componentStack={componentStack} />;
  }
}
