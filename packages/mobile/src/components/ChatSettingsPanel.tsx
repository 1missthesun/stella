import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import { BrainSection, ThinkingRow } from "./chat-settings/BrainSection";
import { Hairline, KIT, SectionLabel } from "./chat-settings/kit";
import { PlaceSwitcher } from "./chat-settings/PlaceSwitcher";
import { ProviderMark } from "./chat-settings/ProviderMark";
import { BrainPage, ProvidersPage } from "./chat-settings/ProviderPages";
import { DrawerScrollView } from "./sidebar/DrawerStage";
import { Rise } from "./sidebar/SidebarNav";
import {
  SIDEBAR_BRAND_ROW,
  SIDEBAR_BRAND_TOP,
  SidebarTopFade,
} from "./sidebar/SidebarPanel";
import { authClient } from "../lib/auth-client";
import { useDrawerOpen, useDrawerSide } from "../lib/drawer";
import { isGuest } from "../lib/guest-mode";
import { tapLight } from "../lib/haptics";
import { useComputerControl } from "../lib/main-shell-store";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { useT } from "../i18n";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";

type Route =
  | { name: "home" }
  | { name: "providers" }
  | { name: "brain"; id: string; from: "home" | "providers" };

/**
 * The chat's own settings, the sidebar on the right of the chat, opened by
 * swiping left or from the gear at the top right.
 *
 * Its first page is two switchers in the left sidebar's voice, sitting low
 * where a thumb reaches: where turns run, and which model runs them, with
 * that model's siblings listed under it. Everything else is a page deeper,
 * inside the sidebar: every provider, and each provider's own page to
 * connect it and pick its models, so the first page stays the same size
 * however many providers the account has.
 */
export function ChatSettingsPanel({ width }: { width: number }) {
  const colors = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const session = authClient.useSession();
  const computer = useComputerControl();
  const open = useDrawerOpen();
  const active = useDrawerSide() === "end" && open;
  const signedIn = Boolean(session.data?.user) && !isGuest();
  const showDestinations = computer !== null || signedIn;
  const contentWidth = width - KIT.gutter * 2;
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [forward, setForward] = useState(true);

  useEffect(() => {
    if (active) return;
    const timer = setTimeout(() => setRoute({ name: "home" }), 350);
    return () => clearTimeout(timer);
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
  const title = t("mobile.nav.chatSettingsLabel");
  let i = 0;

  const page =
    route.name === "home" || !settings ? (
      <>
        <Rise i={i++} animated from="end">
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
          <Rise i={i++} animated from="end">
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
            <Rise i={i++} animated from="end">
              <Hairline space={14} />
              <BrainSection
                settings={settings}
                active={active}
                width={contentWidth}
                onOpenProviders={() => go({ name: "providers" })}
                onOpenBrain={(id) => go({ name: "brain", id, from: "home" })}
              />
            </Rise>

            <View style={styles.spacer} />

            {settings.supportsEffortSelection ? (
              <Rise i={i++} animated from="end">
                <ThinkingRow settings={settings} />
              </Rise>
            ) : null}
          </>
        ) : null}
      </>
    ) : (
      <>
        <PageHeader
          back={
            route.name === "brain" && route.from === "providers"
              ? "Providers"
              : title
          }
          onBack={back}
          title={
            route.name === "providers"
              ? "Providers"
              : (settings.brains.find((brain) => brain.id === route.id)
                  ?.label ?? "")
          }
          mark={
            route.name === "brain"
              ? settings.brains.find((brain) => brain.id === route.id)?.mark
              : undefined
          }
          styles={styles}
        />
        {route.name === "providers" ? (
          <ProvidersPage
            settings={settings}
            onOpenBrain={(id) => go({ name: "brain", id, from: "providers" })}
          />
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

function PageHeader({
  back,
  onBack,
  title,
  mark,
  styles,
}: {
  back: string;
  onBack: () => void;
  title: string;
  mark?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const colors = useColors();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${back}`}
        style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
      >
        <Icon
          name="chevron-left"
          size={16}
          color={colors.textMuted}
          weight="semibold"
        />
        <Text
          style={styles.back}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {back}
        </Text>
      </Pressable>
      <View style={styles.pageTitleRow}>
        {mark ? <ProviderMark provider={mark} size={28} /> : null}
        <Text
          accessibilityRole="header"
          style={styles.pageTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {title}
        </Text>
      </View>
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
    spacer: {
      flex: 1,
      minHeight: 24,
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
    header: {
      marginBottom: 22,
    },
    backRow: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 4,
      height: SIDEBAR_BRAND_ROW,
    },
    back: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
    },
    pageTitleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      marginTop: 6,
    },
    pageTitle: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.bold,
      fontSize: 30,
      letterSpacing: -1,
      lineHeight: 38,
    },
    pressed: {
      opacity: 0.55,
    },
  });
