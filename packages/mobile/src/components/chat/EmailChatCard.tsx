import { memo, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { EMAIL_REASON_WORDS, type EmailCard, type EmailCardItem } from "@stella/contracts/email-card";
import { Text } from "../Text";
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
import { ScheduleCardShell, makeChatCardButtonStyles } from "./ScheduleCardShell";

const COLLAPSED_ROWS = 3;

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

function UrgentCard({ item, colors }: { item: EmailCardItem; colors: Colors }) {
  const t = useT();
  const styles = useMemo(() => ({ ...makeChatCardButtonStyles(colors), ...makeStyles(colors) }), [colors]);
  const { showAccounts } = useEmailFeedItems();
  const [settled, settle] = useItemSettled(item.itemId);
  const [busy, setBusy] = useState(false);
  const status = [item.line || EMAIL_REASON_WORDS[item.reason], showAccounts ? item.account : null]
    .filter(Boolean)
    .join(" · ");
  const headline = `${senderName(item.from)} · ${item.subject}`;

  const notUrgent = () => {
    tapMedium();
    setBusy(true);
    void correctEmail(item.itemId, "needs_you")
      .then(() => settle("moved"))
      .catch(() => Alert.alert(t("email.failed")))
      .finally(() => setBusy(false));
  };

  // Urgent mail must be readable at a glance: the sender, subject and line wrap, and the two
  // buttons sit on their own row under them instead of squeezing the text to a few words.
  const actions = settled ? (
    <Text style={styles.settled} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
      {settled === "moved" ? t("email.card.movedToSummary") : t("email.card.wontShow")}
    </Text>
  ) : (
    <>
      <Pressable
        accessibilityRole="button"
        hitSlop={10}
        disabled={busy}
        onPress={notUrgent}
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.dimmed]}
      >
        <Text style={styles.label} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("email.notUrgent")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => {
          tapLight();
          openGmailThread(item.threadId, item.account);
        }}
        style={({ pressed }) => [styles.button, styles.primary, pressed && styles.dimmed]}
      >
        <Text style={[styles.label, styles.primaryLabel]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("common.open")}
        </Text>
      </Pressable>
    </>
  );

  return (
    <ScheduleCardShell
      colors={colors}
      icon="mail"
      headline={headline}
      status={settled ? "" : status}
      actions={actions}
      wrap
      testID="email-card"
      accessibilityLabel={`${headline}, ${status}`}
    />
  );
}

function RuleCard({ card, item, colors }: { card: EmailCard; item: EmailCardItem; colors: Colors }) {
  const t = useT();
  const { showAccounts } = useEmailFeedItems();
  const status = [senderName(item.from), item.line || item.subject, showAccounts ? item.account : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <ScheduleCardShell
      colors={colors}
      icon="mail"
      headline={card.ruleText ?? senderName(item.from)}
      status={status}
      testID="email-card"
      accessibilityLabel={`${card.ruleText ?? ""}, ${status}`}
      accessibilityHint={t("email.section.openInGmail")}
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
  const t = useT();
  const tPlural = useTPlural();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { showAccounts } = useEmailFeedItems();
  const [expanded, setExpanded] = useState(false);
  const needYou = card.items.filter((item) => item.bucket === "urgent" || item.bucket === "needs_you").length;
  const worth = card.items.length - needYou;
  const headline = [
    needYou > 0 ? tPlural("email.card.needYou", needYou) : null,
    worth > 0 ? tPlural("email.card.worthKnowing", worth) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const shown = expanded ? card.items : card.items.slice(0, COLLAPSED_ROWS);
  return (
    <ScheduleCardShell
      colors={colors}
      icon="mail"
      headline={headline}
      status={card.noiseCount ? tPlural("email.card.skipped", card.noiseCount) : ""}
      testID="email-card"
    >
      <View style={styles.rows}>
        {shown.map((item) => (
          <SummaryRow key={item.itemId} item={item} showAccount={showAccounts} styles={styles} />
        ))}
      </View>
      {card.items.length > COLLAPSED_ROWS ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            tapLight();
            setExpanded((open) => !open);
          }}
          style={styles.more}
        >
          <Text style={styles.moreLabel} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {expanded ? t("email.card.showLess") : t("email.card.showAll", { count: card.items.length })}
          </Text>
        </Pressable>
      ) : null}
    </ScheduleCardShell>
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
    rows: { marginTop: 6 },
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
