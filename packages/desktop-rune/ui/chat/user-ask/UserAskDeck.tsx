import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserAsk } from "@stella/contracts/user-ask";
import {
  EMPTY_USER_ASK_DRAFT,
  nextUnansweredIndex,
  pickUserAskOption,
  skipUserAskQuestion,
  typeUserAskText,
  userAskDeckAnswers,
  userAskDeckComplete,
  userAskDeckEntries,
  userAskRecordFromAnswer,
  type UserAskDeckEntry,
  type UserAskDraft,
  type UserAskDrafts,
} from "@stella/contracts/user-ask-deck";
import { useT } from "@/shared/i18n";
import { answerUserAsk, recordUserAskAnswer } from "@/features/user-ask/user-ask-store";
import { Icon, Icons, withStroke, type IconData } from "../../kit";
import { fontSize, useTokens } from "../../theme";
import { AskTextArea, UserAskError, UserAskFrame, UserAskTiming, useUserAskLook } from "./UserAskCard";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DECK_KEYS = ["ArrowLeft", "ArrowRight", ...DIGITS];

function OptionRow({ label, hint, selected, isDefault, busy, divider, onPress, onHover }: { label: string; hint?: string; selected: boolean; isDefault: boolean; busy: boolean; divider: boolean; onPress: () => void; onHover: (inside: boolean) => void }) {
  const t = useT();
  const tokens = useTokens();
  const look = useUserAskLook();
  return (
    <row
      role="radio"
      checked={selected}
      label={label}
      focusable={!busy}
      disabled={busy}
      w="full"
      minH={46}
      py={9}
      px={12}
      gap={12}
      align="center"
      radius={12}
      fill={selected ? tokens.c.selectFill : undefined}
      hoverFill={busy || selected ? undefined : look.optionHover}
      focusRing={{ width: 2, offset: -2, color: tokens.c.ring }}
      opacity={busy ? 0.6 : 1}
      cursor={busy ? undefined : "pointer"}
      motion={{ dur: 0.12, bounce: 0 }}
      onHover={onHover}
      onPress={busy ? undefined : onPress}
    >
      {divider ? <box absolute={{ top: 0, left: 12, right: 12 }} h={1} fill={look.divider} inert /> : null}
      <col grow={1} gap={2} minW={0}>
        <text size={fontSize.lg} weight={500} lineHeight={fontSize.lg * 1.35} color={tokens.c.textStrong}>
          {label}
        </text>
        {hint ? (
          <text size={fontSize.base} lineHeight={fontSize.base * 1.4} color={tokens.c.textWeak}>
            {hint}
          </text>
        ) : null}
      </col>
      {isDefault && !selected ? (
        <text size={fontSize.sm} color={tokens.c.textWeak} shrink={false}>
          {t("userAsk.question.default")}
        </text>
      ) : null}
      {selected ? <Icon icon={Icons.stella.Check} size={16} color={tokens.c.interactive} /> : null}
    </row>
  );
}

