import { forwardRef, type ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KIT } from "../chat-settings/kit";
import { DrawerScrollView } from "../sidebar/DrawerStage";
import { SIDEBAR_BRAND_TOP } from "../sidebar/SidebarPanel";

export const SettingsScroll = forwardRef<
  ScrollView,
  { inDrawer: boolean; children: ReactNode }
>(function SettingsScroll({ inDrawer, children }, ref) {
  const insets = useSafeAreaInsets();
  const paddingBottom = 32 + insets.bottom;
  if (inDrawer) {
    return (
      <DrawerScrollView
        ref={ref}
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
      ref={ref}
      style={styles.screen}
      contentContainerStyle={{ paddingBottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
