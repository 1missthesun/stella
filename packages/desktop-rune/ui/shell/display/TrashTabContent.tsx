import { useCallback, useEffect, useMemo, useState } from "react";
import { useT, useTPlural } from "@/shared/i18n";
import { EmptyState } from "../../kit";
import { Button } from "../../kit/compat";
import { font, look, mixOklch, useTokens } from "../../theme";

type TrashRecord = {
  id: string;
  source: string;
  originalPath: string;
  trashPath: string;
  trashedAt: number;
  purgeAfter: number;
  requestId?: string;
  agentType?: string;
  conversationId?: string;
};

type TrashListResult = { items: TrashRecord[]; errors: string[] };

const formatRelative = (ms: number): string => {
  const abs = Math.abs(ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) return `${Math.round(abs / minute)}m`;
  if (abs < day) return `${Math.round(abs / hour)}h`;
  return `${Math.round(abs / day)}d`;
};

const basenameOf = (filePath: string): string => filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;

const dirnameOf = (filePath: string): string => {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
};

function TrashErrors({ errors }: { errors: string[] }) {
  const t = useTokens();
  if (errors.length === 0) return null;
  return (
    <col id="trash-tab-errors" shrink={false} gap={4} px={12} py={10} radius={8} fill={mixOklch(t.c.foreground, 4, "transparent")}>
      {errors.map((line, index) => (
        <text key={index} {...look(12, 400)} color={mixOklch(t.c.foreground, 55, t.c.destructive)}>
          {line}
        </text>
      ))}
    </col>
  );
}

/** desktop-ui's `.trash-tab`: what Stella moved to its trash, with delete now and empty trash. */
export const TrashTabContent = () => {
  const t = useT();
  const tPlural = useTPlural();
  const tk = useTokens();
  const [items, setItems] = useState<TrashRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.display?.listTrash;
    if (!api) {
      setLoading(false);
      setErrors(["Trash is unavailable in this build."]);
      return;
    }
    try {
      const result = (await api()) as TrashListResult | null;
      setItems(result?.items ?? []);
      setErrors(result?.errors ?? []);
    } catch (error) {
      setErrors([(error as Error).message]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const handleForceDelete = useCallback(
    async (id: string) => {
      const api = window.electronAPI?.display?.forceDeleteTrash;
      if (!api) return;
      setBusyId(id);
      try {
        await api({ id });
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const handleEmptyAll = useCallback(async () => {
    const api = window.electronAPI?.display?.forceDeleteTrash;
    if (!api || items.length === 0) return;
    setEmptying(true);
    try {
      await api({ all: true });
      await refresh();
    } finally {
      setEmptying(false);
    }
  }, [items.length, refresh]);

  const sorted = useMemo(() => [...items].sort((a, b) => b.trashedAt - a.trashedAt), [items]);

  if (sorted.length === 0 && !loading) {
    return (
      <col id="trash-tab" h="full" gap={18} pt={22} px={18} pb={28} justify="center" scrollY>
        <EmptyState motif="trash" title={t("shell.display.trash.emptyTitle")} body={t("shell.display.trash.emptyBody")} />
        <TrashErrors errors={errors} />
      </col>
    );
  }

  const subtitle = sorted.length === 0 ? t("common.loading") : tPlural("shell.display.trash.itemsAutoDeleted", sorted.length);
  const rowRule = mixOklch(tk.c.foreground, 6, "transparent");

  return (
    <col id="trash-tab" h="full" gap={18} pt={22} px={18} pb={28} scrollY>
      <row id="trash-tab-header" shrink={false} align="start" justify="between" gap={12}>
        <col minW={0}>
          <text role="heading" {...look(15, 600, { em: -0.01 })} color={tk.c.textStrong}>
            {t("shell.display.trash.title")}
          </text>
          <text {...look(12, 400, { lh: 1.4 })} pt={4} color={tk.c.textWeak}>
            {subtitle}
          </text>
        </col>
        <row shrink={false} gap={6}>
          <Button className="pill-btn" disabled={loading || emptying} onClick={() => void refresh()}>
            {t("shell.display.trash.refresh")}
          </Button>
          <Button className="pill-btn pill-btn--danger" disabled={sorted.length === 0 || emptying} onClick={() => void handleEmptyAll()}>
            {emptying ? t("shell.display.trash.emptying") : t("shell.display.trash.emptyTrash")}
          </Button>
        </row>
      </row>

      <TrashErrors errors={errors} />

      {sorted.length > 0 ? (
        <col role="list" shrink={false}>
          {sorted.map((item, index) => {
            const remaining = item.purgeAfter - now;
            const folder = dirnameOf(item.originalPath);
            return (
              <row key={item.id} role="listitem" align="center" gap={12} py={12} border={index < sorted.length - 1 ? rowRule : undefined} borderSides={[0, 0, 1, 0]}>
                <col grow={1} minW={0} gap={2}>
                  <text {...look(13, 500, { em: -0.005 })} color={tk.c.textStrong} nowrap truncate title={item.originalPath}>
                    {basenameOf(item.originalPath)}
                  </text>
                  {folder ? (
                    <text size={12} family={font.mono} color={tk.c.textWeak} nowrap truncate title={item.originalPath}>
                      {folder}
                    </text>
                  ) : null}
                  <row pt={4} gap={12} wrap>
                    <text {...look(12, 400)} color={tk.c.textBase}>
                      {t("shell.display.trash.trashedAgo", { time: formatRelative(now - item.trashedAt) })}
                    </text>
                    <text {...look(12, 400)} color={tk.c.textBase}>
                      {remaining <= 0 ? t("shell.display.trash.pendingPurge") : t("shell.display.trash.autoDeletesIn", { time: formatRelative(remaining) })}
                    </text>
                  </row>
                </col>
                <row shrink={false}>
                  <Button className="pill-btn pill-btn--danger" disabled={busyId === item.id} onClick={() => void handleForceDelete(item.id)}>
                    {busyId === item.id ? t("shell.display.trash.deleting") : t("shell.display.trash.deleteNow")}
                  </Button>
                </row>
              </row>
            );
          })}
        </col>
      ) : null}
    </col>
  );
};
