import { memo, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { EMAIL_REASON_WORDS, type EmailCard, type EmailCardItem } from "@stella/contracts/email-card";
import { Text } from "../Text";
import { Icon } from "../Icon";
import { useT, useTPlural } from "../../i18n";
import {
  chooseAction,
  correctEmail,
  dismissEmail,
  openGmailThread,
  senderName,
  useEmailFeedItems,
} from "../../lib/email";
import { tapLight, tapMedium } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";


type Settled = "moved" | "dismissed";

function useItemSettled(itemId: string): [Settled | null, (next: Settled) => void] {
  const { items } = useEmailFeedItems();
  const [local, setLocal] = useState<Settled | null>(null);
  const item = items?.get(itemId);
  const fromFeed: Settled | null =
    item?.state === "dismissed"
      ? "dismissed"
      : item?.corrected && item.bucket !== "urgent"
        ? "moved"
        : null;
  return [local ?? fromFeed, setLocal];
}

/**
 * Email in the chat is one quiet line: urgent mail says who and the point, a
 * summary says how many need you; the summary's numbered list opens in place.
 */
function Line({
  colors,
  label,
  from,
  text,
  trailing,
  chevron,
  expanded,
  onPress,
  onLongPress,
  accessibilityLabel,
  children,
}: {
  colors: Colors;
  label?: string;
  from?: string;
  text: string;
  trailing?: ReactNode;
  chevron?: boolean;
  expanded?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  children?: ReactNode;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.lineWrap, expanded && styles.lineWrapOpen]} testID="email-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={chevron ? { expanded: Boolean(expanded) } : undefined}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.lineBar, pressed && styles.rowPressed]}
      >
        <Icon name="mail" size={14} color={colors.textMuted} />
        <Text style={styles.lineText} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {label ? <Text style={styles.lineLabel}>{label} </Text> : null}
          {from ? <Text style={styles.lineFrom}>{from} </Text> : null}
          {text}
        </Text>
        {chevron ? <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} color={colors.textMuted} /> : null}
        {trailing}
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

function UrgentCard({ item, colors }: { item: EmailCardItem; colors: Colors }) {
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { showAccounts } = useEmailFeedItems();
  const [settled, settle] = useItemSettled(item.itemId);
  const point = [item.line || EMAIL_REASON_WORDS[item.reason], showAccounts ? item.account : null]
    .filter(Boolean)
    .join(" · ");
  const open = () => {
    tapLight();
    openGmailThread(item.threadId, item.account);
  };
  const more = () => {
    if (settled) return;
    tapMedium();
    chooseAction(
      senderName(item.from),
      [{ label: t("email.section.openInGmail") }, { label: t("email.notUrgent") }],
      t("common.cancel"),
      (index) => {
        if (index === 0) open();
        else
          void correctEmail(item.itemId, "needs_you")
            .then(() => settle("moved"))
            .catch(() => Alert.alert(t("email.failed")));
      },
    );
  };
  return (
    <Line
      colors={colors}
      label={settled ? undefined : t("email.section.urgent")}
      from={senderName(item.from)}
      text={settled ? (settled === "moved" ? t("email.card.movedToSummary") : t("email.card.wontShow")) : point}
      accessibilityLabel={`${senderName(item.from)}, ${item.subject}, ${point}`}
      onPress={open}
      onLongPress={more}
      trailing={
        settled ? null : (
          <Text style={styles.lineOpen} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("common.open")}
          </Text>
        )
      }
    />
  );
}

function RuleCard({ card, item, colors }: { card: EmailCard; item: EmailCardItem; colors: Colors }) {
  const { showAccounts } = useEmailFeedItems();
  const what = [item.line || item.subject, showAccounts ? item.account : null].filter(Boolean).join(" · ");
  return (
    <Line
      colors={colors}
      from={senderName(item.from)}
      text={what}
      accessibilityLabel={`${card.ruleText ?? ""}, ${senderName(item.from)}, ${what}`}
      onPress={() => {
        tapLight();
        openGmailThread(item.threadId, item.account);
      }}
    />
  );
}

