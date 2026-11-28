import { memo, useEffect, useState, type ReactNode } from "react";
import type { IndexedView } from "@stella/contracts/backend/view-index";
import { CloudAppsSync } from "@/features/cloud/CloudAppsSync";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import { useCloudApps, type CloudAppsState } from "@/features/cloud/use-cloud-apps";
import { useEmailFeature } from "@/features/email/email-feature";
import { useEmailUnseenCount } from "@/features/email/email-unseen";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { translateNow, useT } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { openIndexedView } from "../../../../desktop-rune/ui/apps/open-indexed-view";
import { useViewIcon } from "../../../../desktop-rune/ui/views/ViewRenderer";
import { glyph } from "../icons";
import { useStartChatWith } from "../ask";
import { Dot, GUTTER, Hairline, rt, TEXT, useRn } from "../rn";
import { topBarOverride } from "../topbar-override";
import { EmptyState } from "./EmptyState";
import { EmailPage } from "./email/EmailPage";

// packages/mobile's Apps tab (AppsPage): Email at the top in big type (it pushes the Email page),
// then the account's Stella Views and its apps as airy rows, or the orbiting empty state.

const EMAIL_TITLE = rt(28, 700, -1, 34);
const EMOJI = rt(30, 400, 0, 38);

const openView = (view: IndexedView) => {
  openIndexedView(view).catch(() => showToast(translateNow("app.apps.viewOpenFailed")));
};

const AppRow = memo(function AppRow({ id, title, glyphNode, quiet = false, error, disabled = false, onPress }: { id: string; title: string; glyphNode: ReactNode; quiet?: boolean; error?: string; disabled?: boolean; onPress: () => void }) {
  const c = useRn();
  return (
    <row id={id} role="button" label={title} focusable={!disabled} minH={66} py={9} gap={16} align="center" pressScale={0.985} onPress={disabled ? undefined : onPress}>
      <box w={36} center shrink={false}>
        {glyphNode}
      </box>
      <col grow={1} minW={0} gap={2}>
        <text {...TEXT.listTitle} color={quiet ? c.textMuted : c.text} maxLines={1}>
          {title}
        </text>
        {error ? (
          <text {...TEXT.listDetail} color={c.danger} maxLines={3}>
            {error}
          </text>
        ) : null}
      </col>
    </row>
  );
});

function ViewRow({ view }: { view: IndexedView }) {
  const c = useRn();
  const icon = useViewIcon(view.icon) ?? glyph("apps");
  return <AppRow id={`phone-view-${view.id.replace(/[^\w-]/gu, "_").slice(-60)}`} title={view.title} glyphNode={<Icon icon={icon} size={26} strokeWidth={1.75} color={c.text} />} onPress={() => openView(view)} />;
}

function EmailEntry({ onPress }: { onPress: () => void }) {
  const c = useRn();
  const t = useT();
  const unseen = useEmailUnseenCount();
  const title = t("email.title");
  return (
    <row id="phone-apps-email" role="button" label={unseen > 0 ? `${title}, ${unseen}` : title} focusable mt={10} minH={72} py={9} gap={16} align="center" pressScale={0.985} onPress={onPress}>
      <box w={36} center shrink={false}>
        <Icon icon={glyph("mail")} size={27} color={c.text} />
      </box>
      <row grow={1} minW={0} gap={10} align="center">
        <text {...EMAIL_TITLE} color={c.text} maxLines={1} shrink>
          {title}
        </text>
        {unseen > 0 ? <Dot /> : null}
      </row>
      {unseen > 0 ? (
        <text {...TEXT.listTrailing} color={c.textMuted}>
          {unseen > 99 ? "99+" : String(unseen)}
        </text>
      ) : null}
    </row>
  );
}

