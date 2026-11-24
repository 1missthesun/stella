import { useRouter } from "expo-router";
import { useWideLayout } from "./bottom-bar";
import { openDrawer } from "./drawer";
import { MAIN_TAB_HREFS } from "./last-main-tab";

export function useOpenAccount(): () => void {
  const router = useRouter();
  const wide = useWideLayout();
  return () => {
    if (wide) router.push(MAIN_TAB_HREFS.settings);
    else openDrawer("start");
  };
}
