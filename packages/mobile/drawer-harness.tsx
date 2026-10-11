import { AppRegistry, Appearance, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DrawerStage } from "./src/components/sidebar/DrawerStage";
import {
  drawerProgress,
  drawerSign,
  isDrawerOpen,
  openDrawer,
  useDrawerMetrics,
} from "./src/lib/drawer";

(Appearance as any).setColorScheme ??= () => {};
(globalThis as any).__drawer = () => ({
  progress: drawerProgress.value,
  sign: drawerSign.value,
  open: isDrawerOpen(),
  openStart: isDrawerOpen("start"),
  openEnd: isDrawerOpen("end"),
});

function Panel({ label, color }: { label: string; color: string }) {
  const { travel } = useDrawerMetrics();
  return (
    <View style={{ flex: 1, width: travel, backgroundColor: color, paddingTop: 80, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 30, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>

          <View style={{ height: "100vh" as any }}>
            <DrawerStage
              enabled
              panel={<Panel label="LEFT" color="#fde" />}
              chevron={{ left: 10, top: 50, openCenterY: 40, openLabel: "open nav", closeLabel: "close nav" }}
              end={{
                enabled: true,
                panel: <Panel label="RIGHT" color="#def" />,
                chevron: { left: 393 - 54, top: 50, openCenterY: 40, openLabel: "open settings", closeLabel: "close settings", restIcon: "settings" },
              }}
            >
              <View style={{ flex: 1, backgroundColor: "#ffd", padding: 40, paddingTop: 120 }}>
                <Text style={{ fontSize: 22 }}>PAGE CONTENT lorem ipsum dolor sit amet</Text>
                <Pressable testID="gear" onPress={() => openDrawer("end")} style={{ marginTop: 20, padding: 10, backgroundColor: "#ccc" }}>
                  <Text>GEAR</Text>
                </Pressable>
              </View>
            </DrawerStage>
          </View>

      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

AppRegistry.registerComponent("harness", () => App);
AppRegistry.runApplication("harness", { rootTag: document.getElementById("root") });
