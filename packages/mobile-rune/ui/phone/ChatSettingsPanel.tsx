import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useT } from "@/shared/i18n";
import { useComputerMode } from "../computer/computer-mode";
import type { PhoneInsets } from "./insets";
import { BRAND_TOP, DrawerTitle, GUTTER, Hairline, PanelPageHeader, SectionLabel } from "./rn";
import { accountsEngine, BrainSection, EngineAccountRow, ThinkingRow } from "./chat-settings/BrainSection";
import { EngineAccountSection } from "./chat-settings/EngineAccounts";
import { Rise, tapLight } from "./chat-settings/kit";
import { PlaceSwitcher } from "./chat-settings/PlaceSwitcher";
import { ProviderMark } from "./chat-settings/ProviderMark";
import { BrainPage, ProvidersPage } from "./chat-settings/ProviderPages";
import { useModelSettings } from "./chat-settings/use-model-settings";

// packages/mobile's ChatSettingsPanel, the drawer at the end: "Chat settings", where Stella works,
// the model (its brain and models), Thinking, and the engine's account, with the Providers,
// Accounts and one-brain pages behind them.

type Route = { name: "home" } | { name: "providers" } | { name: "accounts" } | { name: "brain"; id: string; from: "home" | "providers" };

const RESET_AFTER_CLOSE_MS = 350;

export function ChatSettingsPanel({ showing, open, width, insets }: { showing: boolean; open: boolean; width: number; insets: PhoneInsets }) {
  const shown = useRef(false);
  if (showing) shown.current = true;
  return shown.current ? <Panel open={open} width={width} insets={insets} /> : null;
}

function Panel({ open, width, insets }: { open: boolean; width: number; insets: PhoneInsets }) {
  const t = useT();
  const { hasConnectedAccount, cacheScope, identityRevision } = useAuthSessionState();
  const usingComputer = useComputerMode() !== null;
  const scope = hasConnectedAccount && !usingComputer ? `${cacheScope}:${identityRevision ?? 0}` : null;
  const modelSettings = useModelSettings(scope);
  const settings = scope ? modelSettings : null;
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [forward, setForward] = useState(true);
  const firstMount = useRef(true);
  useEffect(() => {
    firstMount.current = false;
  }, []);

  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setRoute({ name: "home" }), RESET_AFTER_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  const go = (next: Route, ahead = true) => {
    setForward(ahead);
    setRoute(next);
  };
  const back = () => {
    tapLight();
    if (route.name === "brain" && route.from === "providers") go({ name: "providers" }, false);
    else go({ name: "home" }, false);
  };

  const accountsFor = settings ? accountsEngine(settings) : null;
  const title = t("mobile.nav.chatSettingsLabel");
  const home = route.name === "home" || !settings || (route.name === "accounts" && !accountsFor);
  let i = 0;
  const rise = (children: ReactNode) => (
    <Rise key={i} i={i++} open={open} fromClosed={firstMount.current}>
      {children}
    </Rise>
  );

  let page: ReactNode;
  if (home || !settings) {
    page = (
      <>
        {rise(<DrawerTitle>{title}</DrawerTitle>)}
        {rise(
          <>
            <box h={24} />
            <SectionLabel>{t("mobile.settings.computer.sectionLabel")}</SectionLabel>
            <PlaceSwitcher />
          </>,
        )}
        {settings ? (
          <>
            {rise(
              <>
                <Hairline space={14} />
                <BrainSection settings={settings} active={open} onOpenProviders={() => go({ name: "providers" })} onOpenBrain={(id) => go({ name: "brain", id, from: "home" })} />
              </>,
            )}
            {settings.supportsEffortSelection
              ? rise(
                  <>
                    <Hairline space={14} />
                    <ThinkingRow settings={settings} />
                  </>,
                )
              : null}
            {accountsFor
              ? rise(
                  <>
                    <Hairline space={14} />
                    <EngineAccountRow provider={accountsFor} onPress={() => go({ name: "accounts" })} />
                  </>,
                )
              : null}
          </>
        ) : null}
      </>
    );
  } else {
    const brain = route.name === "brain" ? settings.brains.find((entry) => entry.id === route.id) : undefined;
    const mark = route.name === "brain" ? brain?.mark : route.name === "accounts" ? (accountsFor ?? undefined) : undefined;
    page = (
      <>
        <PanelPageHeader
          back={route.name === "brain" && route.from === "providers" ? "Providers" : title}
          onBack={back}
          title={route.name === "providers" ? "Providers" : route.name === "accounts" ? "Accounts" : (brain?.label ?? "")}
          mark={mark ? <ProviderMark provider={mark} size={28} /> : undefined}
        />
        {route.name === "providers" ? (
          <ProvidersPage settings={settings} onOpenBrain={(id) => go({ name: "brain", id, from: "providers" })} />
        ) : route.name === "accounts" ? (
          accountsFor ? (
            <EngineAccountSection provider={accountsFor} inUse />
          ) : null
        ) : route.name === "brain" ? (
          <BrainPage settings={settings} brainId={route.id} />
        ) : null}
      </>
    );
  }

  const key = home ? "home" : route.name === "brain" ? `brain:${route.id}` : route.name;
  const slide = home && forward ? undefined : { opacity: 0, x: forward ? 25 : -25, dur: 0.24, bounce: 0 };

  return (
    <col w={width} grow={1} minH={0}>
      <col
        key={key}
        id={`phone-chat-settings-${key}`}
        absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
        scrollY
        px={GUTTER}
        pt={insets.top + BRAND_TOP}
        pb={insets.bottom + 24}
        keyboard={{ pad: [insets.bottom, 24] }}
        enter={slide}
        exit={{ opacity: 0, dur: 0.12 }}
      >
        {page}
      </col>
    </col>
  );
}
