import { memo } from "react";
import { SHELL_TOPBAR_HEIGHT } from "./metrics";

export const ShellTopBarFull = memo(function ShellTopBarFull(_props: { onSignIn?: () => void }) {
  return <row id="shell-topbar-full" absolute={{ left: 0, top: 0, right: 0 }} h={SHELL_TOPBAR_HEIGHT} windowDrag />;
});