function DeckQuestion({ entry, draft, busy, onPick, onType, onConfirmText, onTextFocus }: { entry: UserAskDeckEntry; draft: UserAskDraft; busy: boolean; onPick: (choiceId: string) => void; onType: (text: string) => void; onConfirmText: () => void; onTextFocus: (focused: boolean) => void }) {
  const t = useT();
  const tokens = useTokens();
  const look = useUserAskLook();
  const { question } = entry;
  const typed = draft.text.trim().length > 0;
  const textChosen = !draft.choiceId && !draft.skipped && typed;
  const [hovered, setHovered] = useState<number | null>(null);
  const [otherFocused, setOtherFocused] = useState(false);
  const options = question.options;
  const selectedIndex = options.findIndex((option) => option.id === draft.choiceId);
  const quiet = (index: number) => hovered === index || selectedIndex === index;
  const otherQuiet = quiet(options.length - 1) || textChosen || otherFocused;

  return (
    <col w="full" enter={{ opacity: 0, x: 10, dur: 0.18, bounce: 0 }}>
      <text size={fontSize.xl} weight={600} lineHeight={fontSize.xl * 1.35} tracking={-0.17} color={tokens.c.textStrong} role="heading">
        {question.question}
      </text>
      {question.detail ? (
        <text mt={6} size={fontSize.md} lineHeight={fontSize.md * 1.5} color={tokens.c.textWeak}>
          {question.detail}
        </text>
      ) : null}
      <col role="radiogroup" label={question.question} mt={10} mx={-8}>
        {options.map((option, index) => (
          <OptionRow
            key={option.id}
            label={option.label}
            hint={option.hint}
            selected={draft.choiceId === option.id}
            isDefault={option.id === question.defaultChoiceId}
            busy={busy}
            divider={index > 0 && !quiet(index) && !quiet(index - 1)}
            onPress={() => onPick(option.id)}
            onHover={(inside) => setHovered((current) => (inside ? index : current === index ? null : current))}
          />
        ))}
        <row w="full" minH={46} pt={4} pb={4} pl={12} pr={6} gap={8} align="end" radius={12} fill={textChosen ? tokens.c.selectFill : undefined}>
          {options.length > 0 && !otherQuiet ? <box absolute={{ top: 0, left: 12, right: 12 }} h={1} fill={look.divider} inert /> : null}
          <AskTextArea
            value={draft.text}
            placeholder={t("userAsk.question.somethingElse")}
            disabled={busy}
            onChange={onType}
            onEnter={() => {
              if (typed) onConfirmText();
            }}
            onFocus={(focused) => {
              setOtherFocused(focused);
              onTextFocus(focused);
            }}
          />
          {typed ? (
            <box
              role="button"
              label={t("userAsk.question.confirm")}
              focusable={!busy}
              w={32}
              h={32}
              mb={3}
              center
              radius={999}
              fill={tokens.c.interactive}
              opacity={busy ? 0.6 : 1}
              cursor={busy ? undefined : "pointer"}
              focusRing={{ width: 2, offset: 2, color: tokens.c.ring }}
              enter={{ opacity: 0, scale: 0.85, dur: 0.14, bounce: 0 }}
              onPress={busy ? undefined : onConfirmText}
            >
              <Icon icon={withStroke(Icons.stella.Check, 2.5)} size={16} color={tokens.c.interactiveForeground} />
            </box>
          ) : null}
        </row>
      </col>
    </col>
  );
}

function PagerButton({ label, icon, disabled, onPress }: { label: string; icon: IconData; disabled: boolean; onPress: () => void }) {
  const tokens = useTokens();
  const look = useUserAskLook();
  return (
    <box
      role="button"
      label={label}
      focusable={!disabled}
      disabled={disabled}
      w={30}
      h={30}
      center
      radius={999}
      hoverFill={disabled ? undefined : look.navHover}
      cursor={disabled ? undefined : "pointer"}
      focusRing={{ width: 2, offset: 2, color: tokens.c.ring }}
      onPress={disabled ? undefined : onPress}
    >
      <Icon icon={icon} size={16} color={disabled ? tokens.c.textWeaker : tokens.c.textBase} />
    </box>
  );
}

