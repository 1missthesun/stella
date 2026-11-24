import { useEffect, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { authClient } from "../lib/auth-client";
import { observeCloudConversationIdentity } from "../lib/cloud-conversation-auth";
import { useDrawerLive, useDrawerSide } from "../lib/drawer";
import { tapLight } from "../lib/haptics";
import { useColors } from "../theme/theme-context";
import { CloudHomeSettings } from "./CloudHomeSettings";
import { SettingsContent } from "./SettingsContent";
import { SidebarTopFade } from "./sidebar/SidebarPanel";

export function AccountPanel({ width }: { width: number }) {
  const colors = useColors();
  const live = useDrawerLive();
  const showing = useDrawerSide() === "start" && live;
  const [prepared, setPrepared] = useState(false);

  useEffect(() => {
    if (prepared) return;
    const idle = requestIdleCallback(() => setPrepared(true));
    return () => cancelIdleCallback(idle);
  }, [prepared]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, width }]}>
      {prepared || showing ? <AccountPages showing={showing} /> : null}
      <SidebarTopFade />
    </View>
  );
}

function AccountPages({ showing }: { showing: boolean }) {
  const router = useRouter();
  const session = authClient.useSession();
  const identity = observeCloudConversationIdentity(session.data ?? null);
  const [page, setPage] = useState<"account" | "cloud-home">("account");
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (showing) return;
    setMoved(false);
    setPage("account");
  }, [showing]);

  useEffect(() => {
    if (page === "account") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setMoved(true);
      setPage("account");
      return true;
    });
    return () => sub.remove();
  }, [page]);

  const go = (next: typeof page) => {
    setMoved(true);
    setPage(next);
  };

  return page === "account" ? (
    <Animated.View
      key="account"
      style={styles.root}
      entering={moved ? FadeInLeft.duration(240) : undefined}
      exiting={FadeOut.duration(120)}
    >
      <SettingsContent
        active={showing}
        inDrawer
        onOpenCloudHome={() => go("cloud-home")}
      />
    </Animated.View>
  ) : (
    <Animated.View
      key="cloud-home"
      style={styles.root}
      entering={FadeInRight.duration(240)}
      exiting={FadeOut.duration(120)}
    >
      <CloudHomeSettings
        key={identity?.identityKey ?? "signed-out"}
        identity={identity}
        onSignIn={() => router.replace("/login")}
        onBack={() => {
          tapLight();
          go("account");
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
