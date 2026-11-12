import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { EmailBucket, EmailDigest, EmailFocusAction, EmailItem } from "@stella/contracts/backend/email";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { useLocale, useT, useTPlural } from "../i18n";
import { authClient } from "../lib/auth-client";
import { useBackendView } from "../lib/backend";
import {
  archiveEmail,
  askStellaAboutEmail,
  chooseAction,
  correctEmail,
  dismissEmail,
  emailTime,
  openGmailThread,
  senderName,
} from "../lib/email";
import { tapLight, tapMedium } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";

type Styles = ReturnType<typeof makeStyles>;

const needsYou = (item: EmailItem) => item.bucket === "urgent" || item.bucket === "needs_you";

function Action({
  label,
  onPress,
  disabled,
  active,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      disabled={disabled}
      onPress={() => {
        tapLight();
        onPress();
      }}
      style={({ pressed }) => [styles.action, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={[styles.actionLabel, active && styles.actionActive]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
}

function DigestItem({
  item,
  now,
  showAccount,
  onAsked,
  styles,
  colors,
}: {
  item: EmailItem;
  now: number;
  showAccount: boolean;
  onAsked: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const t = useT();
  const locale = useLocale();
  const [archived, setArchived] = useState<boolean | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const isArchived = archived ?? Boolean(item.archived);
  const dismissed = item.state === "dismissed";
  const from = senderName(item.from);
  const subject = item.subject;
  const moveTo: EmailBucket = item.bucket === "worth_knowing" ? "needs_you" : "worth_knowing";

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch((error: unknown) =>
        Alert.alert(error instanceof Error && error.message ? error.message : t("email.failed")),
      )
      .finally(() => setBusy(false));
  };
  const ask = (action: EmailFocusAction, text: string) =>
    run(async () => {
      await askStellaAboutEmail(item, action, text);
      setComposing(false);
      setDraft("");
      onAsked();
    });
  const tell = () => {
    const text = draft.trim();
    if (text) ask("tell", t("email.digest.askTell", { from, subject, text }));
  };
  const more = () => {
    tapMedium();
    chooseAction(
      from,
      [
        { label: t("email.section.openInGmail") },
        { label: t("email.digest.tell") },
        { label: moveTo === "needs_you" ? t("email.section.moveToNeedsYou") : t("email.section.moveToWorthKnowing") },
        ...(dismissed ? [] : [{ label: t("email.notImportant"), destructive: true }]),
      ],
      t("common.cancel"),
      (index) => {
        if (index === 0) openGmailThread(item.threadId, item.account);
        else if (index === 1) setComposing(true);
        else if (index === 2) run(() => correctEmail(item.itemId, moveTo));
        else run(() => dismissEmail(item.itemId));
      },
    );
  };

  return (
    <View style={[styles.item, busy && styles.busy]} testID="email-digest-item">
      <View style={(isArchived || dismissed) && styles.quiet}>
        <View style={styles.head}>
          <Text style={styles.from} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {from}
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
        <Text style={styles.subject} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {showAccount ? `${subject} · ${item.account}` : subject}
        </Text>
        {item.line ? (
          <Text style={styles.line} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {item.line}
          </Text>
        ) : null}
      </View>
      {dismissed ? (
        <Text style={[styles.notice, styles.flush]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("email.card.wontShow")}
        </Text>
      ) : (
        <View style={styles.actions}>
          <Action
            label={t("email.digest.reply")}
            disabled={busy}
            onPress={() => ask("reply", t("email.digest.askReply", { from, subject }))}
            styles={styles}
          />
          <Action
            label={t("email.digest.handle")}
            disabled={busy}
            onPress={() => ask("handle", t("email.digest.askHandle", { from, subject }))}
            styles={styles}
          />
          <Action
            label={isArchived ? t("email.digest.unarchive") : t("email.digest.archive")}
            disabled={busy}
            onPress={() =>
              run(async () => {
                await archiveEmail(item.itemId, !isArchived);
                setArchived(!isArchived);
              })
            }
            styles={styles}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("email.section.actions")}
            hitSlop={10}
            disabled={busy}
            onPress={more}
            style={({ pressed }) => [styles.moreButton, pressed && styles.dimmed]}
          >
            <Icon name="more-horizontal" size={17} color={colors.textMuted} />
          </Pressable>
        </View>
      )}
      {composing ? (
        <View style={styles.tell}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline
            placeholder={t("email.digest.tellPlaceholder")}
            placeholderTextColor={fadeHex(colors.textMuted, 0.8)}
            selectionColor={colors.accent}
            style={styles.tellInput}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          />
          <View style={styles.tellButtons}>
            <Action label={t("common.cancel")} onPress={() => setComposing(false)} styles={styles} />
            <Action label={t("email.digest.send")} active disabled={busy || !draft.trim()} onPress={tell} styles={styles} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Skipped({ items, now, styles }: { items: EmailItem[]; now: number; styles: Styles }) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [mattered, setMattered] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) return null;
  const matter = (item: EmailItem) => {
    void correctEmail(item.itemId, "needs_you")
      .then(() => setMattered((current) => new Set([...current, item.itemId])))
      .catch(() => Alert.alert(t("email.failed")));
  };
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => {
          tapLight();
          setOpen((value) => !value);
        }}
        style={styles.disclosure}
      >
        <Text style={styles.disclosureLabel} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {tPlural("email.digest.skipped", items.length)}
        </Text>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={styles.disclosureLabel.color} />
      </Pressable>
      {open ? (
        <>
          <Text style={styles.notice} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("email.digest.skippedHint")}
          </Text>
          {items.map((item) => {
            const done = mattered.has(item.itemId) || (item.corrected && item.bucket !== "noise");
            return (
              <View key={item.itemId} style={styles.skippedRow} testID="email-skipped-item">
                <View style={styles.head}>
                  <Text style={styles.skippedFrom} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                    {senderName(item.from)}
                  </Text>
                  <Text style={styles.time} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                    {emailTime(locale, item.receivedAt, now)}
                  </Text>
                </View>
                <Text style={styles.subject} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                  {item.subject}
                </Text>
                {done ? (
                  <Text style={[styles.actionLabel, styles.actionActive, styles.matter]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                    {t("email.digest.matteredDone")}
                  </Text>
                ) : (
                  <View style={styles.matter}>
                    <Action label={t("email.digest.mattered")} onPress={() => matter(item)} styles={styles} />
                  </View>
                )}
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const countsOf = (
  digest: EmailDigest,
  t: (key: string) => string,
  tPlural: (key: string, count: number) => string,
): string => {
  if (digest.kind === "urgent") return t("email.section.urgent");
  if (digest.kind === "rule") return t("email.digest.ruleTitle");
  const need = digest.items.filter(needsYou).length;
  const worth = digest.items.length - need;
  return [
    need > 0 ? tPlural("email.card.needYou", need) : null,
    worth > 0 ? tPlural("email.card.worthKnowing", worth) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

/**
 * The digest behind a chat email row (the newest by default), written as a
 * short document with light actions on each email, what was skipped, and
 * every earlier digest of the week. Not scrollable itself.
 */
export function EmailDigestView({
  digestId,
  onSelect,
  onAsked,
  waiting = [],
}: {
  digestId: string | null;
  onSelect: (digestId: string) => void;
  /** An action handed an email to Stella; the chat shows what happens. */
  onAsked: () => void;
  /** Mail sorted since the newest digest, not in one yet. */
  waiting?: EmailItem[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const signedIn = Boolean(authClient.useSession().data?.user);
  const view = useBackendView("email.digests", signedIn ? {} : "skip");
  const [now] = useState(() => Date.now());
  const digests = view.value?.digests ?? [];
  const shown = digests.find((digest) => digest.digestId === digestId) ?? digests[0] ?? null;
  const newest = shown !== null && shown === digests[0];
  if (!view.value) {
    return (
      <View style={styles.loading}>
        {view.error ? (
          <Text style={styles.notice}>{t("email.section.loadErrorBody")}</Text>
        ) : (
          <ActivityIndicator color={colors.textMuted} />
        )}
      </View>
    );
  }
  const showAccount = view.value.multipleAccounts;
  const need = shown ? shown.items.filter(needsYou) : [];
  const worth = shown ? shown.items.filter((item) => !needsYou(item)) : [];
  const meta = shown
    ? [
        emailTime(locale, shown.createdAt, now),
        shown.sinceAt ? t("email.digest.since", { time: emailTime(locale, shown.sinceAt, now) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const list = (items: EmailItem[]) =>
    items.map((item, index) => (
      <View key={item.itemId} style={index > 0 ? styles.separated : undefined}>
        <DigestItem item={item} now={now} showAccount={showAccount} onAsked={onAsked} styles={styles} colors={colors} />
      </View>
    ));
  const earlier = digests.filter((digest) => digest !== shown);
  return (
    <View style={styles.root} testID="email-digest">
      {shown ? (
        <View style={styles.header}>
          <Text style={styles.title} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {countsOf(shown, t, tPlural)}
          </Text>
          <Text style={styles.meta} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {meta}
          </Text>
          {shown.ruleText ? (
            <Text style={styles.meta} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              “{shown.ruleText}”
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.notice} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("email.digest.empty")}
        </Text>
      )}
      {need.length > 0 ? (
        <View style={styles.group}>
          {shown?.kind === "summary" ? (
            <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {t("email.section.needsYou")}
            </Text>
          ) : null}
          {list(need)}
        </View>
      ) : null}
      {worth.length > 0 ? (
        <View style={styles.group}>
          {shown?.kind === "summary" ? (
            <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {t("email.section.worthKnowing")}
            </Text>
          ) : null}
          {list(worth)}
        </View>
      ) : null}
      {shown ? <Skipped key={shown.digestId} items={shown.skipped} now={now} styles={styles} /> : null}
      {(newest || !shown) && waiting.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("email.digest.waiting")}
          </Text>
          {list(waiting)}
        </View>
      ) : null}
      {earlier.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("email.digest.earlier")}
          </Text>
          {earlier.map((digest, index) => (
            <Pressable
              key={digest.digestId}
              accessibilityRole="button"
              onPress={() => {
                tapLight();
                onSelect(digest.digestId);
              }}
              style={({ pressed }) => [styles.earlier, index > 0 && styles.separated, pressed && styles.dimmed]}
            >
              <Text style={styles.earlierTime} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                {emailTime(locale, digest.createdAt, now)}
              </Text>
              <Text style={styles.earlierCounts} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                {countsOf(digest, t, tPlural)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { gap: 22 },
    loading: { alignItems: "center", paddingVertical: 32 },
    header: { gap: 3, paddingHorizontal: 2 },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 21,
      letterSpacing: -0.4,
      lineHeight: 27,
    },
    meta: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 18,
    },
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
    item: { gap: 2, paddingHorizontal: 2, paddingVertical: 12 },
    busy: { opacity: 0.6 },
    quiet: { opacity: 0.5 },
    head: { alignItems: "baseline", flexDirection: "row", gap: 8 },
    from: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      letterSpacing: -0.2,
    },
    urgent: { color: colors.accent, fontFamily: fonts.sans.medium, fontSize: 12.5 },
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
      fontSize: 13.5,
      letterSpacing: -0.1,
      lineHeight: 18,
    },
    line: {
      color: colors.textBase,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      letterSpacing: -0.15,
      lineHeight: 21,
      marginTop: 3,
    },
    actions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 8 },
    action: { paddingVertical: 3 },
    actionLabel: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 14 },
    actionActive: { color: colors.accent },
    dimmed: { opacity: 0.5 },
    moreButton: { alignItems: "center", height: 24, justifyContent: "center", marginLeft: "auto", width: 28 },
    tell: { gap: 6, marginTop: 8 },
    tellInput: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
      minHeight: 64,
      paddingHorizontal: 12,
      paddingVertical: 9,
      textAlignVertical: "top",
    },
    tellButtons: { flexDirection: "row", gap: 18, justifyContent: "flex-end" },
    notice: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 19,
      marginTop: 4,
      paddingHorizontal: 2,
    },
    flush: { paddingHorizontal: 0 },
    disclosure: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, paddingHorizontal: 2, paddingVertical: 2 },
    disclosureLabel: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 14 },
    skippedRow: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 1,
      paddingHorizontal: 2,
      paddingVertical: 9,
    },
    skippedFrom: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
    matter: { alignSelf: "flex-start", fontSize: 13, marginTop: 2 },
    earlier: { alignItems: "baseline", flexDirection: "row", gap: 12, paddingHorizontal: 2, paddingVertical: 9 },
    earlierTime: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      fontVariant: ["tabular-nums"],
      minWidth: 84,
    },
    earlierCounts: { color: colors.text, flexShrink: 1, fontFamily: fonts.sans.regular, fontSize: 14.5 },
  });
