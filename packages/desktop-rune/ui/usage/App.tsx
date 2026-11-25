import { Press, RefreshCw, T, tx } from "../kit/compat";
import { useUsage } from "./usage.styles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalModelUsagePage } from "@stella/contracts/local-chat";
import { useT } from "@/shared/i18n";
import {
  buildUsageTimeline,
  executionLabel,
  filterUsageRecords,
  groupUsageByThread,
  rangeStartMs,
  summarizeUsage,
  type UsageRange,
} from "@/app/usage/usage-data";
import { threadLabel } from "@/app/usage/format";
import { UsageFiltersBar, type UsageSearchPatch } from "./UsageFiltersBar";
import { UsageSummaryCards } from "./UsageSummaryCards";
import { UsageTimelineChart } from "./UsageTimelineChart";
import { UsageThreadsTable } from "./UsageThreadsTable";
import { UsageCallsTable } from "./UsageCallsTable";

const EMPTY_PAGE: LocalModelUsagePage = { records: [], truncated: false };

type UsageFiltersState = {
  range: UsageRange;
  conversation?: string;
  thread?: string;
  agent?: string;
  model?: string;
};

export function UsagePanel() {
  const s = useUsage();
  const t = useT();
  const [filters, setFilters] = useState<UsageFiltersState>({ range: "7d" });
  const [basePage, setBasePage] = useState<LocalModelUsagePage>(EMPTY_PAGE);
  const [scoped, setScoped] = useState<{
    key: string;
    page: LocalModelUsagePage;
  } | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const fetchingRef = useRef(false);
  const isActive = true;
  const isActiveRef = useRef(isActive);
  const pendingWhileHiddenRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  const range = filters.range;
  const load = useCallback(async () => {
    const api = window.electronAPI?.localChat;
    if (!api?.listModelUsage) {
      setError(t("app.usage.desktopOnly"));
      setPhase("error");
      return;
    }
    setPhase((current) => (current === "ready" ? current : "loading"));
    fetchingRef.current = true;
    try {
      const next = await api.listModelUsage({
        fromMs: rangeStartMs(range),
        limit: 10_000,
      });
      setBasePage(next);
      setError("");
      setPhase("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    } finally {
      fetchingRef.current = false;
    }
  }, [range, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const scopedKey = `${filters.conversation ?? ""}|${filters.thread ?? ""}|${range}`;
  const needsScopedPage =
    basePage.truncated && Boolean(filters.conversation || filters.thread);
  useEffect(() => {
    if (!needsScopedPage) {
      setScoped(null);
      return;
    }
    const api = window.electronAPI?.localChat;
    if (!api?.listModelUsage) return;
    let cancelled = false;
    void api
      .listModelUsage({
        fromMs: rangeStartMs(range),
        limit: 10_000,
        conversationId: filters.conversation,
        threadId: filters.thread,
      })
      .then((page) => {
        if (!cancelled) setScoped({ key: scopedKey, page });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [
    basePage,
    needsScopedPage,
    range,
    scopedKey,
    filters.conversation,
    filters.thread,
  ]);

  useEffect(() => {
    let timeout = 0;
    const refresh = () => {
      if (!isActiveRef.current) {
        pendingWhileHiddenRef.current = true;
        return;
      }
      if (fetchingRef.current) {
        timeout = window.setTimeout(refresh, 2000);
        return;
      }
      setRefreshKey((value) => value + 1);
    };
    refreshRef.current = refresh;
    const queueRefresh = () => {
      if (!isActiveRef.current) {
        pendingWhileHiddenRef.current = true;
        return;
      }
      window.clearTimeout(timeout);
      timeout = window.setTimeout(refresh, 2000);
    };
    const removeChat = window.electronAPI?.localChat?.onUpdated?.(queueRefresh);
    return () => {
      window.clearTimeout(timeout);
      removeChat?.();
    };
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
    if (!isActive || !pendingWhileHiddenRef.current) return;
    pendingWhileHiddenRef.current = false;
    refreshRef.current();
  }, [isActive]);

  const baseRecords = basePage.records;
  const activePage =
    scoped && scoped.key === scopedKey ? scoped.page : basePage;

  const records = useMemo(
    () =>
      filterUsageRecords(activePage.records, {
        conversationId: filters.conversation,
        threadId: filters.thread,
        agentType: filters.agent,
        model: filters.model,
      }),
    [
      activePage,
      filters.agent,
      filters.conversation,
      filters.model,
      filters.thread,
    ],
  );
  const summary = useMemo(() => summarizeUsage(records), [records]);
  const threads = useMemo(() => groupUsageByThread(records), [records]);
  const timeline = useMemo(
    () => buildUsageTimeline(records, range),
    [range, records],
  );

  const updateSearch = useCallback((patch: UsageSearchPatch) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);
  const selectThread = useCallback(
    (conversationId: string, threadId: string) =>
      updateSearch({ conversation: conversationId, thread: threadId }),
    [updateSearch],
  );

  const selectedThread = filters.thread
    ? (baseRecords.find((record) => record.threadId === filters.thread) ??
      records.find((record) => record.threadId === filters.thread))
    : undefined;

  return (
    <col w="full" {...s.usageScreen} aria-busy={phase === "loading" || undefined}>
      <row {...s.usageHeader}>
        <T {...tx(s.usageScreen)}>{t("app.usage.intro")}</T>
        <Press text={tx(s.usageScreen)} {...s.usageRefresh} onPress={() => setRefreshKey((value) => value + 1)} label={t("app.usage.refreshLabel")} title={t("app.usage.refreshLabel")}>
          <RefreshCw size={16} color={s.usageRefresh.color} />
          {t("app.usage.refresh")}
        </Press>
      </row>

      <UsageFiltersBar range={range} conversation={filters.conversation} thread={filters.thread} agent={filters.agent} model={filters.model} records={baseRecords} onSearchChange={updateSearch} />

      {selectedThread ? (
        <col {...s.usageSelection} label={t("app.usage.selectedThread")}>
          <col>
            <T {...tx(s.usageScreen)}>{executionLabel(selectedThread)}</T>
            <T {...tx(s.usageScreen)} weight={700}>{threadLabel(selectedThread)}</T>
            <T {...tx(s.usageScreen)}>{selectedThread.threadId}</T>
          </col>
          <Press text={tx(s.usageScreen)} onPress={() => updateSearch({ thread: undefined })}>
            {t("app.usage.viewAllThreads")}
          </Press>
        </col>
      ) : null}

      {phase === "loading" ? (
        <T {...tx(s.usageScreen)} w="full" {...s.usageState} role="status">
          {t("app.usage.loading")}
        </T>
      ) : phase === "error" ? (
        <col {...s.usageState} role="alert">
          <T {...tx(s.usageScreen, s.usageState)} weight={700}>{t("app.usage.loadError")}</T>
          <T {...tx(s.usageScreen, s.usageState)}>{error}</T>
          <Press text={tx(s.usageScreen, s.usageState)} onPress={() => void load()}>
            {t("app.usage.tryAgain")}
          </Press>
        </col>
      ) : records.length === 0 ? (
        <col {...s.usageState} role="status">
          <T {...tx(s.usageScreen, s.usageState)} weight={700}>{t("app.usage.emptyTitle")}</T>
          <T {...tx(s.usageScreen, s.usageState)}>{t("app.usage.emptyBody")}</T>
        </col>
      ) : (
        <>
          {activePage.truncated ? (
            <T {...tx(s.usageScreen)} w="full" {...s.usageWarning} role="status">
              {t("app.usage.truncatedWarning")}
            </T>
          ) : null}

          <UsageSummaryCards summary={summary} />
          <UsageTimelineChart timeline={timeline} />
          <UsageThreadsTable threads={threads} onSelectThread={selectThread} />
          <UsageCallsTable records={records} onSelectThread={selectThread} />
        </>
      )}
    </col>
  );
}
