// A view's version history on the phone: the list of versions (Stella's edits, tasks' edits, the
// user's restores) in the full-screen view, a bar over the view while an older one is previewed
// (back, or Restore; Stella is asked to bring back a version that fails on today's data), and
// "Undo last change" on the card. A restore is a new version, so it can be undone too.
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { undoTarget, type ViewVersion } from "@stella/views/history";
import type { ViewSnapshot } from "@stella/views/session";
import { Text } from "../components/Text";
import { useT } from "../i18n";
import { selectionTick } from "../lib/haptics";
import { sendToChat } from "../lib/chat-send-queue";
import { fonts } from "../theme/fonts";
import type { Colors } from "../theme/colors";
import { restoreViewVersion, setViewPreview } from "./view-host";
import { ViewIcon } from "./ViewIcon";
import { mix } from "./view-style";

type T = ReturnType<typeof useT>;

export function versionTime(ms: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

const who = (t: T, version: ViewVersion): string =>
  version.by.kind === "restore" ? t("shell.display.viewHistory.you") : version.by.kind === "task" ? (version.by.title ?? t("shell.display.viewHistory.task")) : t("shell.display.viewHistory.stella");

async function restore(t: T, file: string, version: ViewVersion) {
  selectionTick();
  const result = await restoreViewVersion(file, version.id);
  const time = versionTime(version.createdAt);
  if (!result.restored) Alert.alert(t("shell.display.viewHistory.restoreFailed"));
  else if (!result.shared) Alert.alert(t("shell.display.viewHistory.restoredHere", { time }));
}

export function HeaderButton({ icon, label, onPress, colors, active = false }: { icon: string; label: string; onPress: () => void; colors: Colors; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed || active ? mix(colors.text, active ? 10 : 8, colors.background) : "transparent" })}
    >
      <ViewIcon name={icon} size={16} color={active ? colors.text : colors.textMuted} />
    </Pressable>
  );
}

/** "Undo last change" on the card: restores the version before an agent's latest edit. */
export function ViewUndoButton({ file, versions, preview, colors }: { file: string; versions: readonly ViewVersion[]; preview: ViewVersion | null; colors: Colors }) {
  const t = useT();
  const target = preview ? null : undoTarget(versions);
  if (!target) return null;
  return <HeaderButton icon="rotate-ccw" label={t("shell.display.viewHistory.undo")} colors={colors} onPress={() => void restore(t, file, target)} />;
}

/** The view's versions, newest first; choosing one previews it (the newest goes back to the live view). */
export function ViewVersionList({ file, versions, preview, colors, onChosen }: { file: string; versions: readonly ViewVersion[]; preview: ViewVersion | null; colors: Colors; onChosen: () => void }) {
  const t = useT();
  const latest = versions.at(-1);
  const shown = preview ?? latest;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
      {[...versions].reverse().map((version) => (
        <Pressable
          key={version.id}
          accessibilityRole="button"
          onPress={() => {
            selectionTick();
            setViewPreview(file, version.id === latest?.id ? null : version.id);
            onChosen();
          }}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: pressed ? mix(colors.text, 6, colors.background) : "transparent" })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 15, color: colors.text }} numberOfLines={1}>
              {who(t, version)}
            </Text>
            <Text style={{ fontFamily: fonts.sans.regular, fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
              {version.id === latest?.id ? t("shell.display.viewHistory.current") : versionTime(version.createdAt)}
              {version.by.kind === "restore" ? ` · ${t("shell.display.viewHistory.restoredFrom", { time: versionTime(version.by.from) })}` : ""}
            </Text>
          </View>
          {version.id === shown?.id ? <ViewIcon name="check" size={18} color={colors.text} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Over the view while an older version is previewed: who made it and when, back, and Restore (or ask Stella). */
export function ViewPreviewBar({ file, title, version, snapshot, colors }: { file: string; title: string; version: ViewVersion; snapshot: ViewSnapshot | null; colors: Colors }) {
  const t = useT();
  const time = versionTime(version.createdAt);
  const misfit = Boolean(snapshot?.problem);
  const back = () => setViewPreview(file, null);
  const primary = misfit
    ? {
        label: t("shell.display.viewHistory.ask"),
        onPress: () => {
          selectionTick();
          void sendToChat(t("shell.display.viewHistory.askMessage", { title, time }));
          back();
        },
      }
    : { label: t("shell.display.viewHistory.restore"), onPress: () => void restore(t, file, version) };
  return (
    <View accessibilityRole="summary" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: mix(colors.text, 4, colors.background) }}>
      <Text style={{ flex: 1, fontFamily: fonts.sans.medium, fontSize: 13, color: colors.text }} numberOfLines={1}>
        {who(t, version)}
        <Text style={{ fontFamily: fonts.sans.regular, color: colors.textMuted }}>{`  ${time}`}</Text>
      </Text>
      <Pressable onPress={back} hitSlop={6} accessibilityRole="button" style={({ pressed }) => ({ paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: "center", backgroundColor: pressed ? mix(colors.text, 8, colors.background) : "transparent" })}>
        <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 13, color: colors.text }}>{t("shell.display.viewHistory.back")}</Text>
      </Pressable>
      <Pressable onPress={primary.onPress} hitSlop={6} accessibilityRole="button" style={({ pressed }) => ({ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: "center", backgroundColor: pressed ? mix(colors.background, 15, colors.text) : colors.text })}>
        <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 13, color: colors.background }} numberOfLines={1}>
          {primary.label}
        </Text>
      </Pressable>
    </View>
  );
}
