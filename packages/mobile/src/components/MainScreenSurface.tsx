import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBackdrop, TOP_BAR_BAR_HEIGHT } from "./AppBackdrop";

export const mainContentStyles = StyleSheet.create({
  content: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
});

export function useShellTopInset(): number {
  return useSafeAreaInsets().top + TOP_BAR_BAR_HEIGHT;
}

export function MainDetailSurface({ children }: { children: ReactNode }) {
  const topInset = useShellTopInset();
  return (
    <View style={styles.root}>
      <AppBackdrop />
      <View
        style={[
          mainContentStyles.content,
          { paddingTop: topInset + mainContentStyles.content.paddingTop },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
});
