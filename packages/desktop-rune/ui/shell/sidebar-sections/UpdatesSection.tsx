import type { ReactNode } from "react";
import type { AppSourceCommit, AppSourceWaiting } from "@stella/contracts/desktop/app-source";
import { useLocale, useT } from "@/shared/i18n";
import { appSourceApi, useAppSourceState } from "@/features/app-source/app-source-store";
import { addOffer, ago, describeChange, deviceLabel, useAppSourceAction, useNow } from "@/features/app-source/AppSourceCards";
import { EmptyState, Icon, Icons } from "../../kit";
import { fontSize, look, mixOklch, useTokens } from "../../theme";

const SMALL = look(fontSize.sm, 400);
const XS = look(12, 400);

/** `.updates-section__button` (and its `[data-primary]` form). */
function UpdateButton({ id, label, primary = false, disabled, onPress }: { id: string; label: string; primary?: boolean; disabled: boolean; onPress: () => void }) {
  const t = useTokens();
  return (
    <box
      id={id}
      role="button"
      label={label}
      focusable={!disabled}
      disabled={disabled}
      h={28}
      px={12}
      radius={999}
      center
      border={primary ? undefined : t.c.border}
      fill={primary ? t.c.primary : undefined}
      hover={disabled ? undefined : primary ? mixOklch(t.c.primary, 88, t.c.foreground) : mixOklch(t.c.foreground, 6, "transparent")}
      hoverColor={disabled || primary ? undefined : t.c.textStrong}
      opacity={disabled ? 0.5 : 1}
      motion={{ dur: 0.12 }}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 999 }}
      onPress={disabled ? undefined : onPress}
    >
      <text {...SMALL} color={primary ? t.c.primaryForeground : t.c.textBase} nowrap>
        {label}
      </text>
    </box>
  );
}

function Status({ children }: { children: string }) {
  const t = useTokens();
  return (
    <text {...SMALL} color={t.c.textWeak} nowrap>
      {children}
    </text>
  );
}

/** `.updates-section__item`: a title and detail, then its actions. */
function Item({ id, title, titleTooltip, detail, detailTooltip, bordered = false, quietTitle = false, actions }: { id: string; title: string; titleTooltip?: string; detail?: string; detailTooltip?: string; bordered?: boolean; quietTitle?: boolean; actions?: ReactNode }) {
  const t = useTokens();
  return (
    <row id={id} role="listitem" align="center" gap={12} minH={44} pt={8} pb={8} pl={10} pr={6} mb={bordered ? 6 : 0} radius={12} border={bordered ? t.c.border : undefined} hover={mixOklch(t.c.foreground, 4, "transparent")} motion={{ dur: 0.12 }}>
      <col grow={1} minW={0}>
        <text {...look(fontSize.sm, quietTitle ? 400 : 500)} color={quietTitle ? t.c.textBase : t.c.textStrong} nowrap truncate title={titleTooltip}>
          {title}
        </text>
        {detail ? (
          <text {...XS} pt={1} color={t.c.textWeak} nowrap truncate title={detailTooltip}>
            {detail}
          </text>
        ) : null}
      </col>
      {actions ? (
        <row shrink={false} align="center" gap={6}>
          {actions}
        </row>
      ) : null}
    </row>
  );
}

function WaitingItem({ offer, pending, blocked, bordered, quiet, onAdd, onSkip }: { offer: AppSourceWaiting; pending: boolean; blocked: boolean; bordered: boolean; quiet: boolean; onAdd: () => void; onSkip?: () => void }) {
  const t = useT();
  const title =
    offer.kind === "version"
      ? t("shell.appSource.updates.newVersion")
      : offer.kind === "other-computer"
        ? offer.device
          ? t("shell.appSource.updates.fromDevice", { device: deviceLabel(offer.device) })
          : t("shell.appSource.updates.fromOtherComputer")
        : t("shell.appSource.updates.readyChange");
  const detail = offer.kind === "version" ? t("shell.appSource.updates.newVersionDetail") : describeChange(t, offer.summary);
  const adding = offer.adding || pending;
  const addLabel = offer.kind === "version" ? t("shell.appSource.update") : offer.kind === "other-computer" ? t("shell.appSource.updates.get") : t("shell.appSource.updates.add");
  return (
    <Item
      id={`updates-item-${offer.key}`}
      title={title}
      detail={detail || undefined}
      detailTooltip={detail || undefined}
      bordered={bordered}
      quietTitle={quiet}
      actions={
        adding ? (
          <Status>{t("shell.appSource.updates.adding")}</Status>
        ) : (
          <>
            {onSkip ? <UpdateButton id={`updates-skip-${offer.key}`} label={t("shell.appSource.updates.skip")} disabled={blocked} onPress={onSkip} /> : null}
            <UpdateButton id={`updates-add-${offer.key}`} label={addLabel} primary={Boolean(onSkip)} disabled={blocked} onPress={onAdd} />
          </>
        )
      }
    />
  );
}

