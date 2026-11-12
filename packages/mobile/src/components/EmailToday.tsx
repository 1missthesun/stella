import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import ReanimatedSwipeable, { SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";
import type {
  EmailHistory,
  EmailLogEntry,
  EmailMatter,
  EmailNoiseSender,
  EmailToday,
  EmailAccess,
} from "@stella/contracts/backend/email";
import { useRouter } from "expo-router";
import { openChatSettingsAt } from "../lib/connect-plan";
import { providerBrainId } from "../lib/use-cloud-model-settings";
import { useServerFeatures } from "../lib/server-features";
import { laterChoices, splitEmailLog, TODAY_TONES, whenLabel, type LaterChoiceId } from "@stella/contracts/email-brief";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { useLocale, useT, useTPlural } from "../i18n";
import { getBackendClient } from "../lib/backend";
import { useDictation } from "../lib/dictation";
import { archiveEmail, chooseAction, correctEmail, dismissEmail, emailTime, openGmailThread } from "../lib/email";
import { tapLight, tapMedium } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";

const SCALE = CONTENT_MAX_FONT_SCALE;
type Styles = ReturnType<typeof makeStyles>;
type T = ReturnType<typeof useT>;
type TPlural = ReturnType<typeof useTPlural>;

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

const settle = (matterId: string, status: "open" | "later" | "done", laterUntil?: number) =>
  getBackendClient().call("email.settle", { matterId, status, ...(laterUntil !== undefined ? { laterUntil } : {}) });

/** The light markdown Stella writes: bold only, nested in the surrounding text. */
export function Md({ text, boldStyle }: { text: string; boldStyle: object }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/gu);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <Text key={index} style={boldStyle} maxFontSizeMultiplier={SCALE}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

// A short line at the foot of the page, with Undo when it can be taken back ----------

type Notice = { key: number; text: string; undo?: () => void };
let notice: Notice | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const noticeListeners = new Set<() => void>();
const setNotice = (next: Notice | null) => {
  notice = next;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = next ? setTimeout(() => setNotice(null), next.undo ? 10_000 : 4000) : null;
  for (const listener of noticeListeners) listener();
};
export const showEmailNotice = (text: string, undo?: () => void) => setNotice({ key: Date.now(), text, ...(undo ? { undo } : {}) });

/** The page's foot line: what just happened, and Undo while it can be taken back. */
export function EmailNoticeBar({ bottom }: { bottom: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const current = useSyncExternalStore(
    (listener) => {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    () => notice,
  );
  if (!current) return null;
  return (
    <View style={[styles.noticeBar, { paddingBottom: bottom + 12 }]} testID="email-notice">
      <Text style={styles.noticeText} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
        {current.text}
      </Text>
      {current.undo ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => {
            tapLight();
            current.undo?.();
            setNotice(null);
          }}
          testID="email-undo"
        >
          <Text style={styles.noticeUndo} maxFontSizeMultiplier={SCALE}>
            {t("email.today.undo")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Voice: hold to speak a reply, one at a time across the list --------------------------

type Voice = {
  editing: { matterId: string; body: string } | null;
  listeningFor: string | null;
  writingFor: string | null;
  edit: (matter: EmailMatter, body: string) => void;
  close: () => void;
  startHold: (matter: EmailMatter) => void;
  releaseHold: () => void;
};

function useVoice(): Voice {
  const t = useT();
  const [editing, setEditing] = useState<{ matterId: string; body: string } | null>(null);
  const [holdFor, setHoldFor] = useState<EmailMatter | null>(null);
  const [writingFor, setWritingFor] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const holdRef = useRef<EmailMatter | null>(null);
  const releasedRef = useRef(false);
  const writingRef = useRef(false);

  const onTranscript = useCallback(
    (text: string) => {
      const matter = holdRef.current;
      const words = text.trim();
      holdRef.current = null;
      setHoldFor(null);
      if (!matter || !words) return;
      const draft = editingRef.current?.matterId === matter.matterId ? editingRef.current.body : undefined;
      writingRef.current = true;
      setWritingFor(matter.matterId);
      setEditing({ matterId: matter.matterId, body: draft ?? "" });
      void getBackendClient()
        .call("email.voiceReply", { matterId: matter.matterId, words, ...(draft ? { draft } : {}) })
        .then(({ body }) => setEditing({ matterId: matter.matterId, body }))
        .catch((error: unknown) => Alert.alert(errorText(error, t("email.failed"))))
        .finally(() => {
          writingRef.current = false;
          setWritingFor(null);
        });
    },
    [t],
  );
  const dictation = useDictation({ onTranscript });
  const { start, stop, status } = dictation;

  // Let go and nothing was heard: the hold ends quietly.
  useEffect(() => {
    if (status === "idle" && releasedRef.current && holdRef.current && !writingRef.current) {
      holdRef.current = null;
      setHoldFor(null);
    }
  }, [status]);

  return {
    editing,
    listeningFor: holdFor && status !== "transcribing" ? holdFor.matterId : null,
    writingFor: writingFor ?? (holdFor && status === "transcribing" ? holdFor.matterId : null),
    edit: (matter, body) => setEditing({ matterId: matter.matterId, body }),
    close: () => setEditing(null),
    startHold: (matter) => {
      if (holdRef.current) return;
      tapMedium();
      holdRef.current = matter;
      releasedRef.current = false;
      setHoldFor(matter);
      void start().then((ok) => {
        if (!ok && holdRef.current === matter) {
          holdRef.current = null;
          setHoldFor(null);
        }
      });
    },
    releaseHold: () => {
      if (!holdRef.current || releasedRef.current) return;
      releasedRef.current = true;
      void stop();
    },
  };
}

// The reply, prepared -------------------------------------------------------------------

function ReplyEditor({
  matter,
  voice,
  styles,
  colors,
}: {
  matter: EmailMatter;
  voice: Voice;
  styles: Styles;
  colors: Colors;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = voice.editing?.body ?? "";
  const listening = voice.listeningFor === matter.matterId;
  const writing = voice.writingFor === matter.matterId;
  const send = (mode: "send" | "draft") => {
    if (!body.trim()) return;
    tapLight();
    setBusy(true);
    setError(null);
    void getBackendClient()
      .call("email.sendReply", { matterId: matter.matterId, body, mode })
      .then(() => {
        voice.close();
        showEmailNotice(mode === "send" ? t("email.reply.sent") : t("email.reply.saved"));
      })
      .catch((caught: unknown) => setError(errorText(caught, t("email.failed"))))
      .finally(() => setBusy(false));
  };
  const blocked = busy || writing || !body.trim();
  return (
    <View style={styles.reply} testID="email-reply-editor">
      <Text style={styles.replyTo} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
        {t("email.reply.to", { to: matter.from })}
      </Text>
      <TextInput
        // Remounts when Stella's reply lands, so the field grows to the new text.
        key={writing ? "writing" : "body"}
        style={styles.replyText}
        value={writing ? t("email.reply.writing") : body}
        editable={!writing && !busy}
        multiline
        scrollEnabled={false}
        onChangeText={(text) => voice.edit(matter, text)}
        placeholderTextColor={colors.textMuted}
        maxFontSizeMultiplier={SCALE}
        testID="email-reply-body"
      />
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          disabled={blocked}
          onPress={() => send("send")}
          style={({ pressed }) => [styles.primary, (pressed || blocked) && styles.dimmed]}
          testID="email-reply-send"
        >
          <Text style={styles.primaryLabel} maxFontSizeMultiplier={SCALE}>
            {t("email.reply.send")}
          </Text>
        </Pressable>
        <Quiet label={t("email.reply.saveDraft")} disabled={blocked} onPress={() => send("draft")} styles={styles} testID="email-reply-draft" />
        <Quiet label={t("email.reply.cancel")} disabled={busy} onPress={voice.close} styles={styles} />
      </View>
      <MicButton matter={matter} voice={voice} onTap={() => undefined} styles={styles} colors={colors} label />
      <Text style={styles.replyNote} maxFontSizeMultiplier={SCALE}>
        {error ?? (listening ? t("email.reply.listening") : t("email.reply.never"))}
      </Text>
    </View>
  );
}

function Quiet({
  label,
  onPress,
  disabled,
  styles,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  styles: Styles;
  testID?: string;
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
      style={({ pressed }) => [styles.quiet, (pressed || disabled) && styles.dimmed]}
      testID={testID}
    >
      <Text style={styles.quietLabel} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Hold to speak a reply; a tap does `onTap`. */
function MicButton({
  matter,
  voice,
  onTap,
  styles,
  colors,
  label,
}: {
  matter: EmailMatter;
  voice: Voice;
  onTap: () => void;
  styles: Styles;
  colors: Colors;
  label?: boolean;
}) {
  const t = useT();
  const listening = voice.listeningFor === matter.matterId;
  const writing = voice.writingFor === matter.matterId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("email.reply.hold")}
      hitSlop={8}
      delayLongPress={220}
      onPress={onTap}
      onLongPress={() => voice.startHold(matter)}
      onPressOut={voice.releaseHold}
      style={({ pressed }) => [styles.mic, pressed && !listening && styles.dimmed]}
      testID="email-mic"
    >
      <Icon name="mic" size={15} color={listening ? colors.text : colors.textMuted} />
      {label || listening || writing ? (
        <Text style={[styles.quietLabel, listening && styles.listening]} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
          {listening ? t("email.reply.listening") : writing ? t("email.reply.writing") : t("email.reply.holdShort")}
        </Text>
      ) : null}
    </Pressable>
  );
}

// One item ------------------------------------------------------------------------------

export type TodayActions = {
  /** Hands the item to Stella in the chat; the chat shows what happens. */
  ask: (matter: EmailMatter, action: "reply" | "handle" | "suggest" | "tell", text: string) => void;
  read: (matter: EmailMatter) => void;
};

function Item({
  matter,
  now,
  showAccount,
  voice,
  actions,
  onGone,
  styles,
  colors,
}: {
  matter: EmailMatter;
  now: number;
  showAccount: boolean;
  voice: Voice;
  actions: TodayActions;
  onGone: (matter: EmailMatter, how: "done" | "later", at?: number) => void;
  styles: Styles;
  colors: Colors;
}) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const prepared = matter.prepared;
  const editing = voice.editing?.matterId === matter.matterId;
  const listening = voice.listeningFor === matter.matterId;
  const writing = voice.writingFor === matter.matterId;

  const openReply = () => voice.edit(matter, prepared?.kind === "reply" ? prepared.body : "");
  const primary = () => {
    if (!prepared) return;
    tapLight();
    if (prepared.kind === "reply") openReply();
    else actions.ask(matter, "suggest", prepared.ask);
  };
  const later = () => {
    tapLight();
    pickLater(t, locale, matter, now, (at) => onGone(matter, "later", at));
  };
  const sorted = matter.tone === "fyi" ? "worth_knowing" : "needs_you";
  const fail = (error: unknown) => Alert.alert(errorText(error, t("email.failed")));
  const sheet = () => {
    tapMedium();
    const from = matter.from;
    const options: { label: string; destructive?: boolean; run: () => unknown }[] = [
      { label: t("email.today.done"), run: () => onGone(matter, "done") },
      { label: `${t("email.today.later")}…`, run: later },
      { label: t("email.digest.reply"), run: openReply },
      { label: t("email.digest.handle"), run: () => actions.ask(matter, "handle", t("email.digest.askHandle", { from, subject: matter.subject })) },
      { label: t("email.digest.tell"), run: () => actions.ask(matter, "tell", "") },
      { label: t("email.brief.read"), run: () => actions.read(matter) },
      { label: t("email.digest.archive"), run: () => archiveEmail({ itemIds: matter.itemIds }, true).catch(fail) },
      { label: t("email.brief.openGmail"), run: () => openGmailThread(matter.threadId, matter.account) },
      {
        label: sorted === "needs_you" ? t("email.section.moveToWorthKnowing") : t("email.section.moveToNeedsYou"),
        run: () =>
          Promise.all(matter.itemIds.map((id) => correctEmail(id, sorted === "needs_you" ? "worth_knowing" : "needs_you")))
            .then(() => showEmailNotice(t("email.brief.noted")))
            .catch(fail),
      },
      {
        label: t("email.notImportant"),
        destructive: true,
        run: () => Promise.all(matter.itemIds.map((id) => dismissEmail(id))).catch(fail),
      },
    ];
    chooseAction(
      matter.headline,
      options.map(({ label, destructive }) => ({ label, ...(destructive ? { destructive } : {}) })),
      t("common.cancel"),
      (index) => void options[index]?.run(),
    );
  };

  const meta = [
    matter.returnedAt ? t("email.today.back") : null,
    matter.draftedAt ? t("email.status.drafted") : null,
    matter.from,
    matter.itemIds.length > 1 ? tPlural("email.brief.emails", matter.itemIds.length) : matter.subject,
    emailTime(locale, matter.receivedAt, now),
    showAccount ? matter.account : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const Frame = editing ? View : Pressable;
  const content = (
    <Frame {...(editing ? {} : { accessibilityRole: "button" as const, onPress: sheet })} testID="email-today-item">
      <Text style={styles.headline} maxFontSizeMultiplier={SCALE}>
        {matter.headline}
      </Text>
      <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
        {meta}
      </Text>
      {matter.points.map((point, index) => (
        <View key={index} style={styles.point}>
          <Text style={styles.bullet} maxFontSizeMultiplier={SCALE}>
            •
          </Text>
          <Text style={styles.pointText} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
            <Md text={point} boldStyle={styles.bold} />
          </Text>
        </View>
      ))}
      {editing ? (
        <ReplyEditor matter={matter} voice={voice} styles={styles} colors={colors} />
      ) : (
        <View style={styles.controls}>
          {prepared ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t("email.reply.hold")}
              delayLongPress={320}
              onPress={primary}
              onLongPress={() => voice.startHold(matter)}
              onPressOut={voice.releaseHold}
              style={({ pressed }) => [styles.primary, styles.primaryShrink, listening && styles.primaryListening, pressed && !listening && styles.dimmed]}
              testID="email-today-primary"
            >
              {listening ? <Icon name="mic" size={14} color={colors.accentForeground} /> : null}
              <Text style={[styles.primaryLabel, styles.primaryShrink]} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
                {listening ? t("email.reply.listening") : writing ? t("email.reply.writing") : prepared.label}
              </Text>
            </Pressable>
          ) : null}
          {listening || writing ? null : (
            <>
              <Quiet label={t("email.today.later")} onPress={later} styles={styles} testID="email-later" />
              <Quiet label={t("email.today.done")} onPress={() => onGone(matter, "done")} styles={styles} testID="email-done" />
            </>
          )}
          {!prepared || prepared.kind !== "reply" ? (
            <MicButton matter={matter} voice={voice} onTap={openReply} styles={styles} colors={colors} />
          ) : null}
        </View>
      )}
    </Frame>
  );

  if (editing) return content;
  const swipeLabel = (text: string, align: "flex-start" | "flex-end") => (
    <View style={[styles.swipe, { alignItems: align }]}>
      <Text style={styles.swipeLabel} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
        {text}
      </Text>
    </View>
  );
  return (
    <ReanimatedSwipeable
      friction={1.4}
      leftThreshold={72}
      rightThreshold={72}
      overshootFriction={8}
      renderLeftActions={() => swipeLabel(t("email.today.done"), "flex-start")}
      renderRightActions={() =>
        swipeLabel(`${t("email.today.later")} · ${whenLabel(locale, laterChoices(now, matter.laterSuggestion)[0]?.at ?? now + 86_400_000, now)}`, "flex-end")
      }
      onSwipeableWillOpen={(direction) => {
        tapMedium();
        if (direction === SwipeDirection.RIGHT) onGone(matter, "done");
        else onGone(matter, "later", laterChoices(now, matter.laterSuggestion)[0]?.at);
      }}
    >
      {content}
    </ReanimatedSwipeable>
  );
}

/** The native list of Later times: Stella's suggestion first, as "{when} · {why}". */
const pickLater = (t: T, locale: string, matter: EmailMatter, now: number, onLater: (at: number) => void) => {
  const choices = laterChoices(now, matter.laterSuggestion);
  const words: Record<LaterChoiceId, string> = {
    suggested: matter.laterSuggestion.why,
    tonight: t("email.today.laterTonight"),
    tomorrow: t("email.today.laterTomorrow"),
    weekend: t("email.today.laterWeekend"),
    nextWeek: t("email.today.laterNextWeek"),
  };
  chooseAction(
    t("email.today.later"),
    choices.map((choice) => ({
      label:
        choice.id === "suggested" && words.suggested
          ? t("email.today.laterSuggested", { when: whenLabel(locale, choice.at, now), why: words.suggested })
          : `${words[choice.id] || whenLabel(locale, choice.at, now)} · ${whenLabel(locale, choice.at, now)}`,
    })),
    t("common.cancel"),
    (index) => {
      const choice = choices[index];
      if (choice) onLater(choice.at);
    },
  );
};

// Left out, by sender --------------------------------------------------------------------

function LeftOut({ senders, now, styles }: { senders: EmailNoiseSender[]; now: number; styles: Styles }) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [state, setState] = useState<Record<string, string>>({});
  const shown = senders.filter((sender) => state[sender.address] !== "cleared");
  if (shown.length === 0) return null;
  const run = (address: string, work: () => Promise<"unsubscribed" | "cleared" | "page">) => {
    setState((current) => ({ ...current, [address]: "busy" }));
    void work()
      .then((done) => setState((current) => ({ ...current, [address]: done })))
      .catch((error: unknown) => setState((current) => ({ ...current, [address]: errorText(error, t("email.failed")) })));
  };
  // People marked not important stay apart from newsletters and notifications.
  const groups = [
    { key: "lists", title: t("email.cleanup.title"), hint: t("email.cleanup.hint"), senders: shown.filter((sender) => !sender.person) },
    { key: "people", title: t("email.cleanup.peopleTitle"), hint: t("email.cleanup.peopleHint"), senders: shown.filter((sender) => sender.person) },
  ];
  const row = (sender: EmailNoiseSender) => {
    const status = state[sender.address];
    const unsubscribed = sender.unsubscribed || status === "unsubscribed";
    const note =
      status === "page" ? t("email.cleanup.openedPage") : status && !["busy", "unsubscribed", "cleared"].includes(status) ? status : null;
    return (
      <View key={sender.address} style={styles.row} testID="email-left-out-sender">
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
            {sender.name}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
            {tPlural("email.brief.emails", sender.count)} · {sender.latestSubject} · {emailTime(locale, sender.latestAt, now)}
          </Text>
          {note ? (
            <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE}>
              {note}
            </Text>
          ) : null}
        </View>
        <View style={styles.rowActions}>
          {sender.unsubscribe ? (
            unsubscribed ? (
              <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE}>
                {t("email.cleanup.unsubscribed")}
              </Text>
            ) : (
              <Quiet
                label={t("email.cleanup.unsubscribe")}
                disabled={status === "busy"}
                onPress={() =>
                  run(sender.address, async () => {
                    const result = await getBackendClient().call("email.unsubscribe", { address: sender.address });
                    if (result.done) return "unsubscribed";
                    if (result.url) void Linking.openURL(result.url).catch(() => undefined);
                    return "page";
                  })
                }
                styles={styles}
              />
            )
          ) : null}
          <Quiet
            label={t("email.cleanup.clearAll")}
            disabled={status === "busy"}
            onPress={() =>
              run(sender.address, async () => {
                await getBackendClient().call("email.clearSender", { address: sender.address });
                return "cleared";
              })
            }
            styles={styles}
            testID="email-clear-sender"
          />
        </View>
      </View>
    );
  };
  return (
    <>
      {groups.map((group) =>
        group.senders.length > 0 ? (
          <View key={group.key} style={styles.after} testID={group.key === "people" ? "email-left-out-people" : "email-left-out"}>
            <Text style={styles.heading} maxFontSizeMultiplier={SCALE}>
              {group.title}
            </Text>
            <Text style={styles.hint} maxFontSizeMultiplier={SCALE}>
              {group.hint}
            </Text>
            {group.senders.map(row)}
          </View>
        ) : null,
      )}
    </>
  );
}

// Put off and settled ---------------------------------------------------------------------

const statusWords = (t: T, locale: string, matter: EmailMatter, now: number): string => {
  if (matter.status === "later" && matter.laterUntil) return t("email.status.later", { when: whenLabel(locale, matter.laterUntil, now) });
  if (matter.status === "open") return t("email.status.open");
  switch (matter.settledHow) {
    case "replied":
      return t("email.status.replied");
    case "drafted":
      return t("email.status.drafted");
    case "handled":
      return t("email.status.handled");
    case "archived":
      return t("email.status.archived");
    case "replied_in_gmail":
      return t("email.status.repliedInGmail");
    case "archived_in_gmail":
      return t("email.status.archivedInGmail");
    default:
      return t("email.status.done");
  }
};

function Folded({ label, matters, now, styles, testID }: { label: string; matters: EmailMatter[]; now: number; styles: Styles; testID: string }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reopened, setReopened] = useState<ReadonlySet<string>>(new Set());
  if (matters.length === 0) return null;
  return (
    <View style={styles.folded} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tapLight();
          setOpen((value) => !value);
        }}
        style={styles.foldLine}
      >
        <Text style={styles.foldLabel} maxFontSizeMultiplier={SCALE}>
          {label}
        </Text>
        <Text style={styles.quietLabel} maxFontSizeMultiplier={SCALE}>
          {open ? t("email.brief.hide") : t("email.brief.show")}
        </Text>
      </Pressable>
      {open
        ? matters.map((matter) => (
            <View key={matter.matterId} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
                  {matter.headline}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
                  {reopened.has(matter.matterId) ? t("email.status.open") : statusWords(t, locale, matter, now)}
                </Text>
              </View>
              {reopened.has(matter.matterId) ? null : (
                <Quiet
                  label={t("email.today.reopen")}
                  onPress={() => {
                    setReopened((current) => new Set([...current, matter.matterId]));
                    void settle(matter.matterId, "open").catch((error: unknown) => {
                      setReopened((current) => new Set([...current].filter((id) => id !== matter.matterId)));
                      Alert.alert(errorText(error, t("email.failed")));
                    });
                  }}
                  styles={styles}
                  testID="email-reopen"
                />
              )}
            </View>
          ))
        : null}
    </View>
  );
}

