import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type {
  EmailBrief,
  EmailBriefBlock,
  EmailBriefTone,
  EmailDigest,
  EmailFound,
  EmailItem,
  EmailSearchResult,
  EmailTargets,
  EmailThread,
} from "@stella/contracts/backend/email";
import { briefOf, plainText, reflowText, senderOf, snippetPoint } from "@stella/contracts/email-brief";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { useLocale, useT, useTPlural } from "../i18n";
import { authClient } from "../lib/auth-client";
import { getBackendClient, useBackendView } from "../lib/backend";
import {
  archiveEmail,
  askStellaAboutEmail,
  chooseAction,
  correctEmail,
  dismissEmail,
  emailTime,
  openGmailThread,
} from "../lib/email";
import { tapLight, tapMedium } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";

type Styles = ReturnType<typeof makeStyles>;

/** About two lines of a search preview at phone width. */
const PHONE_SNIPPET_CHARS = 84;
const SCALE = CONTENT_MAX_FONT_SCALE;

/** The briefing's light markdown: bold only, nested in the surrounding text. */
function Md({ text, boldStyle }: { text: string; boldStyle: object }) {
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

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

type Choice = { label: string; destructive?: boolean; run: () => unknown };

function Block({
  tone,
  title,
  points,
  foot,
  quiet,
  suggestion,
  choices,
  styles,
  colors,
  testID,
}: {
  tone: EmailBriefTone;
  title: string;
  points: string[];
  foot: string;
  quiet?: boolean;
  suggestion?: { label: string };
  choices: () => Choice[];
  styles: Styles;
  colors: Colors;
  testID: string;
}) {
  const t = useT();
  const open = () => {
    tapMedium();
    const list = choices();
    chooseAction(
      plainText(title),
      list.map(({ label, destructive }) => ({ label, ...(destructive ? { destructive } : {}) })),
      t("common.cancel"),
      (index) => void list[index]?.run(),
    );
  };
  return (
    <Pressable
      accessibilityRole="button"
      // The whole point opens its menu; the one control says what's in it.
      onPress={open}
      style={styles.block}
      testID={testID}
    >
      <View style={quiet ? styles.quiet : undefined}>
        <View style={styles.blockHead}>
          <Text style={styles.blockTitle} maxFontSizeMultiplier={SCALE}>
            <Md text={title} boldStyle={styles.bold} />
          </Text>
          {suggestion ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("email.brief.more")}
              hitSlop={10}
              onPress={open}
              style={({ pressed }) => [styles.more, pressed && styles.dimmed]}
              testID="email-block-control"
            >
              <Icon name="more-horizontal" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        {points.map((point, index) => (
          <View key={index} style={styles.point}>
            <Text style={styles.bullet} maxFontSizeMultiplier={SCALE}>
              •
            </Text>
            <Text style={styles.pointText} maxFontSizeMultiplier={SCALE}>
              <Md text={point} boldStyle={styles.bold} />
            </Text>
          </View>
        ))}
        {suggestion ? (
          <Pressable
            accessibilityRole="button"
            onPress={open}
            style={({ pressed }) => [styles.primary, pressed && styles.dimmed]}
            testID="email-block-control"
          >
            <Text style={styles.primaryLabel} maxFontSizeMultiplier={SCALE}>
              {suggestion.label}
            </Text>
            <Icon name="chevron-down" size={14} color={colors.accentForeground} />
          </Pressable>
        ) : null}
        {foot ? (
          <Text style={styles.foot} maxFontSizeMultiplier={SCALE}>
            {foot}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Skipped({ items, line, now, styles }: { items: EmailItem[]; line?: string; now: number; styles: Styles }) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [mattered, setMattered] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) return null;
  const matter = (item: EmailItem) => {
    tapLight();
    void correctEmail(item.itemId, "needs_you")
      .then(() => setMattered((current) => new Set([...current, item.itemId])))
      .catch(() => Alert.alert(t("email.failed")));
  };
  return (
    <View style={styles.skipped}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tapLight();
          setOpen((value) => !value);
        }}
        style={styles.skippedLine}
      >
        <Text style={styles.skippedText} numberOfLines={open ? undefined : 1} maxFontSizeMultiplier={SCALE}>
          <Text style={styles.skippedCount} maxFontSizeMultiplier={SCALE}>
            {tPlural("email.digest.skipped", items.length)}
          </Text>
          {line ? `  ${line.replace(/^\s*\d+\s*(emails?)?\s*[:·-]?\s*/iu, "")}` : ""}
        </Text>
        <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
          {open ? t("email.brief.hide") : t("email.brief.show")}
        </Text>
      </Pressable>
      {open ? (
        <>
          <Text style={styles.notice} maxFontSizeMultiplier={SCALE}>
            {t("email.digest.skippedHint")}
          </Text>
          {items.map((item) => {
            const done = mattered.has(item.itemId) || (item.corrected && item.bucket !== "noise");
            return (
              <View key={item.itemId} style={styles.skippedRow} testID="email-skipped-item">
                <View style={styles.rowHead}>
                  <Text style={styles.skippedFrom} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
                    {senderOf(item.from)}
                  </Text>
                  <Text style={styles.time} maxFontSizeMultiplier={SCALE}>
                    {emailTime(locale, item.receivedAt, now)}
                  </Text>
                </View>
                <Text style={styles.subject} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
                  {item.subject}
                </Text>
                {done ? (
                  <Text style={[styles.foot, styles.flush]} maxFontSizeMultiplier={SCALE}>
                    {t("email.digest.matteredDone")}
                  </Text>
                ) : (
                  <Pressable accessibilityRole="button" hitSlop={6} onPress={() => matter(item)}>
                    <Text style={[styles.link, styles.matter]} maxFontSizeMultiplier={SCALE}>
                      {t("email.digest.mattered")}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

type ReadTarget = { itemId: string } | { account: string; threadId: string };

function Reader({ target, now, onLoaded, styles, colors }: { target: ReadTarget; now: number; onLoaded: (thread: EmailThread) => void; styles: Styles; colors: Colors }) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "done"; thread: EmailThread }>({ status: "loading" });
  const key = "itemId" in target ? target.itemId : `${target.account}:${target.threadId}`;
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void getBackendClient()
      .call("email.thread", target)
      .then((thread) => {
        if (!live) return;
        setState({ status: "done", thread });
        onLoaded(thread);
      })
      .catch((error: unknown) => {
        if (live) setState({ status: "error", message: errorText(error, t("email.failed")) });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.status === "loading") return <ActivityIndicator color={colors.textMuted} style={styles.loading} />;
  if (state.status === "error") {
    return (
      <Text style={styles.notice} maxFontSizeMultiplier={SCALE}>
        {state.message}
      </Text>
    );
  }
  const { thread } = state;
  return (
    <View testID="email-reader">
      <Text style={styles.readerSubject} maxFontSizeMultiplier={SCALE}>
        {thread.subject}
      </Text>
      {thread.messages.map((message) => (
        <View key={message.messageId} style={styles.message}>
          <View style={styles.rowHead}>
            <Text style={styles.readerFrom} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
              {message.from}
            </Text>
            {message.draft ? (
              <Text style={styles.draft} maxFontSizeMultiplier={SCALE}>
                {t("email.brief.draft")}
              </Text>
            ) : null}
            <Text style={styles.time} maxFontSizeMultiplier={SCALE}>
              {emailTime(locale, message.receivedAt, now)}
            </Text>
          </View>
          <Text style={styles.readerTo} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
            {t("email.brief.to", { to: message.to })}
          </Text>
          <Text style={styles.readerText} selectable maxFontSizeMultiplier={SCALE}>
            {reflowText(message.text)}
          </Text>
          {message.attachments.length > 0 ? (
            <Text style={styles.foot} maxFontSizeMultiplier={SCALE}>
              {message.attachments.join(", ")}
            </Text>
          ) : null}
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={() => openGmailThread(thread.threadId, thread.account)} style={styles.inlineLink}>
        <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
          {t("email.brief.openGmail")}
        </Text>
        <Icon name="external-link" size={13} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const blockKey = (block: EmailBriefBlock): string => block.itemIds.join("+");

const dayLabel = (t: ReturnType<typeof useT>, locale: string, at: number, now: number): string => {
  const time = new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const day = new Date(at).toDateString();
  if (day === new Date(now).toDateString()) return t("email.brief.today", { time });
  if (day === new Date(now - 86_400_000).toDateString()) return t("email.brief.yesterday", { time });
  return new Date(at).toLocaleString(locale, { weekday: "long", hour: "numeric", minute: "2-digit" });
};


type SearchState = { query: string; state: { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: EmailSearchResult } };

/**
 * One briefing at a time, written like a good answer: a lead, then short
 * sections of points with one control each. Earlier and later briefings are a
 * swipe of the strip away, search covers the mailbox, and emails read in
 * place. In the sheet, what's on screen rides along with the next message.
 * Not scrollable itself.
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
  /** Mail sorted since the newest briefing, not in one yet. */
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState | null>(null);
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const stripRef = useRef<ScrollView>(null);
  // Where each briefing sits in the strip, so moving with ‹ › brings the shown one into view.
  const stops = useRef(new Map<string, { x: number; width: number }>());
  const stripWidth = useRef(0);

  const digests = view.value?.digests ?? [];
  const index = Math.max(0, digests.findIndex((digest) => digest.digestId === digestId));
  const shown = digests[index] ?? null;
  const newest = index === 0;
  const shownId = shown?.digestId;
  useEffect(() => {
    // After this render's layout settles (the selected label turns bold), centre the shown time.
    const timer = setTimeout(() => {
      const stop = shownId ? stops.current.get(shownId) : undefined;
      if (!stop) return;
      stripRef.current?.scrollTo({ x: Math.max(0, stop.x + stop.width / 2 - stripWidth.current / 2), animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [shownId]);
  const fallback = useMemo(() => {
    const need = shown ? shown.items.filter((item) => item.bucket === "urgent" || item.bucket === "needs_you").length : 0;
    const worth = (shown?.items.length ?? 0) - need;
    return [need > 0 ? tPlural("email.card.needYou", need) : null, worth > 0 ? tPlural("email.card.worthKnowing", worth) : null]
      .filter(Boolean)
      .join(" · ");
  }, [shown, tPlural]);
  const brief: EmailBrief | null = shown
    ? briefOf(shown, {
        needsYou: t("email.section.needsYou"),
        worthKnowing: t("email.section.worthKnowing"),
        urgent: t("email.section.urgent"),
        lead: fallback,
      })
    : null;
  const byId = useMemo(() => new Map([...(shown?.items ?? []), ...waiting].map((item) => [item.itemId, item])), [shown, waiting]);

  useEffect(() => {
    setReading(null);
  }, [shown?.digestId]);

  const ask = (targets: EmailTargets, action: "reply" | "handle" | "suggest" | "tell", text: string) =>
    void askStellaAboutEmail(targets, action, text)
      .then(onAsked)
      .catch((error: unknown) => Alert.alert(errorText(error, t("email.failed"))));

  const runSearch = () => {
    const words = query.trim();
    if (!words) return;
    setReading(null);
    setSearch({ query: words, state: { status: "loading" } });
    void getBackendClient()
      .call("email.search", { query: words })
      .then((result) => setSearch((current) => (current?.query === words ? { query: words, state: { status: "done", result } } : current)))
      .catch((error: unknown) =>
        setSearch((current) => (current?.query === words ? { query: words, state: { status: "error", message: errorText(error, t("email.failed")) } } : current)),
      );
  };

  const closeSearch = () => {
    setSearch(null);
    setQuery("");
    setSearchOpen(false);
  };

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
  const ordered = [...digests].reverse();

  const blockChoices = (block: EmailBriefBlock, items: EmailItem[]) => (): Choice[] => {
    const newestItem = [...items].sort((a, b) => b.receivedAt - a.receivedAt)[0]!;
    const targets = { itemIds: items.map((item) => item.itemId) };
    const from = senderOf(newestItem.from);
    const sorted = items.every((item) => item.bucket === "worth_knowing") ? "worth_knowing" : "needs_you";
    const archived = items.every((item) => item.archived);
    return [
      ...(block.suggestion ? [{ label: block.suggestion.ask, run: () => ask(targets, "suggest", block.suggestion!.ask) }] : []),
      { label: t("email.digest.reply"), run: () => ask(targets, "reply", t("email.digest.askReply", { from, subject: newestItem.subject })) },
      { label: t("email.digest.handle"), run: () => ask(targets, "handle", t("email.digest.askHandle", { from, subject: newestItem.subject })) },
      // Stella gets the email in hidden context; the chat is where they say what to do.
      { label: t("email.digest.tell"), run: () => ask(targets, "tell", "") },
      { label: t("email.brief.read"), run: () => setReading({ itemId: newestItem.itemId }) },
      {
        label: archived ? t("email.digest.unarchive") : t("email.digest.archive"),
        run: () => archiveEmail(targets, !archived).catch((error: unknown) => Alert.alert(errorText(error, t("email.failed")))),
      },
      { label: t("email.brief.openGmail"), run: () => openGmailThread(newestItem.threadId, newestItem.account) },
      {
        label: sorted === "needs_you" ? t("email.section.moveToWorthKnowing") : t("email.section.moveToNeedsYou"),
        run: () =>
          Promise.all(items.map((item) => correctEmail(item.itemId, sorted === "needs_you" ? "worth_knowing" : "needs_you"))).catch(() =>
            Alert.alert(t("email.failed")),
          ),
      },
      {
        label: t("email.notImportant"),
        destructive: true,
        run: () => Promise.all(items.map((item) => dismissEmail(item.itemId))).catch(() => Alert.alert(t("email.failed"))),
      },
    ];
  };

  const renderBlock = (block: EmailBriefBlock, tone: EmailBriefTone) => {
    const items = block.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    if (items.length === 0) return null;
    const key = blockKey(block);
    const foot = [
      items.length > 1 ? tPlural("email.brief.emails", items.length) : null,
      emailTime(locale, Math.max(...items.map((item) => item.receivedAt)), now),
      showAccount ? items[0]!.account : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Block
        key={key}
        tone={tone}
        title={block.title}
        points={block.points}
        foot={foot}
        quiet={items.every((item) => item.state === "dismissed")}
        {...(block.suggestion ? { suggestion: { label: block.suggestion.label } } : {})}
        choices={blockChoices(block, items)}
        styles={styles}
        colors={colors}
        testID="email-brief-block"
      />
    );
  };

  const subtitle = shown
    ? shown.sinceAt
      ? tPlural("email.brief.newSince", shown.items.length, { time: emailTime(locale, shown.sinceAt, now) })
      : tPlural("email.row.new", shown.items.length)
    : "";

  let body;
  if (reading) {
    body = (
      <View>
        <Pressable accessibilityRole="button" onPress={() => { setReading(null); setThread(null); }} style={styles.back}>
          <Icon name="chevron-left" size={15} color={colors.textMuted} />
          <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
            {t("email.brief.back")}
          </Text>
        </Pressable>
        <Reader target={reading} now={now} onLoaded={setThread} styles={styles} colors={colors} />
      </View>
    );
  } else if (search) {
    const state = search.state;
    body = (
      <View testID="email-search-results">
        <Pressable accessibilityRole="button" onPress={closeSearch} style={styles.back}>
          <Icon name="chevron-left" size={15} color={colors.textMuted} />
          <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
            {t("email.brief.backToBrief")}
          </Text>
        </Pressable>
        {state.status === "loading" ? <ActivityIndicator color={colors.textMuted} style={styles.loading} /> : null}
        {state.status === "error" ? <Text style={styles.notice}>{state.message}</Text> : null}
        {state.status === "done" ? (
          <>
            <Text style={styles.lead} maxFontSizeMultiplier={SCALE}>
              {state.result.results.length > 0 ? tPlural("email.brief.found", state.result.results.length) : t("email.brief.nothingFound")}
            </Text>
            <Text style={styles.meta} maxFontSizeMultiplier={SCALE}>
              {t("email.brief.searched", { query: state.result.gmailQuery || search.query })}
            </Text>
            <View style={styles.blocks}>
              {state.result.results.map((mail) => {
                const key = `${mail.account}:${mail.messageId}`;
                const found = { found: [mail] };
                return (
                  <Block
                    key={key}
                    tone="fyi"
                    title={`**${mail.from}** · ${mail.subject}`}
                    points={mail.snippet ? [snippetPoint(mail.snippet, PHONE_SNIPPET_CHARS)] : []}
                    foot={[emailTime(locale, mail.receivedAt, now), showAccount ? mail.account : null].filter(Boolean).join(" · ")}
                    choices={() => [
                      { label: t("email.digest.reply"), run: () => ask(found, "reply", t("email.digest.askReply", { from: mail.from, subject: mail.subject })) },
                      { label: t("email.digest.handle"), run: () => ask(found, "handle", t("email.digest.askHandle", { from: mail.from, subject: mail.subject })) },
                      { label: t("email.digest.tell"), run: () => ask(found, "tell", "") },
                      { label: t("email.brief.read"), run: () => setReading({ account: mail.account, threadId: mail.threadId }) },
                      {
                        label: mail.inInbox ? t("email.digest.archive") : t("email.digest.unarchive"),
                        run: () => archiveEmail(found, mail.inInbox).catch((error: unknown) => Alert.alert(errorText(error, t("email.failed")))),
                      },
                      { label: t("email.brief.openGmail"), run: () => openGmailThread(mail.threadId, mail.account) },
                    ]}
                    styles={styles}
                    colors={colors}
                    testID="email-search-result"
                  />
                );
              })}
            </View>
          </>
        ) : null}
      </View>
    );
  } else if (shown && brief) {
    body = (
      <View testID="email-digest">
        <Text style={styles.lead} maxFontSizeMultiplier={SCALE}>
          <Md text={brief.lead} boldStyle={styles.leadBold} />
        </Text>
        {shown.ruleText ? (
          <Text style={styles.meta} maxFontSizeMultiplier={SCALE}>
            “{shown.ruleText}”
          </Text>
        ) : null}
        {brief.sections.map((section, sectionIndex) => (
          <View key={`${section.heading}-${sectionIndex}`} style={styles.section}>
            <View style={styles.headingRow}>
              {section.tone === "urgent" ? <View style={styles.dot} /> : null}
              <Text style={[styles.heading, section.tone !== "fyi" && styles.headingStrong]} maxFontSizeMultiplier={SCALE}>
                {section.heading}
              </Text>
            </View>
            <View style={styles.blocks}>{section.blocks.map((block) => renderBlock(block, section.tone))}</View>
          </View>
        ))}
        {newest && waiting.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.heading} maxFontSizeMultiplier={SCALE}>
              {t("email.brief.waiting")}
            </Text>
            <View style={styles.blocks}>
              {waiting.map((item) =>
                renderBlock({ itemIds: [item.itemId], title: `**${senderOf(item.from)}** · ${item.subject}`, points: item.line ? [item.line] : [] }, "fyi"),
              )}
            </View>
          </View>
        ) : null}
        <Skipped key={shown.digestId} items={shown.skipped} line={brief.skipped} now={now} styles={styles} />
      </View>
    );
  } else {
    body = (
      <Text style={styles.notice} maxFontSizeMultiplier={SCALE}>
        {t("email.brief.empty")}
      </Text>
    );
  }

  const step = (by: number) => {
    const next = digests[index + by];
    if (!next) return;
    tapLight();
    setSearch(null);
    setReading(null);
    onSelect(next.digestId);
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("email.brief.earlier")}
          disabled={index >= digests.length - 1}
          onPress={() => step(1)}
          style={[styles.nav, index >= digests.length - 1 && styles.disabled]}
          testID="email-brief-earlier"
        >
          <Icon name="chevron-left" size={16} color={colors.textBase} />
        </Pressable>
        <View style={styles.when}>
          <Text style={styles.whenTitle} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
            {shown ? dayLabel(t, locale, shown.createdAt, now) : t("email.title")}
          </Text>
          {subtitle ? (
            <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("email.brief.later")}
          disabled={index === 0}
          onPress={() => step(-1)}
          style={[styles.nav, index === 0 && styles.disabled]}
          testID="email-brief-later"
        >
          <Icon name="chevron-right" size={16} color={colors.textBase} />
        </Pressable>
      </View>
      <View style={styles.stripRow}>
        <ScrollView
          ref={stripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.stripContent}
          onLayout={(event) => {
            stripWidth.current = event.nativeEvent.layout.width;
          }}
          onContentSizeChange={() => {
            if (newest) stripRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {ordered.map((digest) => {
            const on = digest === shown && !search && !reading;
            return (
              <Pressable
                key={digest.digestId}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  tapLight();
                  setSearch(null);
                  setReading(null);
                  onSelect(digest.digestId);
                }}
                style={styles.stop}
                onLayout={(event) => {
                  const { x, width } = event.nativeEvent.layout;
                  stops.current.set(digest.digestId, { x, width });
                }}
              >
                <Text style={[styles.stopLabel, on && styles.stopOn]} maxFontSizeMultiplier={SCALE}>
                  {emailTime(locale, digest.createdAt, now)}
                </Text>
                {on ? <View style={styles.stopBar} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("email.brief.search")}
          hitSlop={8}
          onPress={() => {
            tapLight();
            setSearchOpen((value) => !value);
          }}
          style={styles.searchToggle}
          testID="email-search-toggle"
        >
          <Icon name="search" size={16} color={searchOpen ? colors.accent : colors.textBase} />
        </Pressable>
      </View>
      {searchOpen ? (
        <View style={styles.searchBox}>
          <Icon name="search" size={15} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("email.brief.search")}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            autoFocus
            onSubmitEditing={runSearch}
            style={styles.searchInput}
            testID="email-search"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("email.brief.backToBrief")} hitSlop={8} onPress={closeSearch}>
              <Icon name="x" size={13} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {},
    loading: { alignItems: "center", paddingVertical: 32 },
    bar: { alignItems: "center", flexDirection: "row", gap: 10 },
    nav: {
      alignItems: "center",
      borderRadius: 10,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    disabled: { opacity: 0.3 },
    when: { alignItems: "center", flex: 1, minWidth: 0 },
    whenTitle: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 15.5, letterSpacing: -0.2 },
    meta: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 17, marginTop: 1 },
    stripRow: {
      alignItems: "center",
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      marginTop: 10,
    },
    strip: { flex: 1 },
    stripContent: { paddingRight: 8 },
    stop: { alignItems: "center", flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 9 },
    stopLabel: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 13, fontVariant: ["tabular-nums"] },
    stopOn: { color: colors.text, fontFamily: fonts.sans.semiBold },
    stopBar: { backgroundColor: colors.accent, borderRadius: 2, bottom: 0, height: 2, left: 8, position: "absolute", right: 8 },
    dot: { backgroundColor: colors.accent, borderRadius: 3, height: 6, width: 6 },
    searchToggle: { alignItems: "center", height: 32, justifyContent: "center", paddingLeft: 8, width: 36 },
    searchBox: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8,
      height: 40,
      marginTop: 12,
      paddingHorizontal: 12,
    },
    searchInput: { color: colors.text, flex: 1, fontFamily: fonts.sans.regular, fontSize: 15, paddingVertical: 0 },
    body: { paddingTop: 18 },
    lead: { color: colors.textBase, fontFamily: fonts.sans.medium, fontSize: 18, letterSpacing: -0.3, lineHeight: 26 },
    leadBold: { color: colors.text, fontFamily: fonts.sans.bold },
    section: { marginTop: 22 },
    headingRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 10 },
    heading: { color: colors.textMuted, fontFamily: fonts.sans.semiBold, fontSize: 13 },
    headingStrong: { color: colors.text },
    blocks: { gap: 22 },
    block: {},
    quiet: { opacity: 0.5 },
    blockHead: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
    blockTitle: { color: colors.textBase, flex: 1, fontFamily: fonts.sans.regular, fontSize: 15.5, letterSpacing: -0.2, lineHeight: 21 },
    bold: { color: colors.text, fontFamily: fonts.sans.semiBold },
    more: {
      alignItems: "center",
      borderRadius: 9,
      height: 28,
      justifyContent: "center",
      marginRight: -4,
      marginTop: -4,
      width: 32,
    },
    point: { flexDirection: "row", gap: 8, marginTop: 5, paddingRight: 4 },
    bullet: { color: colors.textMuted, fontSize: 14.5, lineHeight: 21 },
    pointText: { color: colors.textBase, flex: 1, fontFamily: fonts.sans.regular, fontSize: 14.5, lineHeight: 21 },
    primary: {
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.accent,
      borderRadius: 11,
      flexDirection: "row",
      gap: 5,
      height: 34,
      marginTop: 12,
      paddingLeft: 13,
      paddingRight: 10,
    },
    primaryLabel: { color: colors.accentForeground, fontFamily: fonts.sans.semiBold, fontSize: 14 },
    foot: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12, fontVariant: ["tabular-nums"], marginTop: 8 },
    flush: { marginTop: 2 },
    dimmed: { opacity: 0.5 },
    notice: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
    link: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 13.5 },
    matter: { marginTop: 4 },
    back: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, marginBottom: 14, paddingVertical: 2 },
    inlineLink: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, marginTop: 14 },
    skipped: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 22,
      paddingTop: 12,
    },
    skippedLine: { alignItems: "baseline", flexDirection: "row", gap: 10 },
    skippedText: { color: colors.textMuted, flex: 1, fontFamily: fonts.sans.regular, fontSize: 13.5 },
    skippedCount: { color: colors.textBase, fontFamily: fonts.sans.semiBold },
    skippedRow: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 8,
      paddingTop: 8,
    },
    rowHead: { alignItems: "baseline", flexDirection: "row", gap: 8 },
    skippedFrom: { color: colors.text, flexShrink: 1, fontFamily: fonts.sans.medium, fontSize: 14 },
    time: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12, fontVariant: ["tabular-nums"], marginLeft: "auto" },
    subject: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 13.5, lineHeight: 18 },
    readerSubject: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 19, letterSpacing: -0.3, lineHeight: 25, marginBottom: 6 },
    message: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 12 },
    readerFrom: { color: colors.text, flexShrink: 1, fontFamily: fonts.sans.semiBold, fontSize: 15 },
    draft: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 13 },
    readerTo: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12, marginBottom: 10, marginTop: 2 },
    readerText: { color: colors.textBase, fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 22 },
  });
