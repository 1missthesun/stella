import { Press, T, tx } from "../../kit/compat";
import { useClaudeCliInstall } from "./claude-cli-install.styles";
import { useState } from "react";
import { useT } from "@/shared/i18n";
import { openExternalUrl } from "@/platform/electron/open-external";
import { claudeInstallPercent, type ClaudeCliInstallState } from "@/features/claude/use-claude-cli-install";

const CLAUDE_CODE_SETUP_URL = "https://code.claude.com/docs/en/setup";

export function ClaudeCliInstallStatus({
  state,
  onRetry,
}: {
  state: ClaudeCliInstallState;
  onRetry: () => void;
}) {
  const s = useClaudeCliInstall();
  const t = useT();
  const [barW, setBarW] = useState(0);
  if (state.status === "installing") {
    const { progress } = state;
    const percent = claudeInstallPercent(progress);
    const indeterminate = percent === null && progress.phase !== "setting-up";
    const label =
      progress.phase === "setting-up"
        ? t("claudeInstall.settingUp")
        : progress.phase === "checking"
          ? t("claudeInstall.checking")
          : percent !== null
            ? t("claudeInstall.downloading", { percent })
            : t("claudeInstall.downloadingNoTotal");
    return (
      <col {...s.claudeInstall} role="status">
        <T w="full" {...s.claudeInstallLabel}>{label}</T>
        <row {...s.claudeInstallBar} onSize={(r) => setBarW(r.w)}>
          {indeterminate ? (
            <row {...s.claudeInstallBar_span} {...s.claudeInstallBarIndeterminate_span} loop={{ kind: "slide", period: 1.4, from: [-0.3 * barW, 0], to: [1.02 * barW, 0] }} />
          ) : (
            <row {...s.claudeInstallBar_span} w={`${progress.phase === "setting-up" ? 100 : (percent ?? 0)}%`} />
          )}
        </row>
        <T w="full" {...s.claudeInstallWhy}>{t("claudeInstall.why")}</T>
      </col>
    );
  }
  if (state.status === "error") {
    return (
      <T w="full" {...s.claudeInstallError} role="alert">
        {t(`claudeInstall.${state.kind}`)}{" "}
        <Press text={tx(s.claudeInstallError)} {...s.claudeInstallLink} onPress={onRetry}>
          {t("claudeInstall.retry")}
        </Press>
        {" · "}
        <Press text={tx(s.claudeInstallError)} {...s.claudeInstallLink} onPress={() => openExternalUrl(CLAUDE_CODE_SETUP_URL)}>
          {t("claudeInstall.manual")}
        </Press>
      </T>
    );
  }
  return null;
}