function SummaryRow({
  item,
  showAccount,
  styles,
}: {
  item: EmailCardItem;
  showAccount: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const t = useT();
  const [settled, settle] = useItemSettled(item.itemId);
  const dismissed = settled === "dismissed";
  const open = () => {
    tapLight();
    openGmailThread(item.threadId, item.account);
  };
  const more = () => {
    tapMedium();
    chooseAction(
      senderName(item.from),
      [
        { label: t("email.section.openInGmail") },
        ...(dismissed ? [] : [{ label: t("email.notImportant"), destructive: true }]),
      ],
      t("common.cancel"),
      (index) => {
        if (index === 0) open();
        else
          void dismissEmail(item.itemId)
            .then(() => settle("dismissed"))
            .catch(() => Alert.alert(t("email.failed")));
      },
    );
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t("email.section.openInGmail")}
      onPress={open}
      onLongPress={more}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.n} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {item.n}
      </Text>
      <View style={[styles.rowText, dismissed && styles.rowDismissed]}>
        <Text style={styles.rowHead} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          <Text style={styles.from}>{senderName(item.from)}</Text>
          <Text style={styles.subject}>
            {"  "}
            {showAccount && item.account ? `${item.subject} · ${item.account}` : item.subject}
          </Text>
        </Text>
        {dismissed ? (
          <Text style={styles.subject} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("email.card.wontShow")}
          </Text>
        ) : item.line ? (
          <Text style={styles.line} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {item.line}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SummaryCard({ card, colors }: { card: EmailCard; colors: Colors }) {
  const tPlural = useTPlural();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { showAccounts } = useEmailFeedItems();
  const [expanded, setExpanded] = useState(false);
  const needYou = card.items.filter((item) => item.bucket === "urgent" || item.bucket === "needs_you").length;
  const worth = card.items.length - needYou;
  const text = [
    needYou > 0 ? tPlural("email.card.needYou", needYou) : null,
    worth > 0 ? tPlural("email.card.worthKnowing", worth) : null,
    card.noiseCount ? tPlural("email.card.skipped", card.noiseCount) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Line
      colors={colors}
      text={text}
      chevron
      expanded={expanded}
      accessibilityLabel={text}
      onPress={() => {
        tapLight();
        setExpanded((open) => !open);
      }}
    >
      <View style={styles.rows}>
        {card.items.map((item) => (
          <SummaryRow key={item.itemId} item={item} showAccount={showAccounts} styles={styles} />
        ))}
      </View>
    </Line>
  );
}

export const EmailChatCard = memo(function EmailChatCard({ card, colors }: { card: EmailCard; colors: Colors }) {
  const first = card.items[0];
  if (!first) return null;
  if (card.kind === "urgent") return <UrgentCard item={first} colors={colors} />;
  if (card.kind === "rule") return <RuleCard card={card} item={first} colors={colors} />;
  return <SummaryCard card={card} colors={colors} />;
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    settled: {
      color: colors.textMuted,
      flexShrink: 0,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
    lineWrap: {
      alignSelf: "flex-start",
      borderCurve: "continuous",
      borderRadius: 14,
      maxWidth: "100%",
    },
    lineWrapOpen: {
      alignSelf: "stretch",
      backgroundColor: colors.assistantBubbleFillTop,
      paddingBottom: 6,
      paddingHorizontal: 12,
    },
    lineBar: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      paddingVertical: 6,
    },
    lineText: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      letterSpacing: -0.15,
    },
    lineLabel: { color: colors.accent, fontFamily: fonts.sans.medium },
    lineFrom: { color: colors.assistantBubbleText, fontFamily: fonts.sans.medium },
    lineOpen: {
      color: colors.accent,
      flexShrink: 0,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
    rows: { marginTop: 0 },
    row: {
      borderTopColor: fadeHex(colors.text, 0.1),
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8,
      paddingVertical: 8,
    },
    rowPressed: { opacity: 0.6 },
    rowDismissed: { opacity: 0.5 },
    n: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      lineHeight: 20,
      width: 14,
    },
    rowText: { flex: 1, minWidth: 0 },
    rowHead: { fontSize: 15, lineHeight: 20 },
    from: {
      color: colors.assistantBubbleText,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    subject: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      letterSpacing: -0.2,
      lineHeight: 20,
    },
    line: {
      color: colors.assistantBubbleText,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      letterSpacing: -0.2,
      lineHeight: 20,
    },
    more: { alignSelf: "flex-start", paddingBottom: 2, paddingTop: 2 },
    moreLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
      lineHeight: 20,
    },
  });
