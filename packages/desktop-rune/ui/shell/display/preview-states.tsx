import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { reportRendererError } from "@/platform/diagnostics/report-error";
import { EmptyState, Icons, type EmptyStateMotif } from "../../kit";

const READABLE_ERROR_MAX = 120;
const isReadableError = (error: string): boolean => error.length <= READABLE_ERROR_MAX && !/(^|\s)(\/|[A-Za-z]:\\)\S/u.test(error) && !/^[\w.-]+:[\w.-]+\b/u.test(error);

/** desktop-ui's `PreviewProblem`: a missing file, or a preview that failed (with a retry). */
export function PreviewProblem({ error, missing = false, onRetry, size = "regular", title }: { error?: string | null; missing?: boolean; onRetry?: () => void; size?: "regular" | "compact"; title?: string }) {
  const t = useT();
  const message = error?.trim() ?? "";
  if (missing) return <EmptyState motif="unavailable" size={size} title={title ?? t("shell.display.preview.unavailableTitle")} body={message || undefined} />;
  const readable = message.length > 0 && message !== t("shell.display.preview.unavailable") && isReadableError(message);
  return (
    <EmptyState
      motif="preview"
      size={size}
      title={title ?? t("shell.display.preview.failedTitle")}
      body={readable ? message : t("shell.display.preview.failedBody")}
      detail={message && !readable ? message : undefined}
      action={onRetry ? { label: t("common.tryAgain"), icon: Icons.stella.RotateCcw, onClick: onRetry } : undefined}
    />
  );
}

export function PreviewEmpty({ title, body, motif = "blank", size = "regular" }: { title: string; body?: string; motif?: EmptyStateMotif; size?: "regular" | "compact" }) {
  return <EmptyState motif={motif} size={size} title={title} body={body} />;
}

type PreviewBoundaryState = { error: Error | null; attempt: number };

/** desktop-ui's `PreviewBoundary`: a viewer body that throws shows the failure with a retry. */
export class PreviewBoundary extends Component<{ children: ReactNode }, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<PreviewBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportRendererError({ kind: "react", message: error.message, ...(error.stack ? { stack: error.stack } : {}), source: info.componentStack?.trim().split("\n")[0]?.trim() ?? "preview" });
  }

  retry = () => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  render() {
    if (this.state.error) return <PreviewProblem error={this.state.error.message} onRetry={this.retry} />;
    return <PreviewBoundaryKey key={this.state.attempt}>{this.props.children}</PreviewBoundaryKey>;
  }
}

function PreviewBoundaryKey({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
