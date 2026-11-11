import { useT } from "@/shared/i18n";
import { openExternalUrl } from "@/platform/electron/open-external";
import { claudeInstallPercent, type ClaudeCliInstallState } from "./use-claude-cli-install";
import "./claude-cli-install.css";

const CLAUDE_CODE_SETUP_URL = "https://code.claude.com/docs/en/setup";

/**
 * Progress while Claude Code installs (getting ready, downloading N%,
 * setting up), or a plain failure with Try again and Install it yourself.
 * Renders nothing before an install starts and after it succeeds.
 */
export function ClaudeCliInstallStatus({
  state,
  onRetry,
}: {
  state: ClaudeCliInstallState;
  onRetry: () => void;
}) {
  const t = useT();
  if (state.status === "installing") {
    const { progress } = state;
    const percent = claudeInstallPercent(progress);
    const label =
      progress.phase === "setting-up"
        ? t("claudeInstall.settingUp")
        : progress.phase === "checking"
          ? t("claudeInstall.checking")
          : percent !== null
            ? t("claudeInstall.downloading", { percent })
            : t("claudeInstall.downloadingNoTotal");
    return (
      <div className="claude-install" role="status" aria-live="polite">
        <p className="claude-install__label">{label}</p>
        <span
          className="claude-install__bar"
          data-indeterminate={percent === null && progress.phase !== "setting-up" ? true : undefined}
        >
          <span style={{ width: `${progress.phase === "setting-up" ? 100 : (percent ?? 0)}%` }} />
        </span>
        <p className="claude-install__why">{t("claudeInstall.why")}</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p className="claude-install__error" role="alert">
        {t(`claudeInstall.${state.kind}`)}{" "}
        <button type="button" className="claude-install__link" onClick={onRetry}>
          {t("claudeInstall.retry")}
        </button>
        {" · "}
        <button
          type="button"
          className="claude-install__link"
          onClick={() => openExternalUrl(CLAUDE_CODE_SETUP_URL)}
        >
          {t("claudeInstall.manual")}
        </button>
      </p>
    );
  }
  return null;
}