// Today -----------------------------------------------------------------------------------

/**
 * One living list: what is open now, urgent first, each item headlined by its
 * outcome with its next step prepared. Done and Later take it away (swipe right
 * and left too); new mail joins; what was put off comes back on its own.
 * Not scrollable itself.
 */
/**
 * What stops or limits email, said plainly with what unlocks more: sorting paused because the
 * allowance or the day's limit is used up, the owner's own key refused, or Free's sorting-only taste.
 * Keys are added in the chat settings panel, so "Use my OpenRouter key" opens it over Chat.
 */
export function AccessNotice({ access }: { access: EmailAccess | undefined }) {
  const t = useT();
  const locale = useLocale();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const features = useServerFeatures();
  if (!access) return null;
  const onStella = access.payer === "stella";
  const addKey = () => {
    tapLight();
    router.navigate("/chat");
    setTimeout(() => openChatSettingsAt(providerBrainId("openrouter")), 350);
  };
  const plans =
    onStella && access.plan === "free" && features.billing ? (
      <Pressable accessibilityRole="button" onPress={() => router.push("/settings")} style={({ pressed }) => [styles.quiet, pressed && styles.dimmed]}>
        <Text style={styles.quietLabel} maxFontSizeMultiplier={SCALE}>
          {t("email.access.plans")}
        </Text>
      </Pressable>
    ) : null;
  const keyButton = (primary: boolean) => (
    <Pressable
      accessibilityRole="button"
      onPress={addKey}
      style={({ pressed }) => [primary ? styles.primary : styles.quiet, pressed && styles.dimmed]}
    >
      <Text style={primary ? styles.primaryLabel : styles.quietLabel} maxFontSizeMultiplier={SCALE}>
        {t("email.access.addKey")}
      </Text>
    </Pressable>
  );
  let title: string | null = null;
  let body: string;
  let primary = true;
  if (access.ownKeyRefused) {
    title = t("email.access.refusedTitle");
    body = t("email.access.refusedBody", { reason: access.ownKeyRefused });
  } else if (access.paused) {
    const date = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(access.paused.until);
    title = access.paused.why === "day" ? t("email.access.pausedDayTitle") : t("email.access.pausedMonthTitle", { date });
    body = !onStella
      ? t("email.access.pausedOwnBody")
      : access.paused.why === "day"
        ? t(access.plan === "free" ? "email.access.pausedDayFreeBody" : "email.access.pausedDayBody")
        : t(access.plan === "free" ? "email.access.pausedFreeBody" : "email.access.pausedPaidBody");
  } else if (onStella && !access.writes) {
    body = t("email.access.freeSortingOnly");
    primary = false;
  } else {
    return null;
  }
  const actions = onStella || access.ownKeyRefused;
  return (
    <View style={styles.notice} accessibilityRole={title ? "alert" : undefined}>
      {title ? (
        <Text style={styles.noticeTitle} maxFontSizeMultiplier={SCALE}>
          {title}
        </Text>
      ) : null}
      <Text style={styles.noticeBody} maxFontSizeMultiplier={SCALE}>
        {body}
      </Text>
      {actions ? (
        <View style={styles.noticeActions}>
          {keyButton(primary)}
          {plans}
        </View>
      ) : null}
    </View>
  );
}

