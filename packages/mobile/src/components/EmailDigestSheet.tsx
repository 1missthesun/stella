import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useT } from "../i18n";
import { closeEmailDigest, markEmailSeen, selectEmailDigest, useEmailDigestSheet } from "../lib/email";
import { EmailDigestView } from "./EmailDigestView";
import { FileViewerFooter } from "./FileViewerPanel";
import { TopSheet, TopSheetDragHandle } from "./TopSheet";

/** The digest behind a chat email row, opened from the top like a file. */
export function EmailDigestSheet({ bottomReserve = 0 }: { bottomReserve?: number }) {
  const t = useT();
  const router = useRouter();
  const { digestId, open } = useEmailDigestSheet();
  useEffect(() => {
    if (open) markEmailSeen();
  }, [open]);
  const actions = useMemo(
    () => [
      {
        key: "settings",
        icon: "settings" as const,
        accessibilityLabel: t("email.digest.settings"),
        onPress: () => {
          closeEmailDigest();
          router.push("/email");
        },
      },
    ],
    [router, t],
  );
  return (
    <TopSheet visible={open} onClose={closeEmailDigest} dim={false} presentation="overlay" bottomReserve={bottomReserve}>
      <View style={styles.root} testID="email-digest-sheet">
        <ScrollView
          style={styles.root}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {open || digestId ? (
            <EmailDigestView
              key={digestId ?? "newest"}
              digestId={digestId}
              onSelect={selectEmailDigest}
              onAsked={closeEmailDigest}
            />
          ) : null}
        </ScrollView>
        <TopSheetDragHandle>
          <View>
            <FileViewerFooter name={t("email.title")} actions={actions} onClose={closeEmailDigest} closeLabel={t("common.close")} />
          </View>
        </TopSheetDragHandle>
      </View>
    </TopSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 16, paddingHorizontal: 18, paddingTop: 18 },
});
