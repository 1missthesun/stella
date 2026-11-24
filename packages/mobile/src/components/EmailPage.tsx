import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import type { EmailPageState, EmailRuleKind } from "@stella/contracts/backend/email";
import { canvasActionMessage, type CanvasActionEvent } from "@stella/contracts/canvas-actions";
import {
  EMAIL_PAGE_CANVAS,
  EMAIL_PAGE_CHECK_ACTION,
  gmailThreadUrl,
  type EmailPageItem,
  type EmailPageSection,
} from "@stella/contracts/email-page";
import { useLocale, useT } from "../i18n";
import { authClient } from "../lib/auth-client";
import { getBackendClient, useBackendView } from "../lib/backend";
import { sendToChat } from "../lib/chat-send-queue";
import { markEmailSeen } from "../lib/email";
import { tapLight } from "../lib/haptics";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors, useTheme } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { Text } from "./Text";

const SECTION_ORDER: readonly { key: EmailPageSection; title: string }[] = [
  { key: "needs_you", title: "Needs you" },
  { key: "waiting", title: "Waiting on others" },
  { key: "handled", title: "I handled" },
];

const RULE_KIND_LABEL: Record<EmailRuleKind, string> = {
  wake: "Tells you at once",
  act: "Stella acts at once",
  ignore: "Left off this page",
};

const formatWhen = (at: number | undefined, locale: string): string => {
  if (!at) return "";
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  try {
    return sameDay
      ? date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
};

const sortItems = (items: readonly EmailPageItem[], section: EmailPageSection): EmailPageItem[] =>
  items
    .filter((item) => item.section === section)
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.at - a.at);