function AppsList({ state, views, active, bottom, onEmail }: { state: CloudAppsState; views: readonly IndexedView[] | undefined; active: boolean; bottom: number; onEmail: (() => void) | null }) {
  const c = useRn();
  const t = useT();
  const startChatWith = useStartChatWith();
  const hasViews = (views?.length ?? 0) > 0;
  const apps = state.phase === "ready" || state.apps.length > 0 ? state.apps : state.phase === "loading" ? null : [];
  const error = state.phase === "error" ? state.error : null;
  const email = onEmail ? <EmailEntry onPress={onEmail} /> : null;

  if (!state.signedIn) {
    return (
      <col grow={1} minH={0} px={GUTTER}>
        <text {...TEXT.listDetail} color={c.textMuted} pt={14}>
          {t("mobile.sidebar.signedOutHint")}
        </text>
      </col>
    );
  }
  const empty = !hasViews && views !== undefined && apps?.length === 0 && !error;
  if (empty) {
    return (
      <col grow={1} minH={0}>
        {email ? <col px={GUTTER}>{email}</col> : null}
        <EmptyState id="phone-apps-empty" motif="apps" message={t("mobile.apps.empty")} action={{ label: t("mobile.apps.emptyAction"), onPress: () => startChatWith(t("mobile.apps.emptyActionPrompt")) }} live={active} bottom={bottom} />
      </col>
    );
  }
  return (
    <col id="phone-apps-list" role="list" grow={1} minH={0} scrollY px={GUTTER} pb={bottom + 32}>
      {email}
      {email && (apps?.length || hasViews) ? <Hairline space={16} /> : <box h={8} />}
      {views?.map((view) => (
        <ViewRow key={view.id} view={view} />
      ))}
      {hasViews && apps && apps.length > 0 ? <Hairline space={16} /> : null}
      {error ? (
        <text role="alert" {...TEXT.listDetail} color={c.danger} py={12}>
          {error}
        </text>
      ) : null}
      {apps?.map((app) => (
        <AppRow
          key={app.appId}
          id={`phone-app-${app.slug}`}
          title={app.title}
          quiet={app.status !== "ready"}
          error={app.error}
          disabled={app.status !== "ready"}
          glyphNode={
            app.icon ? (
              <text {...EMOJI} maxLines={1}>
                {app.icon}
              </text>
            ) : (
              <Icon icon={glyph("apps")} size={26} color={c.text} />
            )
          }
          onPress={() => openCloudAppPanel(app)}
        />
      ))}
    </col>
  );
}

export function AppsPage({ active, bottom }: { active: boolean; bottom: number }) {
  const t = useT();
  const cloudApps = useCloudApps();
  const views = useBackendView("viewIndex.list", cloudApps.signedIn ? {} : "skip", { keepPreviousValue: true });
  const emailOn = useEmailFeature();
  const [email, setEmail] = useState(false);
  const [emailSeen, setEmailSeen] = useState(false);
  const showEmail = email && emailOn;

  // Email is a page pushed over the list: the top bar titles it and its back button returns.
  useEffect(() => {
    if (!showEmail) {
      topBarOverride.set("apps", null);
      return;
    }
    topBarOverride.set("apps", { title: t("email.title"), back: { label: t("mobile.nav.apps"), onPress: () => setEmail(false) } });
  }, [showEmail, t]);
  useEffect(() => topBarOverride.onReset("apps", () => setEmail(false)), []);
  useEffect(() => {
    if (showEmail) setEmailSeen(true);
  }, [showEmail]);

  return (
    <col w="full" grow={1} minH={0}>
      <col w="full" grow={1} minH={0} hidden={showEmail}>
        <AppsList state={cloudApps} views={views.value} active={active && !showEmail} bottom={bottom} onEmail={emailOn ? () => setEmail(true) : null} />
      </col>
      {emailSeen && emailOn ? (
        <col id="phone-email-page" absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} hidden={!showEmail} x={showEmail ? 0 : 40} opacity={showEmail ? 1 : 0} motion={{ dur: 0.3, bounce: 0 }}>
          <EmailPage active={active && showEmail} bottom={bottom} />
        </col>
      ) : null}
      <CloudAppsSync state={cloudApps} />
    </col>
  );
}