export function TodayView({
  today,
  now,
  showAccount,
  actions,
}: {
  today: EmailToday;
  now: number;
  showAccount: boolean;
  actions: TodayActions;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const voice = useVoice();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const open = today.open.filter((matter) => !gone.has(matter.matterId));

  // An item settled here and reopened elsewhere comes back.
  useEffect(() => {
    setGone((current) => {
      const live = new Set(today.open.map((matter) => matter.matterId));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [today.open]);

  const back = (matterId: string) => setGone((current) => new Set([...current].filter((id) => id !== matterId)));
  const onGone = (matter: EmailMatter, how: "done" | "later", at?: number) => {
    setGone((current) => new Set([...current, matter.matterId]));
    if (voice.editing?.matterId === matter.matterId) voice.close();
    const when = at ?? matter.laterSuggestion.at;
    showEmailNotice(
      how === "done"
        ? t("email.today.toastDone", { headline: matter.headline })
        : t("email.today.toastLater", { when: whenLabel(locale, when, now), headline: matter.headline }),
      () => {
        back(matter.matterId);
        void settle(matter.matterId, "open").catch(() => undefined);
      },
    );
    void settle(matter.matterId, how, how === "later" ? when : undefined).catch((error: unknown) => {
      back(matter.matterId);
      Alert.alert(errorText(error, t("email.failed")));
    });
  };

  return (
    <View testID="email-today">
      <AccessNotice access={today.access} />
      {open.length > 0 && today.lead ? (
        <Text style={styles.lead} maxFontSizeMultiplier={SCALE}>
          <Md text={today.lead} boldStyle={styles.leadBold} />
        </Text>
      ) : null}
      {open.length === 0 ? (
        <Text style={[styles.lead, styles.leadQuiet]} maxFontSizeMultiplier={SCALE}>
          {t("email.today.allClear")}
        </Text>
      ) : null}
      {TODAY_TONES.map((tone) => {
        const matters = open.filter((matter) => matter.tone === tone);
        if (matters.length === 0) return null;
        return (
          <View key={tone} style={styles.section}>
            <View style={styles.headingRow}>
              {tone === "urgent" ? <View style={styles.dot} /> : null}
              <Text style={[styles.heading, tone !== "fyi" && styles.headingStrong]} maxFontSizeMultiplier={SCALE}>
                {tone === "urgent" ? t("email.section.urgent") : tone === "needs_you" ? t("email.section.needsYou") : t("email.section.worthKnowing")}
              </Text>
            </View>
            <View style={styles.items}>
              {matters.map((matter) => (
                <Item
                  key={matter.matterId}
                  matter={matter}
                  now={now}
                  showAccount={showAccount}
                  voice={voice}
                  actions={actions}
                  onGone={onGone}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </View>
          </View>
        );
      })}
      <View style={styles.foldedGroup}>
        <Folded label={tPlural("email.today.inLater", today.later.length)} matters={today.later} now={now} styles={styles} testID="email-in-later" />
        <Folded
          label={tPlural("email.today.doneToday", today.doneToday.length)}
          matters={today.doneToday}
          now={now}
          styles={styles}
          testID="email-done-today"
        />
      </View>
      <LeftOut senders={today.noise} now={now} styles={styles} />
    </View>
  );
}

// History and the log ---------------------------------------------------------------------

const logLine = (t: T, tPlural: TPlural, locale: string, entry: EmailLogEntry, now: number): string => {
  const subject = entry.subject ?? "";
  const who = entry.who ?? "";
  switch (entry.kind) {
    case "briefed":
      return tPlural("email.log.briefed", entry.count ?? 0);
    case "urgent":
      return t("email.log.urgent", { subject });
    case "rule":
      return t("email.log.rule", { subject });
    case "sent":
      return t("email.log.sent", { who });
    case "drafted":
      return t("email.log.drafted", { who });
    case "done":
      return t("email.log.done", { subject });
    case "later":
      return t("email.log.later", { subject, when: entry.until ? whenLabel(locale, entry.until, now) : "" });
    case "returned":
      return t("email.log.returned", { subject });
    case "reopened":
      return t("email.log.reopened", { subject });
    case "handled":
      return t("email.log.handled", { subject });
    case "archived":
      return t("email.log.archived", { subject });
    case "unsubscribed":
      return t("email.log.unsubscribed", { who });
    case "cleared":
      return tPlural("email.log.cleared", entry.count ?? 0, { who });
    case "replied_in_gmail":
      return t("email.log.repliedInGmail", { subject });
    case "archived_in_gmail":
      return t("email.log.archivedInGmail", { subject });
  }
};

const dayTitle = (t: T, locale: string, day: string, now: number): string => {
  const [year, month, date] = day.split("-").map(Number);
  const at = new Date(year!, month! - 1, date!, 12).getTime();
  if (new Date(at).toDateString() === new Date(now).toDateString()) return t("email.history.today");
  if (new Date(at).toDateString() === new Date(now - 86_400_000).toDateString()) return t("email.history.yesterday");
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(at);
};

export function HistoryView({ history, now, onRead }: { history: EmailHistory | undefined; now: number; onRead: (matter: EmailMatter) => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  if (!history) return <ActivityIndicator color={colors.textMuted} style={styles.loading} />;
  const time = (at: number) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);
  return (
    <View testID="email-history">
      <Text style={styles.hint} maxFontSizeMultiplier={SCALE}>
        {t("email.log.hint")}
      </Text>
      {history.days.length === 0 ? (
        <Text style={[styles.lead, styles.leadQuiet, styles.gapTop]} maxFontSizeMultiplier={SCALE}>
          {t("email.history.empty")}
        </Text>
      ) : null}
      {history.days.map((day) => (
        <View key={day.day} style={styles.day}>
          <Text style={styles.dayTitle} maxFontSizeMultiplier={SCALE}>
            {dayTitle(t, locale, day.day, now)}
          </Text>
          <Text style={styles.meta} maxFontSizeMultiplier={SCALE}>
            {tPlural("email.log.read", day.read, { leftOut: day.leftOut })}
          </Text>
          {day.arrived.length > 0 ? (
            <>
              <Text style={[styles.heading, styles.subHeading]} maxFontSizeMultiplier={SCALE}>
                {t("email.history.cameIn")}
              </Text>
              {day.arrived.map((matter) => (
                <Pressable
                  key={matter.matterId}
                  accessibilityRole="button"
                  onPress={() => {
                    tapLight();
                    onRead(matter);
                  }}
                  style={({ pressed }) => [styles.logRow, pressed && styles.dimmed]}
                >
                  <Text style={styles.logTime} maxFontSizeMultiplier={SCALE}>
                    {time(matter.arrivedAt)}
                  </Text>
                  <View style={styles.rowMain}>
                    <Text style={styles.logWhat} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
                      {matter.headline}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
                      {statusWords(t, locale, matter, now)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}
          {(() => {
            const { stella, user } = splitEmailLog(day.log);
            return (
              [
                ["stella", "email.log.title", stella],
                ["user", "email.log.yours", user],
              ] as const
            ).map(([who, title, entries]) =>
              entries.length > 0 ? (
                <View key={who} testID={`email-history-${who}`}>
                  <Text style={[styles.heading, styles.subHeading]} maxFontSizeMultiplier={SCALE}>
                    {t(title)}
                  </Text>
                  {entries.map((entry, index) => (
                    <View key={`${entry.at}-${index}`} style={styles.logRow}>
                      <Text style={styles.logTime} maxFontSizeMultiplier={SCALE}>
                        {time(entry.at)}
                      </Text>
                      <Text style={[styles.logWhat, styles.logPlain]} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
                        {logLine(t, tPlural, locale, entry, now)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null,
            );
          })()}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    loading: { alignItems: "center", paddingVertical: 32 },
    lead: { color: colors.textBase, fontFamily: fonts.sans.medium, fontSize: 17.5, letterSpacing: -0.3, lineHeight: 25 },
    leadBold: { color: colors.text, fontFamily: fonts.sans.bold },
    leadQuiet: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 16, lineHeight: 23 },
    gapTop: { marginTop: 18 },
    section: { marginTop: 28 },
    headingRow: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 12 },
    dot: { backgroundColor: colors.accent, borderRadius: 3, height: 6, width: 6 },
    heading: { color: colors.textMuted, fontFamily: fonts.sans.semiBold, fontSize: 13 },
    headingStrong: { color: colors.text },
    items: { gap: 26 },
    headline: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 16.5, letterSpacing: -0.25, lineHeight: 22 },
    meta: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
    point: { flexDirection: "row", gap: 8, marginTop: 6, paddingRight: 4 },
    bullet: { color: colors.textMuted, fontSize: 14.5, lineHeight: 20 },
    pointText: { color: colors.textBase, flex: 1, fontFamily: fonts.sans.regular, fontSize: 14.5, lineHeight: 20 },
    bold: { color: colors.text, fontFamily: fonts.sans.semiBold },
    controls: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 12 },
    primary: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 10,
      flexDirection: "row",
      gap: 6,
      height: 34,
      justifyContent: "center",
      paddingHorizontal: 13,
    },
    primaryShrink: { flexShrink: 1 },
    primaryListening: { opacity: 0.85 },
    primaryLabel: { color: colors.accentForeground, fontFamily: fonts.sans.semiBold, fontSize: 14 },
    quiet: { paddingVertical: 4 },
    notice: { marginBottom: 22 },
    noticeTitle: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 16, lineHeight: 22, marginBottom: 4 },
    noticeBody: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 20 },
    noticeActions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 10 },
    quietLabel: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 14 },
    listening: { color: colors.text },
    mic: { alignItems: "center", flexDirection: "row", gap: 5, paddingVertical: 4 },
    dimmed: { opacity: 0.5 },
    swipe: { justifyContent: "center", paddingHorizontal: 4, width: 150 },
    swipeLabel: { color: colors.textMuted, fontFamily: fonts.sans.semiBold, fontSize: 14 },
    reply: { marginTop: 14 },
    replyTo: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 13 },
    replyText: {
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 8,
      minHeight: 96,
      paddingBottom: 10,
      paddingHorizontal: 0,
      paddingTop: 10,
      textAlignVertical: "top",
    },
    replyNote: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 17, marginTop: 8 },
    foldedGroup: { marginTop: 30 },
    folded: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    foldLine: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
    foldLabel: { color: colors.textBase, fontFamily: fonts.sans.semiBold, fontSize: 14 },
    after: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 30, paddingTop: 16 },
    hint: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 18, marginTop: 4 },
    row: {
      alignItems: "center",
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 12,
      paddingVertical: 10,
    },
    rowMain: { flex: 1, gap: 2, minWidth: 0 },
    rowTitle: { color: colors.text, fontFamily: fonts.sans.medium, fontSize: 14.5, lineHeight: 20 },
    rowSub: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 17 },
    rowActions: { alignItems: "flex-end", gap: 2 },
    day: { marginTop: 28 },
    dayTitle: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 17, letterSpacing: -0.25 },
    subHeading: { marginBottom: 2, marginTop: 18 },
    logRow: { alignItems: "flex-start", flexDirection: "row", gap: 12, paddingVertical: 7 },
    logTime: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12.5, fontVariant: ["tabular-nums"], lineHeight: 20, width: 52 },
    logWhat: { color: colors.text, fontFamily: fonts.sans.medium, fontSize: 14.5, lineHeight: 20 },
    logPlain: { color: colors.textBase, flex: 1, fontFamily: fonts.sans.regular },
    noticeBar: {
      alignItems: "center",
      backgroundColor: colors.background,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      bottom: 0,
      flexDirection: "row",
      gap: 16,
      left: 0,
      paddingTop: 12,
      position: "absolute",
      right: 0,
    },
    noticeText: { color: colors.textBase, flex: 1, fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 19 },
    noticeUndo: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 14.5 },
  });
