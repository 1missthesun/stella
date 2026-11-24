import { useEffect } from "react";
import { useRouter } from "expo-router";
import { MainDetailSurface } from "../../src/components/MainScreenSurface";
import { SettingsContent } from "../../src/components/SettingsContent";
import { useWideLayout } from "../../src/lib/bottom-bar";
import { MAIN_TAB_HREFS, queueMainTab } from "../../src/lib/last-main-tab";

export default function SettingsScreen() {
  const router = useRouter();
  const wide = useWideLayout();

  useEffect(() => {
    if (wide) return;
    queueMainTab("settings");
    router.dismissTo(MAIN_TAB_HREFS.chat);
  }, [router, wide]);

  if (!wide) return null;
  return (
    <MainDetailSurface>
      <SettingsContent
        active
        inDrawer={false}
        onOpenCloudHome={() => router.push("/cloud-home")}
      />
    </MainDetailSurface>
  );
}
