import { memo, useEffect, useState } from "react";
import type {
  AppSourceActionResult,
  AppSourceDraftOffer,
  AppSourceWaiting,
} from "@stella/contracts/desktop/app-source";
import { showToast } from "@/ui/toast";
import { Download } from "@/ui/icons";
import { useLocale, useT, useTPlural } from "@/shared/i18n";
import {
  agentChange,
  appSourceApi,
  runAppSourceAction,
  useAppSourceState,
  usePendingAppSourceAction,
  useRelayedAgents,
} from "./app-source-store";
import { UpdateCard } from "./UpdateCard";
import "./app-update-message.css";
import "@/features/schedule/schedule-card.css";

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
  const subject = subjectOf(commit.subject);
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
  device.replace(/[-_]+/g, " ").trim();

export const addOffer = (offer: AppSourceWaiting) => {
  const api = appSourceApi();
  if (!api) return Promise.resolve<AppSourceActionResult>({ ok: false, error: "" });
  if (offer.kind === "version") {
    return offer.draft ? api.apply(offer.draft) : api.applyUpstream();
  }
  if (offer.kind === "other-computer") {
    return offer.draft ? api.apply(offer.draft) : api.applyRemote();
  }
  return api.apply(offer.name);
};

export const AppSourceOffers = memo(function AppSourceOffers({
  conversationId,
  placement = "message",
}: {
  conversationId: string | null;
  placement?: "message" | "composer";
}) {
  const t = useT();
  const state = useAppSourceState();
  const relayed = useRelayedAgents(conversationId);
  const { pending, run } = useAppSourceAction();
  if (!state || !appSourceApi()) return null;
  const merging = state.merging !== undefined;
  const offers = state.waiting.filter(
    (offer): offer is Exclude<AppSourceWaiting, { kind: "version" }> =>
      offer.kind !== "version" &&
      (!merging || offer.adding) &&
      !(offer.kind === "draft" && offer.agentId && relayed.has(offer.agentId)),
  );
  if (offers.length === 0) return null;
  const blocked = state.busy || pending !== null || merging;
  return (
    <div className="app-update-messages" data-testid="app-source-offers">
      {offers.map((offer) => {
        const adding = offer.adding || pending === offer.key;
        if (offer.kind === "draft") {
          const card = (
            <DraftUpdateCard
              key={offer.name}
              draft={offer}
              busy={adding}
              disabled={blocked && !adding}
              placement={placement}
              onUpdate={() => void run(offer.key, () => addOffer(offer))}
            />
          );
          return placement === "composer" ? (
            card
          ) : (
            <div key={offer.name} className="event-row event-row--assistant">
              <div className="event-item assistant">{card}</div>
            </div>
          );
        }
        return (
          <div key={offer.key} className="event-row event-row--assistant">
            <div className="event-item assistant">
              <div className="schedule-card schedule-card--wrap app-update-message">
                <span className="schedule-card__tile" aria-hidden="true">
                  <Download size={16} strokeWidth={1.9} />
                </span>
                <span className="schedule-card__body">
                  <span className="schedule-card__headline">
                    {offer.device
                      ? t("shell.appSource.updates.fromDevice", {
                          device: deviceLabel(offer.device),
                        })
                      : t("shell.appSource.updates.fromOtherComputer")}
                  </span>
                  <span className="schedule-card__meta">
                    <span className="schedule-card__status">{subjectOf(offer.summary)}</span>
                    <span className="schedule-card__actions">
                      <button
                        type="button"
                        className="schedule-card__button schedule-card__button--primary"
                        disabled={adding || blocked}
                        onClick={() => void run(offer.key, () => addOffer(offer))}
                      >
                        {adding
                          ? t("shell.appSource.updates.adding")
                          : t("shell.appSource.updates.get")}
                      </button>
                    </span>
                  </span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
