import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EmailBucket, EmailFeed, EmailItem, EmailRule } from "@stella/contracts/backend/email";
import { Text } from "./Text";
import { useLocale, useT, useTPlural } from "../i18n";
import { authClient } from "../lib/auth-client";
import { getBackendClient, useBackendView } from "../lib/backend";
import {
  chooseAction,
  correctEmail,
  dismissEmail,
  emailTime,
  openGmailThread,
  senderName,
  markEmailSeen,
} from "../lib/email";
import { tapLight, tapMedium } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

const LIST_PREVIEW = 6;

type Styles = ReturnType<typeof makeStyles>;

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

function ItemRow({
  item,
  now,
  showAccount,
  styles,
  colors,
}: {
  item: EmailItem;
  now: number;
  showAccount: boolean;
  styles: Styles;
  colors: Colors;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const moveTo: EmailBucket = item.bucket === "worth_knowing" ? "needs_you" : "worth_knowing";
  const open = () => {
    tapLight();
    openGmailThread(item.threadId, item.account);
  };
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action()
      .catch(() => Alert.alert(t("email.failed")))
      .finally(() => setBusy(false));
  };
  const more = () => {
    tapMedium();
    chooseAction(
      senderName(item.from),
      [
        { label: t("email.section.openInGmail") },
        {
          label:
            moveTo === "needs_you" ? t("email.section.moveToNeedsYou") : t("email.section.moveToWorthKnowing"),
        },
        { label: t("email.notImportant"), destructive: true },
      ],
      t("common.cancel"),
      (index) => {
        if (index === 0) open();
        else if (index === 1) run(() => correctEmail(item.itemId, moveTo));
        else run(() => dismissEmail(item.itemId));
      },
    );
  };
  return (
    <View style={[styles.item, busy && styles.busy]}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t("email.section.openInGmail")}
        onPress={open}
        onLongPress={more}
        style={({ pressed }) => [styles.itemOpen, pressed && styles.pressed]}
      >
        <View style={styles.itemHead}>
          <Text style={styles.from} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {senderName(item.from)}
          </Text>
          {item.bucket === "urgent" ? (
            <Text style={styles.urgent} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {t("email.section.urgent")}
            </Text>
          ) : null}
          <Text style={styles.time} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {emailTime(locale, item.receivedAt, now)}
          </Text>
        </View>
        <Text style={styles.subject} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {showAccount ? `${item.subject} · ${item.account}` : item.subject}
        </Text>
        {item.line ? (
          <Text style={styles.line} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {item.line}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("email.section.actions")}
        hitSlop={10}
        disabled={busy}
        onPress={more}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Icon name="more-horizontal" size={17} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function ItemList({
  title,
  items,
  now,
  showAccount,
  styles,
  colors,
}: {
  title: string;
  items: EmailItem[];
  now: number;
  showAccount: boolean;
  styles: Styles;
  colors: Colors;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, LIST_PREVIEW);
  return (
    <View style={styles.group}>
      <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {title}
      </Text>
      {shown.map((item, index) => (
        <View key={item.itemId} style={index > 0 ? styles.separated : undefined}>
          <ItemRow item={item} now={now} showAccount={showAccount} styles={styles} colors={colors} />
        </View>
      ))}
      {items.length > LIST_PREVIEW ? (
        <TextButton
          label={expanded ? t("email.card.showLess") : t("email.card.showAll", { count: items.length })}
          onPress={() => setExpanded((open) => !open)}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

function TextButton({
  label,
  onPress,
  disabled,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      disabled={disabled}
      onPress={() => {
        tapLight();
        onPress();
      }}
      style={({ pressed }) => [styles.textButton, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={styles.textButtonLabel} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
}

function PillButton({
  label,
  onPress,
  disabled,
  primary,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        tapLight();
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        primary && styles.pillPrimary,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text
        style={[styles.pillLabel, primary && styles.pillPrimaryLabel]}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function NoteEditor({ note, styles, colors }: { note: string; styles: Styles; colors: Colors }) {
  const t = useT();
  const [draft, setDraft] = useState(note);
  const [base, setBase] = useState(note);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (note === base) return;
    setDraft((current) => (current === base ? note : current));
    setBase(note);
  }, [base, note]);

  const dirty = draft.trim() !== note.trim();
  const save = async () => {
    setSaving(true);
    try {
      const result = await getBackendClient().call("email.setNote", { note: draft.trim() });
      setBase(result.note);
      setDraft(result.note);
      setSaved(true);
    } catch {
      Alert.alert(t("email.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.group}>
      <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {t("email.section.noteTitle")}
      </Text>
      <TextInput
        style={styles.note}
        value={draft}
        multiline
        placeholder={t("email.section.notePlaceholder")}
        placeholderTextColor={colors.textMuted}
        onChangeText={(text) => {
          setDraft(text);
          setSaved(false);
        }}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
      />
      {dirty || saved ? (
        <View style={styles.rowEnd}>
          {saved && !dirty ? (
            <Text style={styles.muted} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {t("email.section.saved")}
            </Text>
          ) : null}
          {dirty ? (
            <PillButton label={t("common.save")} primary disabled={saving} onPress={() => void save()} styles={styles} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Rules({ rules, styles }: { rules: EmailRule[]; styles: Styles }) {
  const t = useT();
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = (ruleId: string) => {
    setRemoving(ruleId);
    void getBackendClient()
      .call("email.removeRule", { ruleId })
      .catch(() => Alert.alert(t("email.failed")))
      .finally(() => setRemoving(null));
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {t("email.section.rulesTitle")}
      </Text>
      {rules.map((rule, index) => (
        <View key={rule.ruleId} style={[styles.rule, index > 0 && styles.separated]}>
          <View style={styles.ruleText}>
            <Text style={styles.body} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {rule.text}
            </Text>
            <Text style={styles.muted} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {rule.action === "act" ? t("email.section.ruleAct") : t("email.section.ruleTell")}
            </Text>
          </View>
          <TextButton
            label={t("email.section.remove")}
            disabled={removing === rule.ruleId}
            onPress={() => remove(rule.ruleId)}
            styles={styles}
          />
        </View>
      ))}
      <Text style={styles.hint} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {t("email.section.rulesHint")}
      </Text>
    </View>
  );
}

function Footer({ feed, styles }: { feed: EmailFeed; styles: Styles }) {
  const t = useT();
  const locale = useLocale();
  const [checking, setChecking] = useState(false);
  const { status } = feed;
  const usage = t("email.section.usage", {
    sorted: new Intl.NumberFormat(locale).format(status.usage.sorted),
    cost: usageCost(locale, status.usage.costUsd),
  });

  const checkNow = async () => {
    setChecking(true);
    try {
      await getBackendClient().call("email.checkNow", {});
    } catch (error) {
      Alert.alert(errorText(error, t("email.failed")));
    } finally {
      setChecking(false);
    }
  };

  const turnOff = () => {
    tapMedium();
    Alert.alert(t("email.section.turnOff"), t("email.section.turnOffConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("email.section.turnOff"),
        style: "destructive",
        onPress: () => {
          void getBackendClient()
            .call("email.setEnabled", { enabled: false })
            .catch((error: unknown) => Alert.alert(errorText(error, t("email.failed"))));
        },
      },
    ]);
  };

  return (
    <View style={styles.group}>
      <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {t("email.section.accountsTitle")}
      </Text>
      {status.accounts.map((account) => (
        <View key={account.email} style={styles.account}>
          <Text style={styles.accountEmail} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {account.email}
          </Text>
          <Text style={styles.muted} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {account.error
              ? t("email.section.accountError")
              : account.live
                ? t("email.section.live")
                : t("email.section.polled")}
          </Text>
        </View>
      ))}
      <Text style={styles.hint} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {status.usage.capped ? `${usage}. ${t("email.section.capped")}` : usage}
      </Text>
      <View style={styles.buttons}>
        <PillButton
          label={checking ? t("email.section.checking") : t("email.section.checkNow")}
          disabled={checking}
          onPress={() => void checkNow()}
          styles={styles}
        />
        <TextButton label={t("email.section.turnOff")} onPress={turnOff} styles={styles} />
      </View>
    </View>
  );
}

function SortedMail({ feed, styles, colors }: { feed: EmailFeed; styles: Styles; colors: Colors }) {
  const t = useT();
  const tPlural = useTPlural();
  const bottomInset = useSafeAreaInsets().bottom;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [feed]);
  const visible = feed.items.filter((item) => item.state !== "dismissed" && item.bucket !== "noise");
  const needsYou = [
    ...visible.filter((item) => item.bucket === "urgent"),
    ...visible.filter((item) => item.bucket === "needs_you"),
  ];
  const worthKnowing = visible.filter((item) => item.bucket === "worth_knowing");
  const showAccount = feed.status.accounts.length > 1;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="mobile-email"
    >
      {visible.length === 0 ? (
        <Text style={styles.empty} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("email.section.empty")}
        </Text>
      ) : null}
      <ItemList
        title={t("email.section.needsYou")}
        items={needsYou}
        now={now}
        showAccount={showAccount}
        styles={styles}
        colors={colors}
      />
      <ItemList
        title={t("email.section.worthKnowing")}
        items={worthKnowing}
        now={now}
        showAccount={showAccount}
        styles={styles}
        colors={colors}
      />
      {feed.noiseCount > 0 ? (
        <Text style={[styles.hint, styles.skipped]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {tPlural("email.section.skippedThisWeek", feed.noiseCount)}
        </Text>
      ) : null}
      <NoteEditor note={feed.note} styles={styles} colors={colors} />
      <Rules rules={feed.rules} styles={styles} />
      <Footer feed={feed} styles={styles} />
    </ScrollView>
  );
}

export function EmailPage() {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bottomInset = useSafeAreaInsets().bottom;
  const signedIn = Boolean(authClient.useSession().data?.user);
  const feed = useBackendView("email.feed", signedIn ? {} : "skip");
  const [waiting, setWaiting] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const value = feed.value;
  const connected = (value?.status.gmailConnected?.length ?? 0) > 0;

  useEffect(() => {
    if (connected) setWaiting(false);
  }, [connected]);

  // Looking at the page clears the unseen badge, including mail that arrives while it is open.
  useEffect(() => {
    if (value) markEmailSeen();
  }, [value]);

  const connect = useCallback(async () => {
    setConnectFailed(false);
    try {
      const { url } = await getBackendClient().call("integrations.connectLink", { id: "gmail" });
      await Linking.openURL(url);
      setWaiting(true);
    } catch {
      setConnectFailed(true);
    }
  }, []);

  const turnOn = useCallback(async () => {
    setTurningOn(true);
    setTurnOnFailed(false);
    try {
      await getBackendClient().call("email.setEnabled", { enabled: true });
    } catch {
      setTurnOnFailed(true);
    } finally {
      setTurningOn(false);
    }
  }, []);

  if (!signedIn) {
    return (
      <View style={styles.root}>
        <EmptyState motif="mail" message={t("mobile.sidebar.signedOutHint")} />
      </View>
    );
  }

  if (!value) {
    if (feed.error) {
      return (
        <View style={styles.root}>
          <EmptyState motif="mail" message={t("email.section.loadErrorBody")} />
        </View>
      );
    }
    return (
      <View style={[styles.centered, { paddingBottom: bottomInset }]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (!connected) {
    const reconnect = value.status.needsReconnect;
    return (
      <View style={styles.root}>
        <EmptyState
          motif="mail"
          message={
            connectFailed
              ? t("email.section.connectError")
              : reconnect
                ? t("email.section.reconnectBody")
                : t("email.section.connectBody")
          }
          action={{
            label: waiting
              ? t("email.section.connecting")
              : reconnect
                ? t("email.section.reconnect")
                : t("email.section.connect"),
            onPress: () => void connect(),
          }}
        />
      </View>
    );
  }

  if (!value.status.enabled) {
    return (
      <View style={styles.root}>
        <EmptyState
          motif="mail"
          message={turnOnFailed ? t("email.failed") : t("email.section.offBody")}
          action={{
            label: turningOn ? t("email.section.turningOn") : t("email.section.turnOn"),
            onPress: () => {
              if (!turningOn) void turnOn();
            },
          }}
        />
      </View>
    );
  }

  return <SortedMail feed={value} styles={styles} colors={colors} />;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, minHeight: 0 },
    content: { gap: 22, paddingTop: 8 },
    centered: { alignItems: "center", flex: 1, justifyContent: "center" },
    group: { gap: 2 },
    heading: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
      letterSpacing: 0.1,
      marginBottom: 2,
      paddingHorizontal: 2,
    },
    separated: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    item: { alignItems: "flex-start", flexDirection: "row" },
    busy: { opacity: 0.5 },
    itemOpen: { flex: 1, gap: 2, minWidth: 0, paddingHorizontal: 2, paddingVertical: 10 },
    pressed: { backgroundColor: fadeHex(colors.text, 0.06) },
    itemHead: { alignItems: "baseline", flexDirection: "row", gap: 8 },
    from: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    urgent: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
    },
    time: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      fontVariant: ["tabular-nums"],
      marginLeft: "auto",
    },
    subject: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    line: {
      color: colors.textBase,
      fontFamily: fonts.sans.regular,
      fontSize: 14.5,
      letterSpacing: -0.1,
      lineHeight: 20,
    },
    moreButton: {
      alignItems: "center",
      borderRadius: 8,
      height: 28,
      justifyContent: "center",
      marginLeft: 4,
      marginTop: 7,
      width: 28,
    },
    empty: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14.5,
      lineHeight: 20,
      paddingHorizontal: 2,
    },
    skipped: { marginTop: -14 },
    hint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 2,
    },
    muted: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    body: {
      color: colors.textBase,
      fontFamily: fonts.sans.regular,
      fontSize: 14.5,
      lineHeight: 20,
    },
    note: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
      minHeight: 84,
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlignVertical: "top",
    },
    rowEnd: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      justifyContent: "flex-end",
      marginTop: 6,
    },
    rule: { alignItems: "flex-start", flexDirection: "row", gap: 10, paddingHorizontal: 2, paddingVertical: 10 },
    ruleText: { flex: 1, gap: 2, minWidth: 0 },
    account: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
      paddingHorizontal: 2,
      paddingVertical: 6,
    },
    accountEmail: {
      color: colors.textBase,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 14.5,
    },
    buttons: { alignItems: "center", flexDirection: "row", gap: 18, marginTop: 10, paddingHorizontal: 2 },
    textButton: { paddingVertical: 2 },
    textButtonLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    dimmed: { opacity: 0.5 },
    pill: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      height: 32,
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    pillPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    pillLabel: { color: colors.text, fontFamily: fonts.sans.medium, fontSize: 13.5 },
    pillPrimaryLabel: { color: colors.accentForeground },
  });

/** A month's sorting usually costs a fraction of a cent; show that as "<$0.01", not "$0.00". */
function usageCost(locale: string, usd: number): string {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  return usd > 0 && usd < 0.01 ? `<${money.format(0.01)}` : money.format(usd);
}
