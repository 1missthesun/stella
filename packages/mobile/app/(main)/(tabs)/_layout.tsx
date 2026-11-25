import Tabs from "expo-router/js-tabs";
import { switchTabsOnPopOrReplace } from "../../../src/lib/main-tabs";

export const unstable_settings = { anchor: "chat" };

export default function MainTabsLayout() {
  return (
    <Tabs
      tabBar={hiddenTabBar}
      backBehavior="firstRoute"
      UNSTABLE_router={switchTabsOnPopOrReplace}
      screenOptions={TAB_OPTIONS}
    >
      <Tabs.Screen name="chat" options={CHAT_OPTIONS} />
      <Tabs.Screen name="schedule" />
      <Tabs.Screen name="(apps)" />
      <Tabs.Screen name="files" />
    </Tabs>
  );
}

const hiddenTabBar = () => null;

const TAB_OPTIONS = {
  headerShown: false,
  animation: "none",
  freezeOnBlur: true,
  sceneStyle: { backgroundColor: "transparent" },
} as const;

const CHAT_OPTIONS = { lazy: false, freezeOnBlur: false } as const;
