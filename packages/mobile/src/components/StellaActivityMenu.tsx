import { useMemo } from "react";
import { ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activityIndicatorMenuEntries } from "@stella/contracts/activity-indicator";
import type { ActivityIndicatorEntry } from "@stella/contracts/activity-indicator";
import { AgentActivityRow } from "./AgentActivityRow";
import { FloatingPopover } from "./FloatingPopover";
import { TOP_BAR_BAR_HEIGHT } from "./AppBackdrop";
import type { Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";

/**
 * What the top-bar indicator opens: the agents that are in progress right now,
 * one line each, capped at the shared menu cap. The desktop indicator opens
 * the same list with the same cap.
 *
 * It lists only running work on purpose — it is the detail behind "N things in
 * progress", not the activity index. Everything else (settled agents, their
 * files, the conversation's own files) still lives in the sidebar.
 *
 * It opens as the floating popover, pointing at the top bar's indicator.
 *
 * The rows are a read-out, not a menu: they name what is running and nothing
 * more. They used to be buttons that closed the menu and opened the sidebar,
 * which is a surprising place to be sent from here.
 *
 * Each row leads with the lifecycle status icon desktop's own activity rows
 * use, so the two top bars label the same work the same way.
 */
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
  const { width: screenWidth } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const entries = useMemo(
    () => activityIndicatorMenuEntries(running),
    [running],
  );

  if (!visible) return null;
  return (
    <FloatingPopover
      anchor={{
        x: screenWidth / 2,
        y: insets.top + TOP_BAR_BAR_HEIGHT / 2,
      }}
      onClose={onClose}
      closeLabel="Close"
      width={Math.min(screenWidth - 36, 380)}
      maxHeight={360}
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
            colors={colors}
          />
        ))}
      </ScrollView>
    </FloatingPopover>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: {
      flexGrow: 0,
    },
    listContent: {
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
  });
