import {
  createContext,
  Fragment,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Text } from "./Text";
import type {
  UserAsk,
  UserAskAnswerFieldValue,
  UserAskField,
  UserAskSecureInputDetail,
} from "@stella/contracts/user-ask";
import {
  USER_ASK_MAX_NOTE,
  userAskFieldInputKind,
  userAskOffersRemember,
} from "@stella/contracts/user-ask";
import {
  EMPTY_USER_ASK_DRAFT,
  nextUnansweredIndex,
  pickUserAskOption,
  skipUserAskQuestion,
  typeUserAskText,
  userAskDeckAnswers,
  userAskDeckComplete,
  userAskDeckEntries,
  userAskDeckKey,
  userAskRecordFromAnswer,
  userAskSecureRecord,
  type UserAskRecord,
  type UserAskDraft,
  type UserAskDrafts,
} from "@stella/contracts/user-ask-deck";
import Reanimated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  LinearTransition,
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useScrollViewOffset,
  useSharedValue,
} from "react-native-reanimated";
import { tapLight } from "../lib/haptics";
import {
  answerUserAsk,
  cancelUserAsk,
  recordUserAskAnswer,
  useConversationUserAsks,
  useResolveFocusedUserAsk,
  useUserAskOriginLabel,
  useUserAskSync,
} from "../lib/user-asks";
import { canSealUserAskValue, sealUserAskValue } from "../lib/user-ask-seal";
import {
  rememberOnDevices,
  rememberedByPhone,
  useSavedLogin,
} from "../lib/saved-values";
import { useT } from "../i18n";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import { Icon } from "./Icon";
import { useAskSlot } from "./chat/ask-slot";

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const useRemaining = (deadlineAt: number | undefined): number | null => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineAt === undefined) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadlineAt]);
  return deadlineAt === undefined ? null : Math.max(0, deadlineAt - now);
};

const NO_FILLS: Readonly<Record<string, string>> = {};

const slotStyles = StyleSheet.create({ deckSlot: { alignSelf: "stretch" } });

export function UserAskCard({
  conversationId,
}: {
  conversationId: string | null | undefined;
}) {
  useUserAskSync(true);
  const { questions, secureInput, focused } =
    useConversationUserAsks(conversationId);
  const showSecure =
    secureInput !== null &&
    (questions.length === 0 || focused?.askId === secureInput.askId);
  useResolveFocusedUserAsk(focused?.askId ?? null);
  if (showSecure && secureInput?.detail.kind === "secure_input") {
    return (
      <SecureAskSurface
        ask={secureInput}
        detail={secureInput.detail}
        key={secureInput.askId}
      />
    );
  }
  if (questions.length === 0) return null;
  return (
    <Reanimated.View
      style={slotStyles.deckSlot}
      entering={FadeInDown.springify().damping(20).stiffness(190)}
      exiting={FadeOutDown.duration(180)}
      layout={LinearTransition.springify().damping(22).stiffness(200)}
    >
      <QuestionDeck
        asks={questions}
        focusedAskId={focused?.kind === "question" ? focused.askId : null}
      />
    </Reanimated.View>
  );
}

