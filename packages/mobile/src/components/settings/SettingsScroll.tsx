import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KIT } from "../chat-settings/kit";
import { DrawerScrollView } from "../sidebar/DrawerStage";
import { SIDEBAR_BRAND_TOP } from "../sidebar/SidebarPanel";

export function SettingsScroll({
  inDrawer,
  children,
}: {
  inDrawer: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const paddingBottom = 32 + insets.bottom;
  if (inDrawer) {
    return (
      <DrawerScrollView
        contentContainerStyle={{
          paddingBottom,
          paddingHorizontal: KIT.gutter,
          paddingTop: insets.top + SIDEBAR_BRAND_TOP,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {children}
      </DrawerScrollView>
    );
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