export function UserAskDeck({ asks }: { asks: readonly UserAsk[] }) {
  const t = useT();
  const tokens = useTokens();
  const look = useUserAskLook();
  const entries = useMemo(() => userAskDeckEntries(asks), [asks]);
  const [drafts, setDrafts] = useState<UserAskDrafts>({});
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);

  const found = entries.findIndex((entry) => entry.key === currentKey);
  const index = found >= 0 ? found : (nextUnansweredIndex(entries, drafts, -1) ?? 0);
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
      setError(null);
      const answers = userAskDeckAnswers(entries, finalDrafts);
      const results = await Promise.all(answers.map(answerUserAsk));
      answers.forEach((answer, i) => {
        if (!results[i]) return;
        const ask = entries.find((candidate) => candidate.ask.askId === answer.askId)?.ask;
        if (ask) recordUserAskAnswer(ask.conversationId, userAskRecordFromAnswer(entries, finalDrafts, ask));
      });
      setBusy(false);
      if (results.some((ok) => !ok)) setError(t("userAsk.errors.answer"));
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
  const draft = drafts[entry.key] ?? EMPTY_USER_ASK_DRAFT;

  const onKey = ({ key }: { key: string }) => {
    if (key === "ArrowLeft" && index > 0) return goTo(index - 1);
    if (key === "ArrowRight" && index < total - 1) return goTo(index + 1);
    const option = DIGITS.includes(key) ? entry.question.options[Number(key) - 1] : undefined;
    if (option) commit(pickUserAskOption(draft, option.id));
  };

  return (
    <UserAskFrame label={entry.question.question} gap={12} keys={typing ? undefined : DECK_KEYS} onKey={onKey}>
      <DeckQuestion
        key={entry.key}
        entry={entry}
        draft={draft}
        busy={busy}
        onPick={(choiceId) => commit(pickUserAskOption(draft, choiceId))}
        onType={(text) => setDrafts((current) => ({ ...current, [entry.key]: typeUserAskText(text) }))}
        onConfirmText={() => commit(typeUserAskText(draft.text))}
        onTextFocus={setTyping}
      />
      {error ? <UserAskError>{error}</UserAskError> : null}
      <row w="full" align="center" gap={12} minH={34}>
        <row grow={1} w={0} minW={0} align="center">
          <UserAskTiming ask={entry.ask} />
        </row>
        {total > 1 ? (
          <row align="center" gap={4} shrink={false}>
            <PagerButton label={t("userAsk.question.previous")} icon={Icons.stella.ChevronLeft} disabled={index === 0} onPress={() => goTo(index - 1)} />
            <text minW={58.5} textAlign="center" size={fontSize.base} color={tokens.c.textWeak} features="'tnum' 1">
              {t("userAsk.question.progress", { current: index + 1, total })}
            </text>
            <PagerButton label={t("userAsk.question.next")} icon={Icons.stella.ChevronRight} disabled={index === total - 1} onPress={() => goTo(index + 1)} />
          </row>
        ) : null}
        <row grow={1} w={0} minW={0} align="center" justify="end" gap={8}>
          <row
            role="button"
            selected={draft.skipped === true}
            label={draft.skipped ? t("userAsk.question.skipped") : t("userAsk.question.skip")}
            focusable={!busy}
            disabled={busy}
            align="center"
            gap={5}
            h={34}
            px={14 + 1}
            radius={999}
            border={draft.skipped ? tokens.c.border : undefined}
            hoverFill={busy ? undefined : look.skipHover}
            hoverGroup
            opacity={busy ? 0.6 : 1}
            cursor={busy ? undefined : "pointer"}
            focusRing={{ width: 2, offset: 2, color: tokens.c.ring }}
            onPress={busy ? undefined : () => commit(skipUserAskQuestion(draft))}
          >
            {draft.skipped ? <Icon icon={Icons.stella.Check} size={14} color={tokens.c.textStrong} /> : null}
            <text size={fontSize.md} weight={500} color={draft.skipped ? tokens.c.textStrong : tokens.c.textWeak} hoverColor={tokens.c.textStrong} nowrap>
              {draft.skipped ? t("userAsk.question.skipped") : t("userAsk.question.skip")}
            </text>
          </row>
          {total > 1 && complete ? (
            <box
              role="button"
              label={t("userAsk.question.submit")}
              focusable={!busy}
              disabled={busy}
              h={34}
              px={14 + 1}
              center
              radius={999}
              fill={tokens.c.interactive}
              border={tokens.c.interactive}
              hoverFill={busy ? undefined : look.submitHover}
              opacity={busy ? 0.6 : 1}
              cursor={busy ? undefined : "pointer"}
              focusRing={{ width: 2, offset: 2, color: tokens.c.ring }}
              onPress={busy ? undefined : () => void submit(drafts)}
            >
              <text size={fontSize.md} weight={500} color={tokens.c.interactiveForeground} nowrap>
                {busy ? t("userAsk.question.sending") : t("userAsk.question.submit")}
              </text>
            </box>
          ) : null}
        </row>
      </row>
    </UserAskFrame>
  );
}