export function UserAskRecordView({ record }: { record: UserAskRecord }) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.record}>
      {record.answers.map((answer, index) => (
        <View key={`${record.id}:${index}`} style={styles.recordItem}>
          <Text style={styles.recordQuestion}>{answer.question}</Text>
          <Text
            style={[
              styles.recordAnswer,
              answer.kind === "skipped" && styles.recordAnswerSkipped,
            ]}
          >
            {answer.kind === "provided" || answer.kind === "declined"
              ? t(`userAsk.secureInput.${answer.kind}`)
              : answer.kind === "skipped"
                ? t("userAsk.question.skipped")
                : answer.answer}
            {record.defaulted ? (
              <Text style={styles.recordTag}>
                {"  "}
                {t("userAsk.question.default")}
              </Text>
            ) : null}
          </Text>
          {(answer.kind === "provided" || answer.kind === "declined") &&
          answer.answer ? (
            <Text style={styles.recordNote}>{answer.answer}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function DeckTiming({
  ask,
  colors,
  styles,
  t,
}: {
  ask: UserAsk;
  colors: Colors;
  styles: AskStyles;
  t: Translate;
}) {
  const remaining = useRemaining(ask.blocking ? undefined : ask.deadlineAt);
  if (remaining === null) return null;
  return (
    <View
      accessibilityLabel={t("userAsk.deadline.remaining", {
        time: formatRemaining(remaining),
      })}
      accessibilityRole="timer"
      style={styles.timingRow}
    >
      <Icon color={colors.textMuted} name="clock" size={14} />
      <Text numberOfLines={1} style={styles.timing}>
        {formatRemaining(remaining)}
      </Text>
    </View>
  );
}

const CARD_BORDER = StyleSheet.hairlineWidth * 2;
const UNBOUNDED_CARD = 100_000;

type AskFieldFocus = {
  focus: (target: View | null) => void;
  blur: (target: View | null) => void;
};

const AskFieldFocusContext = createContext<AskFieldFocus>({
  focus: () => {},
  blur: () => {},
});

/** Keeps the field wrapped by `ref` in view inside the card while its input has focus. */
function useAskFieldAnchor() {
  const { focus, blur } = useContext(AskFieldFocusContext);
  const ref = useRef<View>(null);
  const onFocus = useCallback(() => focus(ref.current), [focus]);
  const onBlur = useCallback(() => blur(ref.current), [blur]);
  return { ref, onFocus, onBlur };
}

function AskFieldRow({
  style,
  children,
}: {
  style: StyleProp<ViewStyle>;
  children: (anchor: ReturnType<typeof useAskFieldAnchor>) => ReactNode;
}) {
  const anchor = useAskFieldAnchor();
  return (
    <View ref={anchor.ref} style={style}>
      {children(anchor)}
    </View>
  );
}

function AskCardFrame({
  summary,
  progress,
  leading,
  body,
  footer,
  footerDivider = true,
  colors,
  styles,
}: {
  summary: string;
  progress?: string;
  leading?: ReactNode;
  body: ReactNode;
  footer: ReactNode;
  footerDivider?: boolean;
  colors: Colors;
  styles: AskStyles;
}) {
  const { collapsed, maxHeight, naturalHeight, expand } = useAskSlot();
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  const scrollOffset = useScrollViewOffset(scrollRef);
  const contentRef = useRef<View>(null);
  const focusedRef = useRef<View | null>(null);
  const contentHeight = useSharedValue(0);
  const footerHeight = useSharedValue(0);
  const focusTop = useSharedValue(0);
  const focusBottom = useSharedValue(0);
  const focusActive = useSharedValue(false);
  const [overflowing, setOverflowing] = useState(false);

  const viewportHeight = useDerivedValue(() => {
    const limit = maxHeight ? maxHeight.value : UNBOUNDED_CARD;
    return Math.min(
      contentHeight.value,
      limit - footerHeight.value - CARD_BORDER,
    );
  });

  const cardHeightStyle = useAnimatedStyle(() => ({
    maxHeight: maxHeight ? maxHeight.value : UNBOUNDED_CARD,
  }));

  useAnimatedReaction(
    () => contentHeight.value > viewportHeight.value + 1,
    (next, previous) => {
      if (next !== previous) runOnJS(setOverflowing)(next);
    },
  );

  useAnimatedReaction(
    () => contentHeight.value + footerHeight.value + CARD_BORDER,
    (next) => {
      if (naturalHeight) naturalHeight.value = next;
    },
  );
  useEffect(
    () => () => {
      if (naturalHeight) naturalHeight.value = 0;
    },
    [naturalHeight],
  );

  useAnimatedReaction(
    () =>
      focusActive.value
        ? {
            viewport: viewportHeight.value,
            content: contentHeight.value,
            top: focusTop.value,
            bottom: focusBottom.value,
          }
        : null,
    (anchor) => {
      if (!anchor || anchor.viewport <= 0) return;
      const offset = scrollOffset.value;
      let next = offset;
      if (anchor.bottom > next + anchor.viewport) {
        next = anchor.bottom - anchor.viewport;
      }
      if (anchor.top < next) next = anchor.top;
      next = Math.min(
        Math.max(0, next),
        Math.max(0, anchor.content - anchor.viewport),
      );
      if (Math.abs(next - offset) > 0.5) scrollTo(scrollRef, 0, next, false);
    },
  );

  const measureFocused = useCallback(() => {
    const target = focusedRef.current;
    const content = contentRef.current;
    if (!target || !content) return;
    target.measureLayout(content, (_x, y, _width, height) => {
      if (focusedRef.current !== target) return;
      focusTop.value = y;
      focusBottom.value = y + height;
      focusActive.value = true;
    });
  }, [focusActive, focusBottom, focusTop]);

  const fieldFocus = useMemo<AskFieldFocus>(
    () => ({
      focus: (target) => {
        focusedRef.current = target;
        measureFocused();
      },
      blur: (target) => {
        if (focusedRef.current !== target) return;
        focusedRef.current = null;
        focusActive.value = false;
      },
    }),
    [focusActive, measureFocused],
  );

  const onContentLayout = useCallback(
    (e: LayoutChangeEvent) => {
      contentHeight.value = e.nativeEvent.layout.height;
      if (focusedRef.current) measureFocused();
    },
    [contentHeight, measureFocused],
  );
  const onFooterLayout = useCallback(
    (e: LayoutChangeEvent) => {
      footerHeight.value = e.nativeEvent.layout.height;
    },
    [footerHeight],
  );

  return (
    <>
      {collapsed ? (
        <Reanimated.View entering={FadeIn.duration(160)}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: false }}
            accessibilityLabel={summary}
            onPress={expand}
            style={({ pressed }) => [
              styles.collapsedRow,
              pressed && styles.pressed,
            ]}
          >
            {leading}
            <Text numberOfLines={1} style={styles.collapsedText}>
              {summary}
            </Text>
            {progress ? (
              <Text numberOfLines={1} style={styles.collapsedMeta}>
                {progress}
              </Text>
            ) : null}
            <View style={styles.collapsedChevron}>
              <Icon color={colors.textMuted} name="chevron-down" size={15} />
            </View>
          </Pressable>
        </Reanimated.View>
      ) : null}
      <Reanimated.View
        accessibilityRole="summary"
        style={[
          styles.card,
          cardHeightStyle,
          collapsed && styles.cardCollapsed,
        ]}
      >
        <AskFieldFocusContext.Provider value={fieldFocus}>
          <Reanimated.ScrollView
            ref={scrollRef}
            alwaysBounceVertical={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={overflowing}
            showsVerticalScrollIndicator={overflowing}
            style={styles.cardScroll}
          >
            <View
              ref={contentRef}
              onLayout={onContentLayout}
              style={styles.cardScrollContent}
            >
              {body}
            </View>
          </Reanimated.ScrollView>
          <View
            onLayout={onFooterLayout}
            style={[
              styles.cardFooter,
              footerDivider && overflowing && styles.cardFooterDivided,
            ]}
          >
            {footer}
          </View>
        </AskFieldFocusContext.Provider>
      </Reanimated.View>
    </>
  );
}

function QuestionDeck({
  asks,
  focusedAskId,
}: {
  asks: readonly UserAsk[];
  focusedAskId: string | null;
}) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const entries = useMemo(() => userAskDeckEntries(asks), [asks]);
  const [drafts, setDrafts] = useState<UserAskDrafts>({});
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    if (!focusedAskId) return;
    const target = entries.find((entry) => entry.ask.askId === focusedAskId);
    if (target) setCurrentKey(target.key);
  }, [entries, focusedAskId]);

  const found = entries.findIndex((entry) => entry.key === currentKey);
  const index =
    found >= 0 ? found : (nextUnansweredIndex(entries, drafts, -1) ?? 0);
  const entry = entries[index];
  const total = entries.length;
  const entryKey = entry?.key ?? null;

  useEffect(() => {
    if (entryKey && entryKey !== currentKey) setCurrentKey(entryKey);
  }, [currentKey, entryKey]);
  const complete = userAskDeckComplete(entries, drafts);

  const submit = useCallback(
    async (finalDrafts: UserAskDrafts) => {
      if (busy) return;
      setBusy(true);
      setIssue(null);
      const answers = userAskDeckAnswers(entries, finalDrafts);
      const results = await Promise.allSettled(answers.map(answerUserAsk));
      answers.forEach((answer, index) => {
        if (results[index]?.status !== "fulfilled") return;
        const ask = entries.find(
          (entry) => entry.ask.askId === answer.askId,
        )?.ask;
        if (ask) {
          recordUserAskAnswer(
            ask.conversationId,
            userAskRecordFromAnswer(entries, finalDrafts, ask),
          );
        }
      });
      setBusy(false);
      if (results.some((result) => result.status === "rejected")) {
        setIssue(t("mobile.userAsk.answerFailed"));
      }
    },
    [busy, entries, t],
  );

  const goTo = useCallback(
    (nextIndex: number) => {
      const target = entries[nextIndex];
      if (target) setCurrentKey(target.key);
    },
    [entries],
  );

  const commit = useCallback(
    (draft: UserAskDraft) => {
      if (!entry || busy) return;
      tapLight();
      Keyboard.dismiss();
      const nextDrafts = { ...drafts, [entry.key]: draft };
      setDrafts(nextDrafts);
      const next = nextUnansweredIndex(entries, nextDrafts, index);
      if (next === null) {
        void submit(nextDrafts);
        return;
      }
      goTo(next);
    },
    [busy, drafts, entries, entry, goTo, index, submit],
  );

  if (!entry) return null;
  const { ask, question } = entry;
  const draft = drafts[entry.key] ?? EMPTY_USER_ASK_DRAFT;
  const typed = draft.text.trim().length > 0;
  const textChosen = !draft.choiceId && !draft.skipped && typed;

  const body = (
    <>
      <Reanimated.View
        key={userAskDeckKey(ask.askId, question.id)}
        entering={FadeIn.duration(180)}
        style={styles.step}
      >
        <Text style={styles.title}>{question.question}</Text>
        {question.detail ? (
          <Text style={styles.detail}>{question.detail}</Text>
        ) : null}

        <View style={styles.options} accessibilityRole="radiogroup">
          {question.options.map((option, optionIndex) => {
            const selected = draft.choiceId === option.id;
            const previousSelected =
              optionIndex > 0 &&
              draft.choiceId === question.options[optionIndex - 1]?.id;
            return (
              <Fragment key={option.id}>
                {optionIndex > 0 ? (
                  <View
                    style={[
                      styles.divider,
                      (selected || previousSelected) && styles.dividerHidden,
                    ]}
                  />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => commit(pickUserAskOption(draft, option.id))}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.optionSelected,
                    pressed && styles.pressed,
                    busy && styles.disabled,
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    {option.hint ? (
                      <Text style={styles.optionHint}>{option.hint}</Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <Icon color={colors.accent} name="check" size={18} />
                  ) : option.id === question.defaultChoiceId ? (
                    <Text style={styles.optionTag}>
                      {t("userAsk.question.default")}
                    </Text>
                  ) : null}
                </Pressable>
              </Fragment>
            );
          })}
          <View
            style={[
              styles.divider,
              (textChosen ||
                draft.choiceId ===
                  question.options[question.options.length - 1]?.id) &&
                styles.dividerHidden,
            ]}
          />

          <AskFieldRow
            style={[styles.other, textChosen && styles.optionSelected]}
          >
            {(anchor) => (
              <>
                <AskTextInput
                  accessibilityLabel={t("userAsk.question.somethingElse")}
                  onBlur={anchor.onBlur}
                  onFocus={anchor.onFocus}
                  colors={colors}
                  editable={!busy}
                  multiline
                  onChangeText={(text) =>
                    setDrafts((current) => ({
                      ...current,
                      [entry.key]: typeUserAskText(text),
                    }))
                  }
                  placeholder={t("userAsk.question.somethingElse")}
                  style={styles.otherInput}
                  submitBehavior="blurAndSubmit"
                  onSubmitEditing={() => {
                    if (typed) commit(typeUserAskText(draft.text));
                  }}
                  returnKeyType="done"
                  value={draft.text}
                />
                {typed ? (
                  <Reanimated.View
                    entering={FadeIn.duration(140)}
                    exiting={FadeOut.duration(120)}
                  >
                    <Pressable
                      accessibilityLabel={t("userAsk.question.confirm")}
                      accessibilityRole="button"
                      disabled={busy}
                      hitSlop={6}
                      onPress={() => commit(typeUserAskText(draft.text))}
                      style={({ pressed }) => [
                        styles.otherConfirm,
                        busy && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Icon
                        color={colors.accentForeground}
                        name="check"
                        size={18}
                      />
                    </Pressable>
                  </Reanimated.View>
                ) : null}
              </>
            )}
          </AskFieldRow>
        </View>
      </Reanimated.View>

      {issue ? <Text style={styles.issue}>{issue}</Text> : null}
    </>
  );

  const footer = (
    <View style={styles.footer}>
      <View style={styles.footerStart}>
        <DeckTiming ask={ask} colors={colors} styles={styles} t={t} />
      </View>
      {total > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityLabel={t("userAsk.question.previous")}
            accessibilityRole="button"
            disabled={index === 0}
            hitSlop={6}
            onPress={() => {
              tapLight();
              goTo(index - 1);
            }}
            style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
          >
            <Icon
              color={index === 0 ? colors.textWeaker : colors.text}
              name="chevron-left"
              size={20}
            />
          </Pressable>
          <Text style={styles.progress}>
            {t("userAsk.question.progress", { current: index + 1, total })}
          </Text>
          <Pressable
            accessibilityLabel={t("userAsk.question.next")}
            accessibilityRole="button"
            disabled={index === total - 1}
            hitSlop={6}
            onPress={() => {
              tapLight();
              goTo(index + 1);
            }}
            style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
          >
            <Icon
              color={index === total - 1 ? colors.textWeaker : colors.text}
              name="chevron-right"
              size={20}
            />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.footerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            selected: draft.skipped === true,
            disabled: busy,
          }}
          disabled={busy}
          onPress={() => commit(skipUserAskQuestion(draft))}
          style={({ pressed }) => [
            styles.skip,
            draft.skipped && styles.skipSelected,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          {draft.skipped ? (
            <Icon color={colors.text} name="check" size={15} />
          ) : null}
          <Text
            style={[styles.skipText, draft.skipped && styles.skipTextSelected]}
          >
            {draft.skipped
              ? t("userAsk.question.skipped")
              : t("userAsk.question.skip")}
          </Text>
        </Pressable>
        {total > 1 && complete ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              tapLight();
              void submit(drafts);
            }}
            style={({ pressed }) => [
              styles.primaryAction,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            <Text style={styles.primaryActionText}>
              {busy
                ? t("userAsk.question.sending")
                : t("userAsk.question.submit")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <AskCardFrame
      body={body}
      colors={colors}
      footer={footer}
      progress={
        total > 1
          ? t("userAsk.question.progress", { current: index + 1, total })
          : undefined
      }
      styles={styles}
      summary={question.question}
    />
  );
}

function SecureAskSurface({
  ask,
  detail,
}: {
  ask: UserAsk;
  detail: UserAskSecureInputDetail;
}) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const offersRemember = userAskOffersRemember(detail);
  const [remember, setRemember] = useState(true);
  const remaining = useRemaining(ask.blocking ? undefined : ask.deadlineAt);
  const sealable = canSealUserAskValue(ask.recipientKey);
  const originLabel = useUserAskOriginLabel(ask.originDeviceId);
  const needsComputer =
    !sealable && detail.fields.some((field) => field.sensitive);
  const saved = useSavedLogin(ask, sealable);
  const [typing, setTyping] = useState(false);
  const savedLogin = typing ? null : saved.login;
  const fills = savedLogin?.fills ?? NO_FILLS;
  const askedFields = savedLogin
    ? detail.fields.filter((field) => fills[field.id] === undefined)
    : detail.fields;
  const savedFields = savedLogin
    ? detail.fields.filter((field) => fills[field.id] !== undefined)
    : [];
  const missing = askedFields.some(
    (field) => !field.optional && !(values[field.id] ?? "").trim(),
  );
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    const fillable = saved.login?.fills;
    if (!fillable) return;
    const typedSoFar = valuesRef.current;
    if (
      Object.keys(typedSoFar).some(
        (id) => fillable[id] !== undefined && typedSoFar[id]?.trim(),
      )
    ) {
      setTyping(true);
    }
  }, [saved.login]);
  const inputRefs = useRef(new Map<string, TextInput>());
  const typedFieldIds = askedFields
    .filter((field) => field.type !== "choice")
    .map((field) => field.id);

  const run = useCallback(
    async (work: () => Promise<void>, failureKey: string) => {
      if (busy) return;
      setBusy(true);
      setIssue(null);
      try {
        await work();
      } catch {
        setIssue(t(failureKey));
      } finally {
        setBusy(false);
      }
    },
    [busy, t],
  );

  const decline = useCallback(() => {
    tapLight();
    const trimmed = note.trim();
    void run(async () => {
      await cancelUserAsk(ask.askId, trimmed);
      recordUserAskAnswer(
        ask.conversationId,
        userAskSecureRecord(ask, "declined", trimmed),
      );
    }, "mobile.userAsk.cancelFailed");
  }, [ask, note, run]);

  const send = useCallback(() => {
    setIssue(null);
    const payload: UserAskAnswerFieldValue[] = [];
    const typed: { field: UserAskField; value: string }[] = [];
    for (const field of detail.fields) {
      const fromSaved = fills[field.id];
      const raw = fromSaved ?? (values[field.id] ?? "").trim();
      if (fromSaved === undefined && raw) typed.push({ field, value: raw });
      if (!raw) {
        if (field.optional) continue;
        setIssue(t("mobile.userAsk.missingFields"));
        return;
      }
      if (!ask.recipientKey || !sealable) {
        if (field.sensitive) {
          setIssue(t("mobile.userAsk.sensitiveUnavailable"));
          return;
        }
        payload.push({ fieldId: field.id, kind: "plain", value: raw });
        continue;
      }
      try {
        payload.push({
          fieldId: field.id,
          kind: "sealed",
          sealed: sealUserAskValue({
            askId: ask.askId,
            fieldId: field.id,
            value: raw,
            recipientKey: ask.recipientKey,
          }),
        });
      } catch {
        setIssue(t("mobile.userAsk.sealFailed"));
        return;
      }
    }
    tapLight();
    const trimmedNote = note.trim();
    const rememberHere = savedLogin === null && offersRemember && remember;
    void run(async () => {
      await answerUserAsk({
        askId: ask.askId,
        revision: ask.revision,
        kind: "fields",
        fields: payload,
        ...(offersRemember ? { remember: rememberHere } : {}),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      recordUserAskAnswer(
        ask.conversationId,
        userAskSecureRecord(ask, "provided", trimmedNote),
      );
      if (rememberHere && rememberedByPhone(ask)) {
        void rememberOnDevices({ detail, typed }).catch(() => undefined);
      }
    }, "mobile.userAsk.answerFailed");
  }, [
    ask,
    note,
    detail,
    fills,
    offersRemember,
    remember,
    run,
    savedLogin,
    sealable,
    t,
    values,
  ]);

  const body = (
    <>
      <View style={styles.header}>
        <View style={[styles.icon, ask.blocking && styles.iconBlocking]}>
          <Icon
            name="eye-off"
            size={17}
            color={ask.blocking ? colors.accent : colors.text}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{detail.purpose}</Text>
          {ask.agentLabel ? (
            <Text style={styles.meta}>
              {t("mobile.userAsk.askedBy", { label: ask.agentLabel })}
            </Text>
          ) : null}
        </View>
      </View>

      {detail.detail ? (
        <Text style={styles.detail}>{detail.detail}</Text>
      ) : null}

      <View style={styles.statusRow}>
        {ask.blocking ? (
          <Text style={styles.blockingBadge}>
            {t("mobile.userAsk.waitingBadge")}
          </Text>
        ) : null}
        {remaining !== null ? (
          <Text style={styles.countdown}>
            {remaining <= 0
              ? t("mobile.userAsk.deadlinePassed")
              : t("mobile.userAsk.deadline", {
                  time: formatRemaining(remaining),
                })}
          </Text>
        ) : null}
      </View>

      {needsComputer ? (
        <View style={styles.redirect}>
          <Text style={styles.redirectTitle}>
            {originLabel
              ? t("mobile.userAsk.answerOnComputer", { device: originLabel })
              : ask.originDeviceId
                ? t("mobile.userAsk.answerOnComputer", {
                    device: t("mobile.userAsk.unnamedComputer", {
                      id: ask.originDeviceId.slice(0, 4).toUpperCase(),
                    }),
                  })
                : t("mobile.userAsk.answerOnComputerUnknown")}
          </Text>
          <Text style={styles.redirectBody}>
            {t("mobile.userAsk.answerOnComputerWhy")}
          </Text>
          <View style={styles.redirectFields}>
            {detail.fields.map((field) => (
              <Text key={field.id} style={styles.redirectField}>
                {field.label}
              </Text>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          {savedLogin ? (
            <View style={styles.redirect}>
              <Text style={styles.savedHeading}>
                {t("mobile.userAsk.savedHeading")}
              </Text>
              <Text style={styles.redirectTitle}>{savedLogin.label}</Text>
              <View style={styles.redirectFields}>
                {savedFields.map((field) => (
                  <View key={field.id} style={styles.savedFieldRow}>
                    <Text style={styles.redirectField}>{field.label}</Text>
                    <Text numberOfLines={1} style={styles.savedFieldValue}>
                      {field.sensitive ? "••••••••" : fills[field.id]}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.redirectBody}>
                {askedFields.length > 0
                  ? t("mobile.userAsk.usingSaved", { label: savedLogin.label })
                  : t("mobile.userAsk.savedBody")}
              </Text>
            </View>
          ) : detail.save?.replacing ? (
            <Text style={styles.rememberHint}>
              {t("mobile.userAsk.replacing", { label: detail.save.label })}
            </Text>
          ) : detail.save?.usingSaved ? (
            <Text style={styles.rememberHint}>
              {t("mobile.userAsk.usingSaved", { label: detail.save.label })}
            </Text>
          ) : detail.save && saved.status === "none" ? (
            <Text style={styles.rememberHint}>
              {t("mobile.userAsk.needsFromYou")}
            </Text>
          ) : null}
          {askedFields.map((field) => {
            const nextId =
              typedFieldIds[typedFieldIds.indexOf(field.id) + 1] ?? null;
            return (
              <SecureField
                busy={busy}
                inputRef={(input) => {
                  if (input) inputRefs.current.set(field.id, input);
                  else inputRefs.current.delete(field.id);
                }}
                onSubmitNext={
                  nextId
                    ? () => inputRefs.current.get(nextId)?.focus()
                    : null
                }
                colors={colors}
                field={field}
                key={field.id}
                onChange={(next) =>
                  setValues((prev) => ({ ...prev, [field.id]: next }))
                }
                onToggleReveal={() =>
                  setRevealed((prev) => ({
                    ...prev,
                    [field.id]: prev[field.id] !== true,
                  }))
                }
                revealed={revealed[field.id] === true}
                sealable={sealable}
                styles={styles}
                t={t}
                value={values[field.id] ?? ""}
              />
            );
          })}
          {saved.login ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              hitSlop={8}
              onPress={() => {
                tapLight();
                setTyping((current) => !current);
              }}
              style={({ pressed }) => [
                styles.savedSwitch,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.savedSwitchText}>
                {savedLogin
                  ? t("mobile.userAsk.typeInstead")
                  : t("mobile.userAsk.useSavedInstead")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );

  const footer = (
    <View style={styles.secureFooter}>
      <View style={styles.noteRow}>
        <AskTextInput
          accessibilityLabel={t("userAsk.secureInput.note")}
          colors={colors}
          editable={!busy}
          maxLength={USER_ASK_MAX_NOTE}
          multiline
          onChangeText={setNote}
          placeholder={t("userAsk.secureInput.note")}
          style={styles.noteInput}
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          value={note}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={decline}
          style={({ pressed }) => [
            styles.declineButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          <Text numberOfLines={1} style={styles.declineText}>
            {t("mobile.userAsk.cantRightNow")}
          </Text>
        </Pressable>
      </View>

      {issue ? <Text style={styles.issue}>{issue}</Text> : null}

      {needsComputer ? null : (
        <View style={styles.secureActions}>
          {offersRemember && !savedLogin ? (
            <View style={styles.rememberRow}>
              <Switch
                accessibilityHint={
                  remember
                    ? t("mobile.userAsk.rememberOn", {
                        label: detail.save?.label ?? "",
                      })
                    : t("mobile.userAsk.rememberOff")
                }
                accessibilityLabel={t("mobile.userAsk.remember")}
                disabled={busy}
                onValueChange={setRemember}
                style={styles.rememberSwitch}
                value={remember}
              />
              <Text style={styles.rememberLabel}>
                {t("mobile.userAsk.remember")}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || missing}
            onPress={send}
            style={({ pressed }) => [
              styles.primaryAction,
              (!offersRemember || savedLogin) && styles.primaryActionWide,
              pressed && styles.pressed,
              (busy || missing) && styles.disabled,
            ]}
          >
            <Text style={styles.primaryActionText}>
              {busy
                ? t("mobile.userAsk.sending")
                : savedLogin && askedFields.length === 0
                  ? t("mobile.userAsk.useSaved")
                  : t("mobile.userAsk.sendSecurely")}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <AskCardFrame
      body={body}
      colors={colors}
      footer={footer}
      footerDivider={false}
      leading={
        <Icon
          color={ask.blocking ? colors.accent : colors.textMuted}
          name="eye-off"
          size={15}
        />
      }
      styles={styles}
      summary={detail.purpose}
    />
  );
}

function SecureField({
  field,
  inputRef,
  onSubmitNext,
  value,
  revealed,
  sealable,
  busy,
  onChange,
  onToggleReveal,
  styles,
  colors,
  t,
}: {
  field: UserAskField;
  inputRef: (input: TextInput | null) => void;
  onSubmitNext: (() => void) | null;
  value: string;
  revealed: boolean;
  sealable: boolean;
  busy: boolean;
  onChange: (next: string) => void;
  onToggleReveal: () => void;
  styles: AskStyles;
  colors: Colors;
  t: Translate;
}) {
  const anchor = useAskFieldAnchor();
  return (
    <View ref={anchor.ref} style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{field.label}</Text>
        {field.optional ? (
          <Text style={styles.fieldOptional}>
            {t("mobile.userAsk.optional")}
          </Text>
        ) : null}
        {sealable && field.sensitive ? (
          <View style={styles.fieldSensitive}>
            <Text style={styles.sensitiveText}>
              {t("mobile.userAsk.sensitive")}
            </Text>
          </View>
        ) : null}
      </View>
      {field.hint ? <Text style={styles.fieldHint}>{field.hint}</Text> : null}

      {field.type === "choice" ? (
        <View style={styles.choiceRow}>
          {(field.choices ?? []).map((choice) => {
            const selected = value === choice.id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={busy}
                key={choice.id}
                onPress={() => {
                  tapLight();
                  onChange(choice.id);
                }}
                style={({ pressed }) => [
                  styles.choice,
                  selected && styles.choiceSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    selected && styles.choiceTextSelected,
                  ]}
                >
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.inputRow}>
          <AskTextInput
            autoCapitalize="none"
            autoCorrect={false}
            colors={colors}
            {...nativeInputPropsForField(field)}
            accessibilityLabel={field.label}
            onBlur={anchor.onBlur}
            ref={inputRef}
            returnKeyType={onSubmitNext ? "next" : "done"}
            submitBehavior={onSubmitNext ? "submit" : "blurAndSubmit"}
            onSubmitEditing={onSubmitNext ?? undefined}
            onChangeText={onChange}
            onFocus={anchor.onFocus}
            placeholder={field.placeholder ?? ""}
            secureTextEntry={field.type === "secret" && !revealed}
            spellCheck={false}
            style={[
              styles.input,
              userAskFieldInputKind(field) === "one_time_code" &&
                styles.inputCode,
            ]}
            value={value}
          />
          {field.type === "secret" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                revealed
                  ? t("mobile.userAsk.hideSecret", { label: field.label })
                  : t("mobile.userAsk.revealSecret", { label: field.label })
              }
              onPress={onToggleReveal}
              style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}
            >
              <Icon
                color={colors.textMuted}
                name={revealed ? "eye-off" : "eye"}
                size={16}
              />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** Keyboard, autofill and length for a field, from its well-known id or type (card number, expiry, CVC, ZIP, login, code). */
const nativeInputPropsForField = (field: UserAskField): Partial<TextInputProps> => {
  const kind = userAskFieldInputKind(field);
  const props = nativeInputPropsForKind(kind);
  // iOS reads a card with several masked fields as a sign-up form and offers
  // "Use Strong Password?" (and can fill one) on any masked field it doesn't
  // recognise as the password, e.g. a masked ZIP or expiry. Only the password
  // keeps the password hint; other masked fields are marked as one-time codes,
  // which keeps their keyboard and turns that offer off.
  if (field.type === "secret" && kind !== "password") {
    return { ...props, textContentType: "oneTimeCode", autoComplete: "off" };
  }
  return props;
};

const nativeInputPropsForKind = (
  kind: ReturnType<typeof userAskFieldInputKind>,
): Partial<TextInputProps> => {
  switch (kind) {
    case "one_time_code":
      return { keyboardType: "number-pad", maxLength: 12, textContentType: "oneTimeCode", autoComplete: "one-time-code" };
    case "card_number":
      return { keyboardType: "number-pad", maxLength: 23, textContentType: "creditCardNumber", autoComplete: "cc-number" };
    case "card_expiry":
      return { keyboardType: "numbers-and-punctuation", maxLength: 7, textContentType: "creditCardExpiration", autoComplete: "cc-exp" };
    case "card_cvc":
      return { keyboardType: "number-pad", maxLength: 4, textContentType: "creditCardSecurityCode", autoComplete: "cc-csc" };
    case "postal_code":
      return { keyboardType: "numbers-and-punctuation", maxLength: 12, textContentType: "postalCode", autoComplete: "postal-code" };
    case "email":
      return { keyboardType: "email-address", textContentType: "emailAddress", autoComplete: "email" };
    case "username":
      return { textContentType: "username", autoComplete: "username" };
    case "password":
      return { textContentType: "password", autoComplete: "current-password" };
    default:
      return {};
  }
};

function AskTextInput({
  colors,
  ref,
  ...props
}: TextInputProps & { colors: Colors; ref?: Ref<TextInput> }) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textWeaker}
      selectionColor={colors.accent}
      {...props}
    />
  );
}

type AskStyles = ReturnType<typeof makeStyles>;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    blockingBadge: {
      backgroundColor: colors.accentSoft,
      borderRadius: 8,
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    body: {
      gap: 10,
    },
    record: {
      alignSelf: "flex-start",
      backgroundColor: colors.assistantBubbleFillTop,
      borderRadius: 18,
      maxWidth: "100%",
      paddingHorizontal: 14,
      paddingVertical: 3,
    },
    recordAnswer: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 16,
      lineHeight: 21,
    },
    recordAnswerSkipped: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontStyle: "italic",
    },
    recordItem: {
      gap: 2,
      paddingVertical: 6,
    },
    recordNote: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      lineHeight: 21,
    },
    recordQuestion: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 19,
    },
    recordTag: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      fontStyle: "normal",
    },
    card: {
      alignSelf: "stretch",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    cardCollapsed: {
      display: "none",
    },
    cardFooter: {
      borderTopColor: "transparent",
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingBottom: 12,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    cardFooterDivided: {
      borderTopColor: colors.border,
    },
    cardScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    cardScrollContent: {
      gap: 14,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    collapsedChevron: {
      transform: [{ rotate: "180deg" }],
    },
    collapsedMeta: {
      color: colors.textMuted,
      flexShrink: 0,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    collapsedRow: {
      alignItems: "center",
      alignSelf: "stretch",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    collapsedText: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    choice: {
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    choiceRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    choiceSelected: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.selectBorder,
    },
    choiceText: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
    },
    choiceTextSelected: {
      color: colors.text,
    },
    countdown: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    declineButton: {
      justifyContent: "center",
      minHeight: 38,
      paddingLeft: 4,
    },
    declineText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
    },
    detail: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
      marginTop: 6,
    },
    disabled: {
      opacity: 0.4,
    },
    field: {
      backgroundColor: colors.surfaceInset,
      borderRadius: 14,
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    fieldHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
    },
    fieldHint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    fieldLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
    },
    fieldOptional: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    footer: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: 38,
    },
    footerActions: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 8,
      justifyContent: "flex-end",
    },
    footerStart: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
    },
    header: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 12,
    },
    headerCopy: {
      flex: 1,
      gap: 3,
    },
    icon: {
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: 11,
      height: 36,
      justifyContent: "center",
      width: 36,
    },
    iconBlocking: {
      backgroundColor: colors.accentSoft,
    },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    inputCode: {
      fontFamily: fonts.mono.regular,
      letterSpacing: 3,
    },
    inputRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
    },
    issue: {
      color: colors.danger,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
    },
    meta: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    nav: {
      alignItems: "center",
      height: 36,
      justifyContent: "center",
      width: 32,
    },
    divider: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      marginLeft: 14,
      marginRight: 14,
    },
    dividerHidden: {
      opacity: 0,
    },
    option: {
      alignItems: "center",
      borderRadius: 14,
      flexDirection: "row",
      gap: 12,
      minHeight: 52,
      paddingLeft: 14,
      paddingRight: 14,
      paddingVertical: 10,
    },
    optionCopy: {
      flex: 1,
      gap: 2,
    },
    optionHint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    optionLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 16,
      letterSpacing: -0.2,
      lineHeight: 21,
    },
    optionSelected: {
      backgroundColor: colors.accentSoft,
    },
    optionTag: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    options: {
      marginHorizontal: -6,
      marginTop: 12,
    },
    other: {
      alignItems: "flex-end",
      borderRadius: 14,
      flexDirection: "row",
      gap: 8,
      minHeight: 52,
      paddingLeft: 14,
      paddingRight: 8,
      paddingVertical: 8,
    },
    otherConfirm: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 18,
      height: 36,
      justifyContent: "center",
      width: 36,
    },
    noteRow: {
      alignItems: "center",
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 12,
    },
    noteInput: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 20,
      maxHeight: 96,
      minHeight: 38,
      paddingBottom: 9,
      paddingTop: 9,
      textAlignVertical: "center",
    },
    otherInput: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      lineHeight: 21,
      maxHeight: 120,
      minHeight: 36,
      paddingBottom: 7,
      paddingTop: 7,
      textAlignVertical: "center",
    },
    pager: {
      alignItems: "center",
      flexDirection: "row",
      gap: 2,
    },
    pressed: {
      opacity: 0.72,
    },
    primaryAction: {
      alignItems: "center",
      alignSelf: "flex-end",
      backgroundColor: colors.accent,
      borderRadius: 19,
      justifyContent: "center",
      minHeight: 38,
      paddingHorizontal: 16,
    },
    primaryActionText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    primaryActionWide: {
      flex: 1,
      minHeight: 46,
    },
    progress: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      fontVariant: ["tabular-nums"],
      minWidth: 52,
      textAlign: "center",
    },
    redirect: {
      backgroundColor: colors.surfaceInset,
      borderRadius: 14,
      gap: 7,
      padding: 12,
    },
    redirectBody: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
    },
    redirectField: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    redirectFields: {
      borderTopColor: fadeHex(colors.border, 0.8),
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 2,
      paddingTop: 8,
    },
    savedFieldRow: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: 12,
      justifyContent: "space-between",
    },
    savedFieldValue: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    savedHeading: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      letterSpacing: 0.2,
    },
    savedSwitch: {
      alignSelf: "flex-start",
      paddingVertical: 4,
    },
    savedSwitchText: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
    redirectTitle: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.1,
    },
    reveal: {
      alignItems: "center",
      height: 38,
      justifyContent: "center",
      width: 32,
    },
    rememberHint: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    rememberLabel: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 18,
    },
    rememberRow: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 8,
    },
    rememberSwitch: {
      transform: [{ scale: 0.8 }],
    },
    secureFooter: {
      gap: 6,
    },
    secureActions: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "flex-end",
    },
    fieldSensitive: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      marginLeft: "auto",
    },
    sensitiveRow: {
      alignItems: "center",
      borderTopColor: fadeHex(colors.border, 0.8),
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 10,
      paddingTop: 8,
    },
    sensitiveText: {
      color: colors.textMuted,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    skip: {
      alignItems: "center",
      borderColor: "transparent",
      borderRadius: 19,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 5,
      justifyContent: "center",
      minHeight: 38,
      paddingHorizontal: 14,
    },
    skipSelected: {
      borderColor: colors.border,
    },
    skipText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
    },
    skipTextSelected: {
      color: colors.text,
    },
    statusRow: {
      alignItems: "center",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    step: {
      gap: 0,
    },
    timingRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
    },
    timing: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.3,
      lineHeight: 24,
    },
  });