function HistoryItem({ commit, now, pending, blocked, onUndo }: { commit: AppSourceCommit; now: number; pending: boolean; blocked: boolean; onUndo: (() => void) | null }) {
  const t = useT();
  const locale = useLocale();
  const title = commit.kind === "version" ? t("shell.appSource.updates.newVersion") : commit.kind === "other-computer" ? t("shell.appSource.updates.fromOtherComputers") : describeChange(t, commit.subject);
  const when = now - commit.date < 60_000 ? t("shell.appSource.updates.justNow") : ago(locale, commit.date, now);
  return (
    <Item
      id={`updates-history-${commit.sha}`}
      title={title}
      titleTooltip={title}
      detail={when}
      actions={commit.kind === "version" || !onUndo ? undefined : pending ? <Status>{t("shell.appSource.updates.undoing")}</Status> : <UpdateButton id={`updates-undo-${commit.sha}`} label={t("shell.appSource.undo")} disabled={blocked} onPress={onUndo} />}
    />
  );
}

function Heading({ children, first = false }: { children: string; first?: boolean }) {
  const t = useTokens();
  return (
    <text role="heading" {...look(12, 500, { em: 0.02 })} mt={first ? 0 : 10} mb={4} mx={4} color={t.c.textWeak}>
      {children}
    </text>
  );
}

function Note({ id, children }: { id: string; children: string }) {
  const t = useTokens();
  return (
    <text id={id} {...look(fontSize.sm, 400, { lh: 1.45 })} pt={4} px={10} pb={10} color={t.c.textWeak}>
      {children}
    </text>
  );
}

/** desktop-ui's `UpdatesSection`: offers waiting to be added, skipped ones, and the history with Undo. */
export function UpdatesSection() {
  const t = useT();
  const tk = useTokens();
  const now = useNow();
  const state = useAppSourceState();
  const api = appSourceApi();
  const { pending, run } = useAppSourceAction();
  if (!state || !api || (state.waiting.length === 0 && state.skipped.length === 0 && state.recent.length === 0)) {
    return <EmptyState motif="updates" title={t("shell.appSource.updates.upToDateTitle")} body={t("shell.appSource.updates.upToDateBody")} />;
  }
  const blocked = state.busy || pending !== null || state.merging !== undefined;
  return (
    <col id="updates-section" grow={1} minH={0} scrollY gap={4} pt={14} px={14} pb={20}>
      {state.developerCheckout ? (
        <Note id="updates-developer-checkout">{t("shell.appSource.updates.developerCheckout")}</Note>
      ) : (
        <>
          <Heading first>{t("shell.appSource.updates.waiting")}</Heading>
          {state.waiting.length === 0 ? (
            <row align="center" gap={8} pad={10}>
              <Icon icon={Icons.stella.Check} size={14} strokeWidth={2} color={tk.c.textWeak} />
              <text {...SMALL} color={tk.c.textWeak}>
                {t("shell.appSource.updates.upToDate")}
              </text>
            </row>
          ) : (
            <col id="updates-waiting" role="list" gap={2}>
              {state.waiting.map((offer) => (
                <WaitingItem key={offer.key} offer={offer} pending={pending === offer.key} blocked={blocked} bordered quiet={false} onAdd={() => void run(offer.key, () => addOffer(offer))} onSkip={() => void run(`skip:${offer.key}`, () => api.skip(offer.key))} />
              ))}
            </col>
          )}
        </>
      )}
      {state.skipped.length > 0 ? (
        <>
          <Heading>{t("shell.appSource.updates.skipped")}</Heading>
          <col id="updates-skipped" role="list" gap={2}>
            {state.skipped.map((offer) => (
              <WaitingItem key={offer.key} offer={offer} pending={pending === offer.key} blocked={blocked} bordered={false} quiet onAdd={() => void run(offer.key, () => addOffer(offer))} />
            ))}
          </col>
        </>
      ) : null}
      {state.notShared ? <Note id="updates-not-shared">{state.notShared === "conflict" ? t("shell.appSource.updates.notSharedConflict") : t("shell.appSource.updates.notSharedBuild")}</Note> : null}
      {state.recent.length > 0 ? (
        <>
          <Heading>{t("shell.appSource.updates.history")}</Heading>
          <col id="updates-history" role="list" gap={2}>
            {state.recent.map((commit) => (
              <HistoryItem key={commit.sha} commit={commit} now={now} pending={pending === `undo:${commit.sha}`} blocked={blocked} onUndo={!state.developerCheckout ? () => void run(`undo:${commit.sha}`, () => api.undo(commit.sha)) : null} />
            ))}
          </col>
        </>
      ) : null}
    </col>
  );
}
