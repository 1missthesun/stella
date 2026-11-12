import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { EmailFocusAction, EmailSearchResult, EmailTargets, EmailThread } from "@stella/contracts/backend/email";
import { plainText, reflowText, snippetPoint } from "@stella/contracts/email-brief";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { HistoryView, Md, TodayView, type TodayActions } from "./EmailToday";
import { useLocale, useT, useTPlural } from "../i18n";
import { authClient } from "../lib/auth-client";
import { getBackendClient, useBackendView } from "../lib/backend";
import { archiveEmail, askStellaAboutEmail, chooseAction, emailTime, markEmailSeen, openGmailThread } from "../lib/email";
import { tapLight, tapMedium } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";

type Styles = ReturnType<typeof makeStyles>;

/** About two lines of a search preview at phone width. */
const PHONE_SNIPPET_CHARS = 84;
const SCALE = CONTENT_MAX_FONT_SCALE;

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

type Choice = { label: string; destructive?: boolean; run: () => unknown };

/** A search result: the sender and subject, a short preview, and a menu of what to do. */
function Block({
  title,
  points,
  foot,
  choices,
  styles,
  colors,
  testID,
}: {
  title: string;
  points: string[];
  foot: string;
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
    <Pressable accessibilityRole="button" onPress={open} testID={testID}>
      <View style={styles.blockHead}>
        <Text style={styles.blockTitle} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
          <Md text={title} boldStyle={styles.bold} />
        </Text>
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
      </View>
      {points.map((point, index) => (
        <View key={index} style={styles.point}>
          <Text style={styles.bullet} maxFontSizeMultiplier={SCALE}>
            •
          </Text>
          <Text style={styles.pointText} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
            <Md text={point} boldStyle={styles.bold} />
          </Text>
        </View>
      ))}
      {foot ? (
        <Text style={styles.foot} maxFontSizeMultiplier={SCALE}>
          {foot}
        </Text>
      ) : null}
    </Pressable>
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

type SearchState = { query: string; state: { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: EmailSearchResult } };

/** The time, kept fresh to the minute while the page is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Email page's body: one living Today list (what is open now, each item
 * with its next step prepared), History with the log of what Stella read and
 * did, search across the mailbox, and emails read in place. Not scrollable itself.
 */
export function EmailTodayView({
  onAsked,
}: {
  /** An action handed an email to Stella; the chat shows what happens. */
  onAsked: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const signedIn = Boolean(authClient.useSession().data?.user);
  const view = useBackendView("email.today", signedIn ? {} : "skip");
  const [mode, setMode] = useState<"today" | "history">("today");
  const history = useBackendView("email.history", signedIn && mode === "history" ? {} : "skip");
  const now = useNow();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState | null>(null);
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const today = view.value;

  // Looking at Today clears the badge, including items that arrive while it is open.
  useEffect(() => {
    if (today) markEmailSeen();
  }, [today]);

  const ask = (targets: EmailTargets, action: EmailFocusAction, text: string, matterId?: string) =>
    void askStellaAboutEmail(targets, action, text, matterId)
      .then(onAsked)
      .catch((error: unknown) => Alert.alert(errorText(error, t("email.failed"))));

  const actions: TodayActions = {
    // "Tell Stella…" only opens the chat; the item settles once something is actually asked.
    ask: (matter, action, text) => ask({ itemIds: matter.itemIds }, action, text, action === "tell" ? undefined : matter.matterId),
    read: (matter) => setReading({ itemId: matter.itemIds[matter.itemIds.length - 1]! }),
  };

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

  if (!today) {
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
  const showAccount = today.multipleAccounts;

  let body;
  if (reading) {
    body = (
      <View>
        <Pressable accessibilityRole="button" onPress={() => setReading(null)} style={styles.back}>
          <Icon name="chevron-left" size={15} color={colors.textMuted} />
          <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
            {t("email.brief.back")}
          </Text>
        </Pressable>
        <Reader target={reading} now={now} onLoaded={() => undefined} styles={styles} colors={colors} />
      </View>
    );
  } else if (search) {
    const state = search.state;
    body = (
      <View testID="email-search-results">
        <Pressable accessibilityRole="button" onPress={closeSearch} style={styles.back}>
          <Icon name="chevron-left" size={15} color={colors.textMuted} />
          <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
            {t("email.today.backToToday")}
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
  } else if (mode === "history") {
    body = <HistoryView history={history.value} now={now} onRead={actions.read} />;
  } else {
    body = <TodayView today={today} now={now} showAccount={showAccount} actions={actions} />;
  }

  const subtitle =
    mode === "history"
      ? ""
      : [
          today.open.length > 0 ? tPlural("email.today.open", today.open.length) : null,
          today.readToday.total > 0 ? tPlural("email.today.readToday", today.readToday.total, { leftOut: today.readToday.leftOut }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={SCALE}>
            {mode === "history" ? t("email.today.history") : t("email.today.title")}
          </Text>
          {subtitle ? (
            <Text style={styles.meta} numberOfLines={2} maxFontSizeMultiplier={SCALE}>
              {subtitle}
            </Text>
          ) : null}
        </View>
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
          <Icon name="search" size={17} color={searchOpen ? colors.text : colors.textMuted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: mode === "history" }}
          hitSlop={8}
          onPress={() => {
            tapLight();
            setSearch(null);
            setReading(null);
            setMode((current) => (current === "history" ? "today" : "history"));
          }}
          style={styles.toggle}
          testID="email-history-toggle"
        >
          <Text style={styles.link} maxFontSizeMultiplier={SCALE}>
            {mode === "history" ? t("email.today.title") : t("email.today.history")}
          </Text>
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
            <Pressable accessibilityRole="button" accessibilityLabel={t("email.today.backToToday")} hitSlop={8} onPress={closeSearch}>
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
    titles: { flex: 1, minWidth: 0 },
    title: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 26, letterSpacing: -0.6, lineHeight: 32 },
    toggle: { paddingLeft: 6, paddingVertical: 6 },
    loading: { alignItems: "center", paddingVertical: 32 },
    bar: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
    meta: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 17, marginTop: 1 },
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
    blocks: { gap: 22 },
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
    foot: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12, fontVariant: ["tabular-nums"], marginTop: 8 },
    dimmed: { opacity: 0.5 },
    notice: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
    link: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 13.5 },
    back: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, marginBottom: 14, paddingVertical: 2 },
    inlineLink: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, marginTop: 14 },
    rowHead: { alignItems: "baseline", flexDirection: "row", gap: 8 },
    time: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12, fontVariant: ["tabular-nums"], marginLeft: "auto" },
    readerSubject: { color: colors.text, fontFamily: fonts.sans.semiBold, fontSize: 19, letterSpacing: -0.3, lineHeight: 25, marginBottom: 6 },
    message: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 12 },
    readerFrom: { color: colors.text, flexShrink: 1, fontFamily: fonts.sans.semiBold, fontSize: 15 },
    draft: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 13 },
    readerTo: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 12, marginBottom: 10, marginTop: 2 },
    readerText: { color: colors.textBase, fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 22 },
  });
