import { memo, useEffect, useState } from "react";
import type {
  AppSourceActionResult,
  AppSourceDraftOffer,
  AppSourceWaiting,
} from "@stella/contracts/desktop/app-source";
import { showToast } from "@/ui/toast";
import { useLocale, useT, useTPlural } from "@/shared/i18n";
import {
  agentChange,
  appSourceApi,
  runAppSourceAction,
  useAppSourceState,
  usePendingAppSourceAction,
} from "./app-source-store";
import { UpdateCard } from "./UpdateCard";

export const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

export const ago = (locale: string, date: number, now: number) => {
  const minutes = Math.round((date - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
};

export const subjectOf = (subject: string): string => {
  const inner = /^Revert "(.*)"$/.exec(subject)?.[1];
  return inner === undefined ? subject : subjectOf(inner);
};

const REMOTE_MERGE_SUBJECT = "Merge the changes from another computer";
const UPSTREAM_MERGE_SUBJECT = "Merge the published Stella update";

const reverted = (subject: string): { inner: string; depth: number } => {
  const inner = /^Revert "(.*)"$/.exec(subject)?.[1];
  if (inner === undefined) return { inner: subject, depth: 0 };
  const deeper = reverted(inner);
  return { inner: deeper.inner, depth: deeper.depth + 1 };
};

/**
 * A change in words: Stella's own merges by what they brought, and an undo as
 * an undo, so taking another computer's Undo never looks like taking the change.
 */
export const describeChange = (t: ReturnType<typeof useT>, subject: string): string => {
  const { inner, depth } = reverted(subject);
  const change = inner.startsWith(REMOTE_MERGE_SUBJECT)
    ? t("shell.appSource.updates.fromOtherComputers")
    : inner.startsWith(UPSTREAM_MERGE_SUBJECT)
      ? t("shell.appSource.updates.newVersion")
      : inner;
  return depth % 2 === 1 ? t("shell.appSource.updates.removed", { change }) : change;
};

export const useAppSourceAction = () => {
  const t = useT();
  const pending = usePendingAppSourceAction();
  const run = async (
    key: string,
    action: () => Promise<AppSourceActionResult>,
  ) => {
    const result = await runAppSourceAction(key, action);
    if (result.ok) return;
    showToast({
      title: t("shell.appSource.failed"),
      description: result.error,
      variant: "error",
    });
  };
  return { pending, run };
};

const DraftUpdateCard = ({
  draft,
  busy,
  disabled,
  placement,
  onUpdate,
}: {
  draft: AppSourceDraftOffer;
  busy: boolean;
  disabled: boolean;
  placement?: "message" | "composer";
  onUpdate: () => void;
}) => {
  const t = useT();
  const tPlural = useTPlural();
  const shape = draft.restart
    ? t("shell.appSource.restarts")
    : tPlural("shell.appSource.files", draft.files);
  return (
    <UpdateCard
      tone={draft.problem ? "attention" : "update"}
      title={draft.summary}
      detail={
        draft.problem ??
        (draft.stale ? t("shell.appSource.outdated") : `${t("shell.appSource.title")} · ${shape}`)
      }
      busy={busy}
      disabled={disabled}
      placement={placement}
      action={{
        label: t("shell.appSource.update"),
        primary: true,
        onClick: onUpdate,
      }}
    />
  );
};

export const AgentUpdateCard = memo(function AgentUpdateCard({
  agentId,
}: {
  agentId: string;
}) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const state = useAppSourceState();
  const { pending: running, run } = useAppSourceAction();
  const api = appSourceApi();
  const change = state ? agentChange(state, agentId) : null;
  if (!state || !api || !change) return null;
  const pending = running === agentId;
  const blocked =
    state.merging !== undefined || ((state.busy || running !== null) && !pending);

  if (change.kind === "merge") {
    const { offer } = change;
    return (
      <UpdateCard
        tone="update"
        title={
          offer.kind === "version"
            ? t("shell.appSource.updates.newVersion")
            : offer.device
              ? t("shell.appSource.updates.fromDevice", { device: deviceLabel(offer.device) })
              : t("shell.appSource.updates.fromOtherComputer")
        }
        detail={t("shell.appSource.updating")}
        busy={pending || offer.adding}
        disabled={blocked && !offer.adding}
        action={{
          label: t("shell.appSource.update"),
          primary: true,
          onClick: () => void run(agentId, () => addOffer(offer)),
        }}
      />
    );
  }

  if (change.kind === "draft") {
    const { offer } = change;
    return (
      <DraftUpdateCard
        draft={offer}
        busy={pending || offer.adding}
        disabled={blocked && !offer.adding}
        onUpdate={() => void run(agentId, () => api.apply(offer.name))}
      />
    );
  }

  const { commit } = change;
  const subject =
    commit.kind === "version"
      ? t("shell.appSource.updates.newVersion")
      : commit.kind === "other-computer"
        ? t("shell.appSource.updates.fromOtherComputers")
        : subjectOf(commit.subject);
  const recent = now - commit.date < 60_000;
  const when = ago(locale, commit.date, now);
  return (
    <UpdateCard
      tone={commit.undone ? "update" : "done"}
      title={subject}
      detail={
        commit.undone
          ? recent
            ? t("shell.appSource.undoneJustNow")
            : t("shell.appSource.undoneAgo", { ago: when })
          : recent
            ? t("shell.appSource.updatedJustNow")
            : t("shell.appSource.updatedAgo", { ago: when })
      }
      busy={pending}
      disabled={blocked}
      action={{
        label: commit.undone ? t("shell.appSource.update") : t("shell.appSource.undo"),
        primary: commit.undone,
        onClick: () => void run(agentId, () => api.undo(commit.sha)),
      }}
    />
  );
});

export const deviceLabel = (device: string) =>
  device.replace(/\.(local|localdomain|lan|home)$/i, "").replace(/[-_]+/g, " ").trim();

/** `targets`: for a new version, the other computers it goes to as well (default: every one). */
export const addOffer = (offer: AppSourceWaiting, targets: string[] | null = null) => {
  const api = appSourceApi();
  if (!api) return Promise.resolve<AppSourceActionResult>({ ok: false, error: "" });
  if (offer.kind === "version") {
    return offer.draft ? api.apply(offer.draft) : api.applyUpstream(targets);
  }
  if (offer.kind === "other-computer") {
    return offer.draft ? api.apply(offer.draft) : api.applyRemote();
  }
  return api.apply(offer.name);
};
