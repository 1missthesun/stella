import { memo } from "react";
import type {
  AppSourceActionResult,
  AppSourceConflicts,
  AppSourceWaiting,
} from "@stella/contracts/desktop/app-source";
import { showToast } from "@/ui/toast";
import { useT, useTPlural } from "@/shared/i18n";
import {
  useNotificationSource,
  type NotificationInput,
} from "@/features/notifications/notification-store";
import {
  appSourceApi,
  runAppSourceAction,
  useAppSourceState,
  usePendingAppSourceAction,
  useRelayedAgents,
} from "./app-source-store";
import { addOffer, describeChange, deviceLabel, useNow } from "./AppSourceCards";

/** How long the note that a version arrived by itself stays in the bell. */
const ARRIVED_SHOWN_MS = 12 * 60 * 60_000;

type Translate = ReturnType<typeof useT>;

const conflictDetail = (t: Translate, conflicts: AppSourceConflicts) => {
  const names = conflicts.files.map((file) => file.split("/").at(-1) ?? file);
  const shown = names.slice(0, 2).join(", ");
  const files = names.length > 2 ? `${shown} +${names.length - 2}` : shown;
  const how =
    conflicts.why === "allowance"
      ? t("shell.appSource.conflicts.allowance")
      : t("shell.appSource.conflicts.unsure");
  return files ? `${files} · ${how}` : how;
};

/**
 * Changes waiting to be added (from the person's other computers, a version
 * that needs a merge, a finished change whose task isn't in this chat) and the
 * note that a version arrived by itself, as notifications in the bell. They
 * all stay in Updates too.
 */
export const AppSourceNotifications = memo(function AppSourceNotifications({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const t = useT();
  const tPlural = useTPlural();
  const now = useNow();
  const state = useAppSourceState();
  const relayed = useRelayedAgents(conversationId);
  const pending = usePendingAppSourceAction();
  const api = appSourceApi();
  const items: NotificationInput[] = [];

  const act = (key: string, action: () => Promise<AppSourceActionResult>) => async () => {
    const result = await runAppSourceAction(key, action);
    if (result.ok) return;
    showToast({ title: t("shell.appSource.failed"), description: result.error, variant: "error" });
  };

  if (state && api) {
    const merging = state.merging !== undefined;
    const blocked = state.busy || pending !== null || merging;
    const arrived = state.arrived;
    if (
      arrived &&
      now - arrived.date < ARRIVED_SHOWN_MS &&
      !state.recent.some(
        (commit) => commit.sha === arrived.sha && commit.agentId && relayed.has(commit.agentId),
      )
    ) {
      const key = `arrived:${arrived.flip}`;
      items.push({
        id: `app-source:arrived:${arrived.sha}`,
        kind: "update",
        title: t("shell.appSource.updates.newVersion"),
        detail: arrived.undone
          ? t("shell.notifications.undone")
          : arrived.from
            ? t("shell.notifications.updatedFrom", { device: deviceLabel(arrived.from) })
            : t("shell.notifications.updatedHere"),
        createdAt: arrived.date,
        busy: pending === key,
        busyLabel: arrived.undone ? t("shell.appSource.updating") : t("shell.appSource.updates.undoing"),
        actions: [
          {
            label: arrived.undone ? t("shell.appSource.update") : t("shell.appSource.undo"),
            primary: true,
            keep: true,
            disabled: blocked,
            run: act(key, () => api.undo(arrived.flip)),
          },
        ],
      });
    }

    const version = state.waiting.find(
      (offer): offer is Extract<AppSourceWaiting, { kind: "version" }> => offer.kind === "version",
    );
    if (version?.conflicts && !version.adding && !version.draft) {
      items.push({
        id: `app-source:conflicts:${version.key}`,
        kind: "update",
        title: t("shell.appSource.conflicts.title"),
        detail: conflictDetail(t, version.conflicts),
        busy: pending === version.key,
        busyLabel: t("shell.appSource.updating"),
        actions: [
          {
            label: t("shell.appSource.update"),
            primary: true,
            keep: true,
            disabled: blocked,
            run: act(version.key, () => addOffer(version)),
          },
        ],
      });
    }

    for (const offer of state.waiting) {
      if (offer.kind === "version") continue;
      if (merging && !offer.adding) continue;
      const adding = offer.adding || pending === offer.key;
      if (offer.kind === "other-computer") {
        items.push({
          id: `app-source:remote:${offer.key}`,
          kind: "device-change",
          title: offer.device
            ? t("shell.appSource.updates.fromDevice", { device: deviceLabel(offer.device) })
            : t("shell.appSource.updates.fromOtherComputer"),
          detail: describeChange(t, offer.summary),
          busy: adding,
          busyLabel: t("shell.appSource.updates.adding"),
          actions: [
            {
              label: t("shell.appSource.updates.get"),
              primary: true,
              keep: true,
              disabled: blocked && !adding,
              run: act(offer.key, () => addOffer(offer)),
            },
          ],
        });
        continue;
      }
      if (offer.agentId && relayed.has(offer.agentId)) continue;
      const shape = offer.restart
        ? t("shell.appSource.restarts")
        : tPlural("shell.appSource.files", offer.files);
      items.push({
        id: `app-source:draft:${offer.name}:${offer.sha}`,
        kind: "update",
        title: offer.summary,
        detail:
          offer.problem ??
          (offer.stale ? t("shell.appSource.outdated") : `${t("shell.appSource.title")} · ${shape}`),
        toast: !offer.interfaceOnly || Boolean(offer.problem),
        busy: adding,
        busyLabel: t("shell.appSource.updating"),
        actions: [
          {
            label: t("shell.appSource.update"),
            primary: true,
            keep: true,
            disabled: blocked && !adding,
            run: act(offer.key, () => addOffer(offer)),
          },
        ],
      });
    }
  }

  useNotificationSource("app-source", items);
  return null;
});
