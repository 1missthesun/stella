import { Button, Input, Press, T, tx } from "../../kit/compat";
import { useEngineConnectPrompt } from "../cloud/EngineConnectPrompt.styles";
import { useEffect, useState } from "react";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useT } from "@/shared/i18n";
import type { Antigravity } from "@/features/antigravity/use-antigravity";

const K = "settings.engineAccounts";
const LOGIN = `${K}.claudeLogin`;

export function AntigravitySignInPrompt({
  antigravity,
  onStart,
}: {
  antigravity: Antigravity;
  onStart: () => void;
}) {
  const s = useEngineConnectPrompt();
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
    <col {...s.engineConnectPrompt} role="group" label={t(`${K}.antigravitySignIn`)}>
      {signIn.state === "failed" ? (
        <T w="full" {...s.engineConnectPromptError} role="alert">
          {signIn.message || t(`${K}.errorGeneric`)}
        </T>
      ) : (
        <T w="full" {...s.engineConnectPromptHint}>
          {page ? (
            <>
              {t(`${K}.antigravityOpened`)}{" "}
              <Press text={tx(s.engineConnectPromptHint)} {...s.engineConnectPromptLink} onPress={() => openExternalUrl(page.url)}>
                {t(`${LOGIN}.reopen`)}
              </Press>
            </>
          ) : (
            t(`${K}.antigravityPreparing`)
          )}
        </T>
      )}
      {page ? (
        <Input {...s.engineConnectPromptInput} type="text" value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }} placeholder={t(`${K}.antigravityCode`)} label={t(`${K}.antigravityCode`)} autoComplete="off" spellCheck={false} disabled={submitting} />
      ) : null}
      {rejected ? (
        <T w="full" {...s.engineConnectPromptError} role="alert">
          {rejected}
        </T>
      ) : null}
      <row {...s.engineConnectPromptActions}>
        <Button variant="ghost" onClick={antigravity.cancel}>
          {t("common.cancel")}
        </Button>
        {signIn.state === "failed" ? (
          <Button variant="primary" onClick={onStart}>
            {t(`${LOGIN}.startAgain`)}
          </Button>
        ) : page ? (
          <Button variant="primary" onClick={submit} disabled={submitting || !code.trim()}>
            {submitting ? t(`${LOGIN}.submitting`) : t(`${LOGIN}.submit`)}
          </Button>
        ) : null}
      </row>
    </col>
  );
}
