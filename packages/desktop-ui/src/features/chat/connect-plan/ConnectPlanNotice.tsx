import { Button } from "@/ui/button";
import { BrandIcon } from "@/ui/brand-icon";
import { Lock, Plug, X } from "@/ui/icons";
import type { ComposerNotice } from "@/features/chat/composer-notice-store";
import { AntigravitySignInPrompt } from "@/features/antigravity/AntigravitySignInPrompt";
import { ClaudeLoginPrompt } from "@/features/claude/ClaudeLoginPrompt";
import { ClaudeCliInstallStatus } from "@/features/claude/ClaudeCliInstallStatus";
import { EngineConnectPrompt } from "@/features/cloud/EngineConnectPrompt";
import { useConnectPlan } from "./use-connect-plan";
import "@/app/chat/composer-notice.css";
import "./connect-plan.css";

export function ConnectPlanNotice({
  notice,
  compact,
  onDismiss,
}: {
  notice: ComposerNotice;
  compact: boolean;
  onDismiss: () => void;
}) {
  const plan = useConnectPlan({ notice, onDismiss });
  const { t } = plan;
  const Icon = plan.reason === "no-engine" ? Plug : Lock;

  return (
    <div
      className={`composer-notice composer-notice--upgrade connect-plan${compact ? " composer-notice--compact" : ""}`}
      role="status"
      data-testid="composer-notice"
      data-connect-plan={plan.reason}
    >
      <div className="connect-plan__head">
        <div className="composer-notice__icon" aria-hidden>
          <Icon size={compact ? 14 : 16} />
        </div>
        <div className="composer-notice__body">
          <p className="composer-notice__title">{plan.title}</p>
          {plan.description ? <p className="composer-notice__sub">{plan.description}</p> : null}
        </div>
      </div>

      <div className="connect-plan__plans" role="group" aria-label={t("chat.connectPlan.chooseTitle")}>
        {plan.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="connect-plan__plan"
            data-option={option.id}
            data-pending={option.pending || undefined}
            aria-busy={option.pending || undefined}
            disabled={option.disabled}
            onClick={() => {
              if (!option.pending) plan.run(option.id);
            }}
          >
            {option.pending ? (
              <span className="connect-plan__spinner" aria-label={t("common.loading")} />
            ) : (
              <BrandIcon brand={option.brand} size={18} />
            )}
            <span className="connect-plan__plan-label">{option.label}</span>
          </button>
        ))}
      </div>

      {plan.flow === "claude-install" ? (
        <div className="connect-plan__flow">
          <ClaudeCliInstallStatus state={plan.claudeInstall.state} onRetry={plan.installClaude} />
        </div>
      ) : plan.flow === "claude-login" ? (
        <div className="connect-plan__flow">
          <ClaudeLoginPrompt login={plan.claudeLogin} />
        </div>
      ) : plan.flow === "chatgpt-connect" ? (
        <div className="connect-plan__flow">
          <EngineConnectPrompt connect={plan.connect} />
        </div>
      ) : plan.flow === "gemini" ? (
        <div className="connect-plan__flow">
          <AntigravitySignInPrompt antigravity={plan.antigravity} onStart={plan.retryGemini} />
        </div>
      ) : plan.flow === "waiting" ? (
        <p className="connect-plan__fine">
          {plan.waiting}{" "}
          <button type="button" className="connect-plan__link" onClick={plan.cancel}>
            {t("common.cancel")}
          </button>
        </p>
      ) : null}

      {plan.error ? (
        <p className="connect-plan__fine connect-plan__fine--error" role="alert">
          {plan.error}
        </p>
      ) : plan.fine ? (
        <p className="connect-plan__fine" aria-live="polite">
          {plan.fine}
        </p>
      ) : null}

      {plan.plus || plan.other ? (
        <div className="connect-plan__foot">
          {plan.plus ? (
            <div className="connect-plan__upgrade">
              <span className="connect-plan__lead">{plan.plus.lead}</span>
              <Button
                type="button"
                variant="ghost"
                className="pill-btn composer-notice__secondary"
                data-action="plus"
                disabled={plan.plus.busy}
                onClick={plan.plus.start}
              >
                {plan.plus.label}
              </Button>
            </div>
          ) : null}
          {plan.other ? (
            <button type="button" className="connect-plan__link connect-plan__other" onClick={plan.other.open}>
              {plan.other.label}
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="composer-notice__dismiss"
        aria-label={t("common.close")}
        onClick={plan.close}
      >
        <X size={14} />
      </button>
    </div>
  );
}
