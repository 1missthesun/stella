import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import { EngineAccountSection } from "./EngineAccountsSettings";
import {
  BrainSection,
  EngineAccountRow,
  ThinkingRow,
  accountsEngine,
} from "./chat-settings/BrainSection";
import { Hairline, KIT, SectionLabel } from "./chat-settings/kit";
import { PlaceSwitcher } from "./chat-settings/PlaceSwitcher";
import { ProviderMark } from "./chat-settings/ProviderMark";
import { BrainPage, ProvidersPage } from "./chat-settings/ProviderPages";
import { DrawerScrollView } from "./sidebar/DrawerStage";
import { PanelPageHeader } from "./sidebar/PanelPageHeader";
import { Rise } from "./sidebar/SidebarNav";
import {
  SIDEBAR_BRAND_ROW,
  SIDEBAR_BRAND_TOP,
  SidebarTopFade,
} from "./sidebar/SidebarPanel";
import { authClient } from "../lib/auth-client";
import { useDrawerOpen, useDrawerSide } from "../lib/drawer";
import { tapLight } from "../lib/haptics";
import { useComputerControl } from "../lib/main-shell-store";
import { takeChatSettingsBrainRequest } from "../lib/connect-plan";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { useT } from "../i18n";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";

type Route =
  | { name: "home" }
  | { name: "providers" }
  | { name: "accounts" }
  | { name: "brain"; id: string; from: "home" | "providers" };

export function ChatSettingsPanel({ width }: { width: number }) {
  const colors = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const session = authClient.useSession();
  const computer = useComputerControl();
  const open = useDrawerOpen();
  const active = useDrawerSide() === "end" && open;
  const signedIn = Boolean(session.data?.user);
  const showDestinations = computer !== null || signedIn;
  const contentWidth = width - KIT.gutter * 2;
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [forward, setForward] = useState(true);

  useEffect(() => {
    if (active) return;
    const timer = setTimeout(() => setRoute({ name: "home" }), 350);
    return () => clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const requested = takeChatSettingsBrainRequest();
    if (requested) {
      setForward(true);
      setRoute({ name: "brain", id: requested, from: "home" });
    }
  }, [active]);

  const go = (next: Route, ahead = true) => {
    setForward(ahead);
    setRoute(next);
  };
  const back = () => {
    tapLight();
    if (route.name === "brain" && route.from === "providers") {
      go({ name: "providers" }, false);
    } else {
      go({ name: "home" }, false);
    }
  };

  const settings = computer?.model?.settings;
  const accountsFor = settings ? accountsEngine(settings) : null;
  const title = t("mobile.nav.chatSettingsLabel");
  let i = 0;

  const page =
    route.name === "home" ||
    !settings ||
    (route.name === "accounts" && !accountsFor) ? (
      <>
        <Rise i={i++}>
          <View style={styles.titleRow}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              {title}
            </Text>
          </View>
        </Rise>

        {showDestinations ? (
          <Rise i={i++}>
            <View style={styles.firstSection} />
            <SectionLabel>
              {t("mobile.settings.computer.sectionLabel")}
            </SectionLabel>
            <PlaceSwitcher
              control={computer}
              signedIn={signedIn}
              open={active}
              width={contentWidth}
            />
          </Rise>
        ) : null}

        {settings ? (
          <>
            <Rise i={i++}>
              <Hairline space={14} />
              <BrainSection
                settings={settings}
                active={active}
                width={contentWidth}
                onOpenProviders={() => go({ name: "providers" })}
                onOpenBrain={(id) => go({ name: "brain", id, from: "home" })}
              />
            </Rise>

            {settings.supportsEffortSelection ? (
              <Rise i={i++}>
                <Hairline space={14} />
                <ThinkingRow settings={settings} />
              </Rise>
            ) : null}

            {accountsFor ? (
              <Rise i={i++}>
                <Hairline space={14} />
                <EngineAccountRow
                  provider={accountsFor}
                  onPress={() => go({ name: "accounts" })}
                />
              </Rise>
            ) : null}
          </>
        ) : null}
      </>
    ) : (
      <>
        <PanelPageHeader
          back={
            route.name === "brain" && route.from === "providers"
              ? "Providers"
              : title
          }
          onBack={back}
          title={
            route.name === "providers"
              ? "Providers"
              : route.name === "accounts"
                ? "Accounts"
                : (settings.brains.find((brain) => brain.id === route.id)
                    ?.label ?? "")
          }
          mark={
            route.name === "brain"
              ? settings.brains.find((brain) => brain.id === route.id)?.mark
              : route.name === "accounts"
                ? (accountsFor ?? undefined)
                : undefined
          }
        />
        {route.name === "providers" ? (
          <ProvidersPage
            settings={settings}
            onOpenBrain={(id) => go({ name: "brain", id, from: "providers" })}
          />
        ) : route.name === "accounts" ? (
          accountsFor ? (
            <EngineAccountSection provider={accountsFor} embedded="panel" />
          ) : null
        ) : (
          <BrainPage settings={settings} brainId={route.id} />
        )}
      </>
    );

  const key = route.name === "brain" ? `brain:${route.id}` : route.name;

  return (
    <View style={[styles.root, { width }]}>
      <Animated.View
        key={key}
        style={styles.page}
        entering={
          route.name === "home" && forward
            ? undefined
            : (forward ? FadeInRight : FadeInLeft).duration(240)
        }
        exiting={FadeOut.duration(120)}
      >
        <DrawerScrollView
          contentContainerStyle={[
            styles.content,
            route.name !== "home" && styles.contentTop,
            {
              paddingBottom: insets.bottom + 24,
              paddingTop: insets.top + SIDEBAR_BRAND_TOP,
            },
          ]}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          {page}
        </DrawerScrollView>
      </Animated.View>
      <SidebarTopFade />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {
      backgroundColor: colors.background,
      flex: 1,
    },
    page: {
      flex: 1,
    },
    content: {
      minHeight: "100%",
      paddingHorizontal: KIT.gutter,
    },
    firstSection: {
      height: 24,
    },
    contentTop: {
      minHeight: undefined,
    },
    titleRow: {
      height: SIDEBAR_BRAND_ROW,
      justifyContent: "center",
    },
    title: {
      color: colors.text,
      fontFamily: fonts.display.semiBold,
      fontSize: 27,
      letterSpacing: -0.6,
    },
  });
