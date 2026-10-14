import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activityIndicatorMenuEntries } from "@stella/contracts/activity-indicator";
import type { ActivityIndicatorEntry } from "@stella/contracts/activity-indicator";
import { AgentActivityRow } from "./AgentActivityRow";
import { TopSheet } from "./TopSheet";
import { TOP_BAR_BAR_HEIGHT } from "./AppBackdrop";
import type { Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";

export function StellaActivityMenu({
  visible,
  running,
  onClose,
}: {
  visible: boolean;
  running: readonly ActivityIndicatorEntry[];
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const entries = useMemo(
    () => activityIndicatorMenuEntries(running),
    [running],
  );

  return (
    <TopSheet visible={visible} onClose={onClose} contentSized glass>
      <View
        style={[
          styles.sheet,
          { paddingTop: insets.top + TOP_BAR_BAR_HEIGHT },
        ]}
      >
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {entries.map((entry) => (
            <AgentActivityRow
              key={entry.id}
              title={entry.title}
              lifecycleStatus="running"
              working
              roomy
              colors={colors}
            />
          ))}
        </ScrollView>
      </View>
    </TopSheet>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    sheet: {
      gap: 10,
      paddingBottom: 18,
      paddingHorizontal: 18,
    },
    list: {
      flexGrow: 0,
    },
    listContent: {
      gap: 12,
      paddingVertical: 4,
    },
  });
