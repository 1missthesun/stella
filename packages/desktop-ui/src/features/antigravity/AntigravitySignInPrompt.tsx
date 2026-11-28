import { useEffect, useState } from "react";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useT } from "@/shared/i18n";
import { Button } from "@/ui/button";
import type { Antigravity } from "./use-antigravity";
import "@/features/cloud/EngineConnectPrompt.css";

const K = "settings.engineAccounts";
const LOGIN = `${K}.claudeLogin`;

export function AntigravitySignInPrompt({
  antigravity,
  onStart,
}: {
  antigravity: Antigravity;
  onStart: () => void;
}) {
  const t = useT();
  const { signIn } = antigravity;
  const [code, setCode] = useState("");
  const [rejected, setRejected] = useState<string | null>(null);
  const page = signIn.state === "running" && signIn.progress.phase === "code" ? signIn.progress : null;
  const loginId = page?.loginId ?? null;

  useEffect(() => {
    setCode("");
    setRejected(null);
  }, [loginId]);

  if (signIn.state === "idle") return null;
  const submitting = signIn.state === "running" && signIn.submitting;
  const submit = () => {
    setRejected(null);
    antigravity.submit(code).catch((error: unknown) => setRejected(error instanceof Error ? error.message : t(`${K}.errorGeneric`)));
  };

  return (
    <div className="engine-connect-prompt" role="group" aria-label={t(`${K}.antigravitySignIn`)}>
      {signIn.state === "failed" ? (
        <p className="engine-connect-prompt__error" role="alert">
          {signIn.message || t(`${K}.errorGeneric`)}
        </p>
      ) : (
        <p className="engine-connect-prompt__hint" aria-live="polite">
          {page ? (
            <>
              {t(`${K}.antigravityOpened`)}{" "}
              <button type="button" className="engine-connect-prompt__link" onClick={() => openExternalUrl(page.url)}>
                {t(`${LOGIN}.reopen`)}
              </button>
            </>
          ) : (
            t(`${K}.antigravityPreparing`)
          )}
        </p>
      )}
      {page ? (
        <input
          className="engine-connect-prompt__input"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={t(`${K}.antigravityCode`)}
          aria-label={t(`${K}.antigravityCode`)}
          autoComplete="off"
          spellCheck={false}
          disabled={submitting}
        />
      ) : null}
      {rejected ? (
        <p className="engine-connect-prompt__error" role="alert">
          {rejected}
        </p>
      ) : null}
      <div className="engine-connect-prompt__actions">
        <Button type="button" variant="ghost" onClick={antigravity.cancel}>
          {t("common.cancel")}
        </Button>
        {signIn.state === "failed" ? (
          <Button type="button" variant="primary" onClick={onStart}>
            {t(`${LOGIN}.startAgain`)}
          </Button>
        ) : page ? (
          <Button type="button" variant="primary" onClick={submit} disabled={submitting || !code.trim()}>
            {submitting ? t(`${LOGIN}.submitting`) : t(`${LOGIN}.submit`)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
