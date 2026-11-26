import { Ink, Press, RefreshCw, T, TextScope, tx, useTextBase } from "../kit/compat";
import { usageLayout, useUsage, type UsageLayout } from "./usage.styles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalModelUsagePage, LocalModelUsageRecord } from "@stella/contracts/local-chat";
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
import { fetchUsagePage, readCachedUsagePage } from "./usage-cache";
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
  const initialCached = readCachedUsagePage("7d");
  const [basePage, setBasePage] = useState<LocalModelUsagePage>(() => initialCached ?? EMPTY_PAGE);
  const [scoped, setScoped] = useState<{
    key: string;
    page: LocalModelUsagePage;
  } | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(() => (initialCached ? "ready" : "loading"));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [width, setWidth] = useState(0);
  const fetchingRef = useRef(false);
  const forceNextRef = useRef(false);
  const refresh = useCallback(() => {
    forceNextRef.current = true;
    setRefreshKey((value) => value + 1);
  }, []);
  const isActive = true;
  const isActiveRef = useRef(isActive);
  const pendingWhileHiddenRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  const range = filters.range;
  const load = useCallback(
    async (force = false) => {
      const api = window.electronAPI?.localChat;
      if (!api?.listModelUsage) {
        setError(t("app.usage.desktopOnly"));
        setPhase("error");
        return;
      }
      const cached = readCachedUsagePage(range);
      if (cached) {
        setBasePage(cached);
        setPhase("ready");
      } else {
        setPhase("loading");
      }
      fetchingRef.current = true;
      setRefreshing(true);
      try {
        const next = await fetchUsagePage(range, { force });
        setBasePage(next);
        setError("");
        setPhase("ready");
      } catch (cause) {
        if (!cached) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setPhase("error");
        }
      } finally {
        fetchingRef.current = false;
        setRefreshing(false);
      }
    },
    [range, t],
  );

  useEffect(() => {
    const force = forceNextRef.current;
    forceNextRef.current = false;
    void load(force);
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
      forceNextRef.current = true;
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

  const usage = usageLayout(width);
  const base = useTextBase();
  const retry = (
    <Press {...s.usageTextAction} onPress={() => void load(true)}>
      <T {...tx(s.usageTextAction)}>{t("app.usage.tryAgain")}</T>
    </Press>
  );

  return (
    <TextScope base={{ ...base, family: s.usageScreenText.family, em: s.usageScreenText.em as number }}>
      <Ink.Provider value={s.usageScreenText.color}>
        <col {...s.usageScreen} aria-busy={phase === "loading" || undefined} onLayout={(r) => setWidth(r.w)}>
          {usage.narrow ? (
            <col {...s.usageHeader} {...s.usageHeaderNarrow}>
              <T {...s.usageHeaderText}>{t("app.usage.intro")}</T>
              <RefreshButton onPress={refresh} refreshing={refreshing} narrow />
            </col>
          ) : (
            <row {...s.usageHeader}>
              <T {...s.usageHeaderText}>{t("app.usage.intro")}</T>
              <RefreshButton onPress={refresh} refreshing={refreshing} />
            </row>
          )}

          <UsageFiltersBar layout={usage} range={range} conversation={filters.conversation} thread={filters.thread} agent={filters.agent} model={filters.model} records={baseRecords} onSearchChange={updateSearch} />

          {selectedThread ? <UsageSelection layout={usage} record={selectedThread} onViewAll={() => updateSearch({ thread: undefined })} /> : null}

          {phase === "loading" ? (
            <col {...s.usageState} role="status">
              <T {...s.usageStateText}>{t("app.usage.loading")}</T>
            </col>
          ) : phase === "error" ? (
            <col {...s.usageState} role="alert">
              <T {...s.usageStateTitle}>{t("app.usage.loadError")}</T>
              <T {...s.usageStateText}>{error}</T>
              {retry}
            </col>
          ) : records.length === 0 ? (
            <col {...s.usageState} role="status">
              <T {...s.usageStateTitle}>{t("app.usage.emptyTitle")}</T>
              <T {...s.usageStateText}>{t("app.usage.emptyBody")}</T>
            </col>
          ) : (
            <>
              {activePage.truncated ? (
                <row {...s.usageWarning} role="status">
                  <T {...tx(s.usageWarning)}>{t("app.usage.truncatedWarning")}</T>
                </row>
              ) : null}

              <UsageSummaryCards layout={usage} summary={summary} />
              <UsageTimelineChart timeline={timeline} height={usage.wide ? 230 : 210} />
              <UsageThreadsTable threads={threads} onSelectThread={selectThread} />
              <UsageCallsTable records={records} onSelectThread={selectThread} />
            </>
          )}
        </col>
      </Ink.Provider>
    </TextScope>
  );
}

function RefreshButton({ onPress, refreshing, narrow = false }: { onPress: () => void; refreshing: boolean; narrow?: boolean }) {
  const s = useUsage();
  const t = useT();
  return (
    <Press {...s.usageTextAction} {...(refreshing ? s.usageRefreshing : null)} {...(narrow ? s.usageRefreshNarrow : null)} onPress={onPress} label={t("app.usage.refreshLabel")} title={t("app.usage.refreshLabel")}>
      <RefreshCw size={14} color={s.usageTextAction.color} />
      <T {...tx(s.usageTextAction)}>{t("app.usage.refresh")}</T>
    </Press>
  );
}

function UsageSelection({ layout, record, onViewAll }: { layout: UsageLayout; record: LocalModelUsageRecord; onViewAll: () => void }) {
  const s = useUsage();
  const t = useT();
  const Box = layout.wide ? "row" : "col";
  return (
    <Box {...s.usageSelection} {...(layout.wide ? s.usageSelectionWide : null)} label={t("app.usage.selectedThread")}>
      <row {...s.usageSelectionInfo} {...(layout.wide ? s.usageSelectionInfoWide : null)}>
        <T {...s.usageSelectionKind}>{executionLabel(record)}</T>
        <T {...s.usageSelectionName}>{threadLabel(record)}</T>
        <T {...s.usageSelectionId} {...(layout.wide ? s.usageSelectionIdWide : null)}>{record.threadId}</T>
      </row>
      <Press {...s.usageTextAction} onPress={onViewAll}>
        <T {...tx(s.usageTextAction)}>{t("app.usage.viewAllThreads")}</T>
      </Press>
    </Box>
  );
}