function InlineRichText({
  text,
  baseStyle,
  strongStyle,
}: {
  text: string;
  baseStyle: object;
  strongStyle: object;
}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={baseStyle}>
      {parts.map((part, index) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <Text key={index} style={strongStyle}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </Text>
  );
}

function MobileRichText({
  text,
  styles,
}: {
  text: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const chunks = text.split(/\n{2,}/);
  return (
    <View style={styles.richText}>
      {chunks.map((chunk, chunkIndex) => {
        const lines = chunk.split("\n");
        if (lines.every((entry) => /^\s*[-•]\s+/.test(entry))) {
          return (
            <View key={chunkIndex} style={styles.bulletList}>
              {lines.map((entry, lineIndex) => (
                <View key={lineIndex} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <View style={styles.bulletBody}>
                    <InlineRichText
                      text={entry.replace(/^\s*[-•]\s+/, "")}
                      baseStyle={styles.detailText}
                      strongStyle={styles.detailStrong}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return (
          <View key={chunkIndex} style={styles.detailParagraph}>
            <InlineRichText
              text={lines.join("\n")}
              baseStyle={styles.detailText}
              strongStyle={styles.detailStrong}
            />
          </View>
        );
      })}
    </View>
  );
}

function NativeEmailView({ state }: { state: EmailPageState }) {
  const colors = useColors();
  const { isDark } = useTheme();
  const locale = useLocale();
  const bottomInset = useSafeAreaInsets().bottom;
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tellingOpen, setTellingOpen] = useState<Record<string, boolean>>({});
  const [tellDrafts, setTellDrafts] = useState<Record<string, string>>({});
  const [tellSending, setTellSending] = useState<Record<string, boolean>>({});
  const [pendingById, setPendingById] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [removingRuleId, setRemovingRuleId] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const lastReadAtRef = useRef<number | undefined>(state.page.readAt);
  const lastItemAtRef = useRef<Map<string, number>>(new Map());

  const grouped = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        ...section,
        items: sortItems(state.page.items, section.key),
      })),
    [state.page.items],
  );

  const totalItems = state.page.items.length;
  const needsYouCount = grouped[0]?.items.length ?? 0;
  const hasIgnored = state.page.ignored.count > 0;

  useEffect(() => {
    if (state.page.readAt !== lastReadAtRef.current) {
      lastReadAtRef.current = state.page.readAt;
      setChecking(false);
    }
  }, [state.page.readAt]);

  useEffect(() => {
    const prev = lastItemAtRef.current;
    const next = new Map(state.page.items.map((item) => [item.id, item.at] as const));
    if (prev.size > 0) {
      setPendingById((current) => {
        let changed = false;
        const updated = { ...current };
        for (const id of Object.keys(current)) {
          const nextAt = next.get(id);
          if (nextAt === undefined || prev.get(id) !== nextAt) {
            delete updated[id];
            changed = true;
          }
        }
        return changed ? updated : current;
      });
    }
    lastItemAtRef.current = next;
  }, [state.page.items]);

  const sendAction = useCallback(async (event: CanvasActionEvent): Promise<boolean> => {
    return sendToChat(canvasActionMessage(event));
  }, []);

  const handleCheckNow = useCallback(async () => {
    if (checking) return;
    tapLight();
    setChecking(true);
    const sent = await sendAction({
      canvas: EMAIL_PAGE_CANVAS,
      title: "Email",
      id: EMAIL_PAGE_CHECK_ACTION,
      label: "Check my email now",
    });
    if (!sent) {
      setChecking(false);
      return;
    }
    setTimeout(() => setChecking(false), 12_000);
  }, [checking, sendAction]);

  const handlePrimaryAction = useCallback(
    async (item: EmailPageItem) => {
      if (!item.action || pendingById[item.id]) return;
      tapLight();
      const prefix = item.section === "handled" ? "undo" : "do";
      setPendingById((prev) => ({ ...prev, [item.id]: "Stella's on it." }));
      const sent = await sendAction({
        canvas: EMAIL_PAGE_CANVAS,
        title: "Email",
        id: `${prefix}:${item.id}`,
        label: `${item.action}: ${item.title}`,
      });
      if (!sent) {
        setPendingById((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    },
    [pendingById, sendAction],
  );

  const handleTellSubmit = useCallback(
    async (item: EmailPageItem) => {
      const text = (tellDrafts[item.id] ?? "").trim();
      if (!text || tellSending[item.id]) return;
      tapLight();
      setTellSending((prev) => ({ ...prev, [item.id]: true }));
      const sent = await sendAction({
        canvas: EMAIL_PAGE_CANVAS,
        title: "Email",
        id: `tell:${item.id}`,
        label: `About ${item.title}`,
        fields: { text },
      });
      setTellSending((prev) => ({ ...prev, [item.id]: false }));
      if (sent) {
        setTellDrafts((prev) => ({ ...prev, [item.id]: "" }));
        setTellingOpen((prev) => ({ ...prev, [item.id]: false }));
        setPendingById((prev) => ({ ...prev, [item.id]: "Sent to Stella." }));
      }
    },
    [sendAction, tellDrafts, tellSending],
  );

  const handleRemoveRule = useCallback(async (ruleId: string) => {
    tapLight();
    setRemovingRuleId(ruleId);
    try {
      await getBackendClient().call("email.tool", { action: "rules", op: "remove", rule: ruleId });
    } finally {
      setRemovingRuleId((current) => (current === ruleId ? null : current));
    }
  }, []);

  const confirmTurnOff = useCallback(() => {
    tapLight();
    Alert.alert(
      "Turn off Email?",
      "Stella stops reading your mail and clears this page.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: () => {
            setTurningOff(true);
            void getBackendClient()
              .call("email.setEnabled", { enabled: false })
              .finally(() => setTurningOff(false));
          },
        },
      ],
    );
  }, []);

  const summaryLabel =
    needsYouCount > 0
      ? `${needsYouCount} ${needsYouCount === 1 ? "needs you" : "need you"}`
      : state.page.readAt
        ? "All caught up"
        : "Waiting for first read";
  const metaParts: string[] = [
    state.page.readAt ? `Read ${formatWhen(state.page.readAt, locale)}` : "Not read yet",
  ];
  if (state.unread > 0) metaParts.push(`${state.unread} new since`);
  if (state.accounts.length > 1) metaParts.push(`${state.accounts.length} inboxes`);

  if (settingsOpen) {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 32 }]}
        showsVerticalScrollIndicator={false}
        testID="mobile-email-settings"
      >
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Email"
            onPress={() => {
              tapLight();
              setSettingsOpen(false);
            }}
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressedSoft]}
          >
            <Icon name="chevron-left" size={16} color={colors.textStrong} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.settingsTitle}>Rules & settings</Text>
        </View>

        <View style={styles.settingsGroup}>
          <Text style={styles.sectionHeading}>Your rules</Text>
          {state.rules.length > 0 ? (
            <View style={styles.hairlineList}>
              {state.rules.map((rule) => {
                const removing = removingRuleId === rule.ruleId;
                return (
                  <View key={rule.ruleId} style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowMain}>{rule.text}</Text>
                      <Text style={styles.settingsRowSub}>{RULE_KIND_LABEL[rule.kind] ?? ""}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove rule ${rule.text}`}
                      disabled={removing}
                      onPress={() => void handleRemoveRule(rule.ruleId)}
                      style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressedSoft]}
                    >
                      <Text style={styles.ghostBtnText}>{removing ? "Removing…" : "Remove"}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Text style={styles.footnote}>
            Tell Stella what matters and what doesn't, and she keeps it here as a rule.
          </Text>
        </View>

        <View style={styles.settingsGroup}>
          <Text style={styles.sectionHeading}>Inboxes</Text>
          <View style={styles.hairlineList}>
            {state.accounts.map((account) => (
              <View key={account} style={styles.settingsRow}>
                <View style={styles.accountRow}>
                  <Icon name="mail" size={14} color={colors.textWeaker} />
                  <Text style={styles.settingsRowMain} numberOfLines={1}>
                    {account}
                  </Text>
                </View>
                <Text style={styles.settingsRowValue}>Reading</Text>
              </View>
            ))}
            {state.nextReadAt ? (
              <View style={styles.settingsRow}>
                <View style={styles.settingsRowCopy}>
                  <Text style={styles.settingsRowMain}>Next automatic check</Text>
                  <Text style={styles.settingsRowSub}>
                    Urgent mail wakes Stella between scheduled reads.
                  </Text>
                </View>
                <Text style={styles.settingsRowValue}>{formatWhen(state.nextReadAt, locale)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.settingsGroup}>
          <Text style={styles.sectionHeading}>Automation</Text>
          <View style={styles.hairlineList}>
            <View style={styles.settingsRow}>
              <View style={styles.settingsRowCopy}>
                <Text style={styles.settingsRowMain}>Turn off Email</Text>
                <Text style={styles.settingsRowSub}>
                  Stops automatic reads and clears this page.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Turn off Email"
                disabled={turningOff}
                onPress={confirmTurnOff}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressedSoft]}
              >
                <Text style={styles.dangerBtnText}>{turningOff ? "Turning off…" : "Turn off"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 36 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="mobile-email"
      >
        <View style={styles.topBar}>
          <View style={styles.topSummary}>
            <Text style={styles.topCount}>{summaryLabel}</Text>
            <Text style={styles.topMeta} numberOfLines={1}>
              {metaParts.join(" · ")}
            </Text>
          </View>
          <View style={styles.topActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Check email now"
              disabled={checking}
              onPress={() => void handleCheckNow()}
              style={({ pressed }) => [
                styles.headerIconBtn,
                pressed && styles.pressedSoft,
                checking && styles.disabled,
              ]}
            >
              <Icon name="refresh-cw" size={14} color={colors.textMuted} />
              <Text style={styles.headerBtnText}>{checking ? "Checking" : "Check"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rules and settings"
              onPress={() => {
                tapLight();
                setSettingsOpen(true);
              }}
              style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressedSoft]}
            >
              <Icon name="settings" size={14} color={colors.textMuted} />
              {state.rules.length > 0 ? (
                <Text style={styles.headerBtnCount}>{state.rules.length}</Text>
              ) : null}
            </Pressable>
          </View>
        </View>

        {totalItems === 0 ? (
          <View style={styles.emptyBlock}>
            <View style={styles.emptyIcon}>
              <Icon
                name={state.page.readAt ? "check-circle" : "mail"}
                size={20}
                color={colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {state.page.readAt ? "Nothing needs you" : "Stella will read your mail soon"}
            </Text>
            <Text style={styles.emptyBody}>
              {state.page.readAt
                ? state.nextReadAt
                  ? `You're caught up. Next check ${formatWhen(state.nextReadAt, locale)}.`
                  : "You're caught up. Urgent mail will reach you right away."
                : "Your page fills in automatically on Stella's next read, or you can run one now."}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Check email now"
              disabled={checking}
              onPress={() => void handleCheckNow()}
              style={({ pressed }) => [
                styles.secondaryBtn,
                styles.emptyAction,
                pressed && styles.pressedSoft,
              ]}
            >
              <Icon name="refresh-cw" size={13} color={colors.textStrong} />
              <Text style={styles.secondaryBtnText}>{checking ? "Checking…" : "Check now"}</Text>
            </Pressable>
          </View>
        ) : (
          grouped.map((group) => {
            if (group.items.length === 0 && group.key !== "needs_you") return null;
            return (
              <View key={group.key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeading}>{group.title}</Text>
                  {group.items.length > 0 ? (
                    <Text style={styles.sectionCount}>{group.items.length}</Text>
                  ) : null}
                </View>

                {group.items.length === 0 ? (
                  <Text style={styles.quietLine}>Nothing needs you.</Text>
                ) : (
                  group.items.map((item, idx) => {
                    const hasMore = Boolean(item.detail || item.draft);
                    const open = Boolean(expanded[item.id]);
                    const pending = pendingById[item.id];
                    const thread = item.threads?.[0];
                    const time = formatWhen(item.mailAt ?? item.at, locale);
                    const isSecondarySection = item.section !== "needs_you";
                    const emphasizeAction = Boolean(item.urgent || (open && item.draft));
                    const meta: string[] = [];
                    if (item.from) meta.push(item.from);
                    if (item.count && item.count > 1) meta.push(`${item.count} emails`);
                    if (state.accounts.length > 1 && thread?.account) meta.push(thread.account);
                    const draftText = tellDrafts[item.id] ?? "";
                    const sendDisabled = draftText.trim().length === 0 || Boolean(tellSending[item.id]);

                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.item,
                          idx === group.items.length - 1 && styles.itemLast,
                        ]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={item.title}
                          disabled={!hasMore}
                          onPress={() => {
                            if (!hasMore) return;
                            tapLight();
                            setExpanded((prev) => ({ ...prev, [item.id]: !open }));
                          }}
                        >
                          <View style={styles.itemHead}>
                            {item.urgent ? <View style={styles.urgentDot} /> : null}
                            <Text
                              style={[
                                styles.itemTitle,
                                isSecondarySection && styles.itemTitleMuted,
                              ]}
                            >
                              {item.title}
                            </Text>
                            {time ? <Text style={styles.itemTime}>{time}</Text> : null}
                          </View>
                          {meta.length > 0 ? (
                            <Text style={styles.itemMeta} numberOfLines={1}>
                              {meta.join(" · ")}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.itemGist,
                              isSecondarySection && styles.itemGistMuted,
                            ]}
                          >
                            {item.gist}
                          </Text>
                        </Pressable>

                        {hasMore && open ? (
                          <View style={styles.expandedBody}>
                            {item.detail ? <MobileRichText text={item.detail} styles={styles} /> : null}
                            {item.draft ? (
                              <View style={styles.draftBox}>
                                <View style={styles.draftHead}>
                                  <View style={styles.draftLabelRow}>
                                    <Icon name="reply" size={12} color={colors.textMuted} />
                                    <Text style={styles.draftLabel}>Drafted reply</Text>
                                  </View>
                                  {item.from ? (
                                    <Text style={styles.draftTo} numberOfLines={1}>
                                      To {item.from}
                                    </Text>
                                  ) : null}
                                </View>
                                <Text style={styles.draftBody}>{item.draft}</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}

                        {pending ? (
                          <View style={styles.pendingRow}>
                            <ActivityIndicator size="small" color={colors.textMuted} />
                            <Text style={styles.pendingText}>{pending}</Text>
                          </View>
                        ) : (
                          <>
                            <View style={styles.actionRow}>
                              {item.action ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`${item.action}: ${item.title}`}
                                  onPress={() => void handlePrimaryAction(item)}
                                  style={({ pressed }) => [
                                    item.section === "handled"
                                      ? styles.secondaryBtn
                                      : emphasizeAction
                                        ? styles.primaryBtn
                                        : styles.tonalBtn,
                                    pressed && styles.pressedSoft,
                                  ]}
                                >
                                  {item.section === "handled" ? (
                                    <Icon name="rotate-ccw" size={12} color={colors.textStrong} />
                                  ) : null}
                                  <Text
                                    style={
                                      item.section === "handled"
                                        ? styles.secondaryBtnText
                                        : emphasizeAction
                                          ? styles.primaryBtnText
                                          : styles.tonalBtnText
                                    }
                                  >
                                    {item.action}
                                  </Text>
                                </Pressable>
                              ) : null}

                              {hasMore ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={
                                    open ? "Hide details" : item.draft ? "Read draft" : "Show details"
                                  }
                                  onPress={() => {
                                    tapLight();
                                    setExpanded((prev) => ({ ...prev, [item.id]: !open }));
                                  }}
                                  style={({ pressed }) => [
                                    styles.ghostBtn,
                                    pressed && styles.pressedSoft,
                                  ]}
                                >
                                  <Text style={styles.ghostBtnText}>
                                    {open ? "Hide" : item.draft ? "Read draft" : "Details"}
                                  </Text>
                                </Pressable>
                              ) : null}

                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Tell Stella about ${item.title}`}
                                onPress={() => {
                                  tapLight();
                                  setTellingOpen((prev) => ({
                                    ...prev,
                                    [item.id]: !prev[item.id],
                                  }));
                                }}
                                style={({ pressed }) => [
                                  styles.ghostBtn,
                                  pressed && styles.pressedSoft,
                                ]}
                              >
                                <Text style={styles.ghostBtnText}>Tell Stella</Text>
                              </Pressable>

                              {thread ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="Open in Gmail"
                                  onPress={() => {
                                    tapLight();
                                    void Linking.openURL(gmailThreadUrl(thread)).catch(() => undefined);
                                  }}
                                  style={({ pressed }) => [
                                    styles.gmailBtn,
                                    pressed && styles.pressedSoft,
                                  ]}
                                >
                                  <Text style={styles.gmailBtnText}>Gmail</Text>
                                  <Icon name="external-link" size={11} color={colors.textWeaker} />
                                </Pressable>
                              ) : null}
                            </View>

                            {tellingOpen[item.id] ? (
                              <View style={styles.tellBox}>
                                <TextInput
                                  style={styles.tellInput}
                                  multiline
                                  placeholder="Tell Stella what to do, or why it doesn't matter…"
                                  placeholderTextColor={colors.textWeaker}
                                  value={draftText}
                                  editable={!tellSending[item.id]}
                                  onChangeText={(next) =>
                                    setTellDrafts((prev) => ({ ...prev, [item.id]: next }))
                                  }
                                />
                                <View style={styles.tellBar}>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Cancel"
                                    onPress={() =>
                                      setTellingOpen((prev) => ({ ...prev, [item.id]: false }))
                                    }
                                    style={({ pressed }) => [
                                      styles.ghostBtn,
                                      pressed && styles.pressedSoft,
                                    ]}
                                  >
                                    <Text style={styles.ghostBtnText}>Cancel</Text>
                                  </Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Send to Stella"
                                    disabled={sendDisabled}
                                    onPress={() => void handleTellSubmit(item)}
                                    style={({ pressed }) => [
                                      styles.primaryBtn,
                                      styles.tellSendBtn,
                                      sendDisabled && styles.disabled,
                                      pressed && styles.pressedSoft,
                                    ]}
                                  >
                                    <Text style={styles.primaryBtnText}>
                                      {tellSending[item.id] ? "Sending…" : "Send"}
                                    </Text>
                                  </Pressable>
                                </View>
                              </View>
                            ) : null}
                          </>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            );
          })
        )}

        {hasIgnored ? (
          <View style={styles.ignoredBlock}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ignored ${state.page.ignored.count} emails`}
              onPress={() => {
                tapLight();
                setIgnoredOpen((open) => !open);
              }}
              style={({ pressed }) => [styles.ignoredToggle, pressed && styles.pressedSoft]}
            >
              <Text style={styles.ignoredLabel}>
                Ignored {state.page.ignored.count}{" "}
                {state.page.ignored.count === 1 ? "email" : "emails"}
              </Text>
              <Icon
                name={ignoredOpen ? "chevron-down" : "chevron-right"}
                size={15}
                color={colors.textWeaker}
              />
            </Pressable>
            {ignoredOpen ? (
              <View style={styles.ignoredContent}>
                {state.page.ignored.gist ? (
                  <Text style={styles.itemMeta}>{state.page.ignored.gist}</Text>
                ) : null}
                {state.page.ignored.senders?.length ? (
                  <View style={styles.senderList}>
                    {state.page.ignored.senders.map((sender) => (
                      <View key={sender.name} style={styles.senderRow}>
                        <Text style={styles.senderName}>{sender.name}</Text>
                        <Text style={styles.senderCount}>{sender.count}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {state.nextReadAt ? (
          <View style={styles.footerMeta}>
            <Icon name="clock" size={12} color={colors.textWeaker} />
            <Text style={styles.footerMetaText}>
              Next automatic check {formatWhen(state.nextReadAt, locale)}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function EmailPage() {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const bottomInset = useSafeAreaInsets().bottom;
  const signedIn = Boolean(authClient.useSession().data?.user);
  const feed = useBackendView("email.page", signedIn ? {} : "skip");
  const value = feed.value;
  const [waiting, setWaiting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      markEmailSeen();
      return () => markEmailSeen();
    }, []),
  );

  useEffect(() => {
    if (value?.page) markEmailSeen();
  }, [value?.page]);

  const [turningOn, setTurningOn] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const connected = (value?.gmailConnected.length ?? 0) > 0;

  useEffect(() => {
    if (connected) setWaiting(false);
  }, [connected]);

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
    const reconnect = value.needsReconnect;
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

  if (!value.enabled) {
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

  return <NativeEmailView state={value} />;
}

const makeStyles = (colors: Colors, isDark: boolean) => {
  const subtleFill = isDark ? "rgba(255, 255, 255, 0.045)" : "rgba(0, 0, 0, 0.03)";
  const tonalFill = isDark ? "rgba(255, 255, 255, 0.075)" : "rgba(0, 0, 0, 0.055)";
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
    },
    centered: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
    scrollContent: {
      paddingTop: 6,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderWeak,
    },
    topSummary: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    topCount: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.25,
    },
    topMeta: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
    },
    topActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    headerIconBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: subtleFill,
    },
    headerBtnText: {
      color: colors.textBase,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
    },
    headerBtnCount: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
    },
    section: {
      marginTop: 22,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 7,
      marginBottom: 4,
    },
    sectionHeading: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
    },
    sectionCount: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    quietLine: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      paddingVertical: 10,
    },
    item: {
      paddingVertical: 15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderWeak,
    },
    itemLast: {
      borderBottomWidth: 0,
    },
    itemHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    urgentDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.accent,
    },
    itemTitle: {
      flex: 1,
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      lineHeight: 21,
      letterSpacing: -0.2,
    },
    itemTitleMuted: {
      color: colors.textBase,
      fontFamily: fonts.sans.medium,
    },
    itemTime: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    itemMeta: {
      marginTop: 3,
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
    },
    itemGist: {
      marginTop: 7,
      color: colors.textBase,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 21,
    },
    itemGistMuted: {
      color: colors.textMuted,
    },
    expandedBody: {
      marginTop: 12,
      gap: 12,
    },
    richText: {
      gap: 8,
    },
    detailParagraph: {
      marginBottom: 2,
    },
    detailText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 20,
    },
    detailStrong: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
    },
    bulletList: {
      gap: 5,
    },
    bulletRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    bulletDot: {
      color: colors.textWeaker,
      fontSize: 13.5,
      lineHeight: 20,
    },
    bulletBody: {
      flex: 1,
    },
    draftBox: {
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderWeak,
      backgroundColor: subtleFill,
      overflow: "hidden",
    },
    draftHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderWeak,
    },
    draftLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    draftLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
    },
    draftTo: {
      flexShrink: 1,
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    draftBody: {
      paddingHorizontal: 13,
      paddingVertical: 12,
      color: colors.textStrong,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 20.5,
    },
    actionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 13,
    },
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 14,
      borderRadius: 9,
      backgroundColor: colors.accent,
    },
    primaryBtnText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    tonalBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: tonalFill,
    },
    tonalBtnText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 32,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    secondaryBtnText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    dangerBtnText: {
      color: colors.danger,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    ghostBtn: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 32,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    ghostBtnText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    gmailBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 32,
      paddingHorizontal: 6,
      marginLeft: "auto",
    },
    gmailBtnText: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
    },
    pendingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 13,
    },
    pendingText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    tellBox: {
      marginTop: 12,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: subtleFill,
      overflow: "hidden",
    },
    tellInput: {
      minHeight: 72,
      paddingHorizontal: 13,
      paddingTop: 11,
      paddingBottom: 8,
      color: colors.textStrong,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
      textAlignVertical: "top",
    },
    tellBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 8,
      paddingHorizontal: 10,
      paddingBottom: 9,
    },
    tellSendBtn: {
      minHeight: 30,
      paddingHorizontal: 13,
    },
    ignoredBlock: {
      marginTop: 26,
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
    },
    ignoredToggle: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 6,
    },
    ignoredLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    ignoredContent: {
      marginTop: 6,
    },
    senderList: {
      marginTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
    },
    senderRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderWeak,
    },
    senderName: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    senderCount: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    footerMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 22,
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
    },
    footerMetaText: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    emptyBlock: {
      alignItems: "center",
      paddingVertical: 44,
      paddingHorizontal: 16,
    },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderWeak,
      backgroundColor: subtleFill,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    emptyTitle: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.25,
      textAlign: "center",
    },
    emptyBody: {
      marginTop: 6,
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20.5,
      textAlign: "center",
      maxWidth: 300,
    },
    emptyAction: {
      marginTop: 18,
    },
    settingsHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderWeak,
    },
    backText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    settingsTitle: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.2,
    },
    settingsGroup: {
      marginTop: 24,
    },
    hairlineList: {
      marginTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
    },
    settingsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderWeak,
    },
    settingsRowCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    settingsRowMain: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 19.5,
    },
    settingsRowSub: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      lineHeight: 17.5,
    },
    settingsRowValue: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    accountRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
      minWidth: 0,
    },
    footnote: {
      marginTop: 12,
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      lineHeight: 18,
    },
    pressedSoft: {
      opacity: 0.65,
    },
    disabled: {
      opacity: 0.45,
    },
  });
};
