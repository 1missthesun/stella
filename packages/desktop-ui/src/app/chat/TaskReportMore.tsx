import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { LocalChatAgentReport } from "@stella/contracts/local-chat";
import { Markdown } from "./Markdown";
import { X } from "@/ui/icons";
import { Popover } from "@/ui/popover";
import { useT } from "@/shared/i18n";
import { useCloudAgentReport } from "@/features/cloud/use-cloud-agent-report";
import { useAgentTitle } from "@/features/cloud/use-agent-title";
import { piAgentReport, piChatAvailable } from "@/features/chat/pi/pi-chat-store";
import "./reply-preview.css";

const reportCache = new Map<string, Promise<LocalChatAgentReport | null>>();

const fetchAgentReport = (
  threadId: string,
  conversationId: string,
): Promise<LocalChatAgentReport | null> => {
  const cached = reportCache.get(threadId);
  if (cached) return cached;
  const request = piChatAvailable()
    ? piAgentReport(conversationId, threadId).catch(() => null)
    : Promise.resolve(null);
  reportCache.set(threadId, request);
  void request.then((report) => {
    if (!report || report.status === "running") reportCache.delete(threadId);
  });
  return request;
};

type AgentRef = Extract<ReplyRef, { kind: "agent" }>;
type TaskStatus = "running" | "completed" | "error" | "canceled";

export type TaskReportEntry = {
  reference: AgentRef;
  status?: TaskStatus;
  liveTitle?: string;
  journalReport?: string;
};

type LoadedReport = { title: string; body: string | null };

function TaskReportLoader({
  entry: { reference, status, liveTitle, journalReport },
  conversationId,
  requested,
  onChange,
}: {
  entry: TaskReportEntry;
  conversationId: string;
  requested: boolean;
  onChange: (threadId: string, report: LoadedReport) => void;
}) {
  const t = useT();
  const [report, setReport] = useState<LocalChatAgentReport | null | undefined>(
    undefined,
  );
  const fetchedRef = useRef(false);
  const cloudReport = useCloudAgentReport(
    conversationId,
    reference.threadId,
    requested,
  );
  const resolvedReport =
    cloudReport === undefined ? undefined : (cloudReport ?? report);
  const title =
    useAgentTitle(conversationId, reference.threadId, [
      liveTitle,
      reference.title,
      cloudReport?.description,
    ]) || t("app.chat.focus.agentFallback");

  const fetchReport = useCallback(() => {
    fetchedRef.current = true;
    void fetchAgentReport(reference.threadId, conversationId).then((next) => {
      setReport(next);
    });
  }, [conversationId, reference.threadId]);

  useEffect(() => {
    if (requested && !fetchedRef.current) fetchReport();
  }, [fetchReport, requested]);

  useEffect(() => {
    if (
      status === "completed" &&
      fetchedRef.current &&
      report?.status === "running"
    ) {
      reportCache.delete(reference.threadId);
      fetchReport();
    }
  }, [fetchReport, reference.threadId, report?.status, status]);

  const recordedReport =
    resolvedReport?.result?.trim() || resolvedReport?.error?.trim();
  const body =
    recordedReport ||
    journalReport?.trim() ||
    (resolvedReport === undefined
      ? null
      : resolvedReport === null
        ? t("app.chat.replyPreview.reportUnavailable")
        : t("app.chat.replyPreview.reportEmpty"));

  useEffect(() => {
    onChange(reference.threadId, { title, body });
  }, [body, onChange, reference.threadId, title]);

  return null;
}

export function TaskReportMore({
  reports,
  conversationId,
}: {
  reports: readonly TaskReportEntry[];
  conversationId: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedReport>>(
    () => new Map(),
  );
  const onLoaderChange = useCallback(
    (threadId: string, next: LoadedReport) => {
      setLoaded((previous) => {
        const current = previous.get(threadId);
        if (current?.title === next.title && current.body === next.body) {
          return previous;
        }
        const updated = new Map(previous);
        updated.set(threadId, next);
        return updated;
      });
    },
    [],
  );
  const prefetch = useCallback(() => setRequested(true), []);
  const onOpenChange = useCallback((next: boolean) => {
    if (next) setRequested(true);
    setOpen(next);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const sections = reports.map(({ reference }) => ({
    threadId: reference.threadId,
    title:
      loaded.get(reference.threadId)?.title ||
      reference.title ||
      t("app.chat.focus.agentFallback"),
    body: loaded.get(reference.threadId)?.body ?? null,
  }));
  const multiple = sections.length > 1;
  const label = multiple
    ? sections.map((section) => section.title).join(", ")
    : (sections[0]?.title ?? "");

  return (
    <div
      className="task-report task-report--inline"
      data-reply-ref-thread-id={reports.map((entry) => entry.reference.threadId).join(" ")}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      {reports.map((entry) => (
        <TaskReportLoader
          key={entry.reference.threadId}
          entry={entry}
          conversationId={conversationId}
          requested={requested}
          onChange={onLoaderChange}
        />
      ))}
      <Popover open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="reply-report-more"
            aria-label={`${t("app.chat.replyPreview.showReport")}: ${label}`}
          >
            {t("app.chat.userMessage.showMore")}
          </button>
        </Popover.Trigger>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="reply-preview-report-popover"
        >
          <div
            className={
              multiple
                ? "reply-preview-report reply-preview-report--multiple"
                : "reply-preview-report"
            }
            data-testid="reply-preview-report"
          >
            <button
              type="button"
              className="reply-preview-report__close"
              onClick={close}
              aria-label={t("app.chat.replyPreview.closeReport")}
              title={t("app.chat.replyPreview.closeReport")}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className="reply-preview-report__sections">
              {sections.map((section) => (
                <section
                  key={section.threadId}
                  className="reply-preview-report__section"
                  data-reply-ref-thread-id={section.threadId}
                >
                  <div className="reply-preview-report__head">
                    <span className="reply-preview-report__title">
                      {section.title}
                    </span>
                  </div>
                  <div className="reply-preview-report__body">
                    {section.body === null ? (
                      <span className="reply-preview__report-loading">
                        {t("app.chat.replyPreview.reportLoading")}
                      </span>
                    ) : (
                      <Markdown
                        text={section.body}
                        cacheKey={`reply-preview-report:${section.threadId}`}
                      />
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover>
    </div>
  );
}
