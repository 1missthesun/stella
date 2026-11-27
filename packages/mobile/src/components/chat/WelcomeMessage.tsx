import { memo } from "react";
import { StyleSheet, View } from "react-native";
import {
  MEET_STELLA_GUIDE_PATH,
  MEET_STELLA_GUIDE_SLUG,
  MEET_STELLA_GUIDE_TITLE,
  WELCOME_TEXT,
} from "@stella/contracts/welcome-message";
import type { ChatArtifact } from "../../types";
import type { Colors } from "../../theme/colors";
import { AssistantMarkdown } from "../AssistantMarkdown";
import { DocumentPill } from "../evidence/MessageEvidenceStrip";

// Stella's first message: two short lines (the same words every client shows
// and the model reads), with the Meet Stella guide under them the way a
// document Stella made sits under its message. The guide opens in the viewer
// from the copy the app carries, so it needs no download.

export const meetStellaGuideArtifact = (conversationId: string): ChatArtifact => ({
  id: `welcome:${MEET_STELLA_GUIDE_SLUG}`,
  conversationId,
  payload: {
    kind: "canvas-html",
    filePath: MEET_STELLA_GUIDE_PATH,
    slug: MEET_STELLA_GUIDE_SLUG,
    title: MEET_STELLA_GUIDE_TITLE,
    createdAt: 0,
  },
});

export const WelcomeMessage = memo(function WelcomeMessage({
  colors,
  fill,
  onOpenGuide,
}: {
  colors: Colors;
  fill: boolean;
  onOpenGuide?: () => void;
}) {
  return (
    <View style={fill && styles.fill} testID="welcome-message">
      <AssistantMarkdown text={WELCOME_TEXT} colors={colors} fill={fill} />
      <View style={styles.pills}>
        <DocumentPill
          icon="file-text"
          title={MEET_STELLA_GUIDE_TITLE}
          accessibilityLabel={`Open ${MEET_STELLA_GUIDE_TITLE}`}
          colors={colors}
          onPress={onOpenGuide}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { alignSelf: "stretch" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
});
