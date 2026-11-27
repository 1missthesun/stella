import { Button, Input, Press, T, tx } from "../../kit/compat";
import { useEngineConnectPrompt } from "../cloud/EngineConnectPrompt.styles";
import { useEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import type { ClaudeLogin } from "@/features/claude/use-claude-login";

const K = "settings.engineAccounts.claudeLogin";

export function ClaudeLoginPrompt({ login }: { login: ClaudeLogin }) {
  const s = useEngineConnectPrompt();
  const t = useT();
  const [code, setCode] = useState("");
  const { flow, starting, submitting, error, failed } = login;
  const loginId = flow?.loginId ?? null;
  const approving = flow !== null && !flow.pasting;

  useEffect(() => {
    if (loginId) setCode("");
  }, [loginId]);

  if (!login.open) return null;
  const target = flow?.target ?? starting ?? failed;
  const where =
    target?.place === "cloud"
      ? t(`${K}.whereCloud`)
      : target?.place === "device"
        ? t(`${K}.whereDevice`, {
            place: target.deviceName ?? t("settings.engineAccounts.claude.otherComputer"),
          })
        : t(`${K}.whereComputer`);

  return (
    <col {...s.engineConnectPrompt} role="group" label={where}>
      <T w="full" {...s.engineConnectPromptHint}>
        {starting ? (
          t(`${K}.starting`)
        ) : failed && !flow ? (
          where
        ) : approving ? (
          <>
            {where} {t(`${K}.approve`)}{" "}
            <Press text={tx(s.engineConnectPromptHint)} {...s.engineConnectPromptLink} onPress={login.reopen}>
              {t(`${K}.useCode`)}
            </Press>
          </>
        ) : (
          <>
            {where} {t(`${K}.opened`)}{" "}
            {flow ? (
              <Press text={tx(s.engineConnectPromptHint)} {...s.engineConnectPromptLink} onPress={login.reopen}>
                {t(`${K}.reopen`)}
              </Press>
            ) : null}
          </>
        )}
      </T>
      {approving ? null : (
        <Input {...s.engineConnectPromptInput} type="text" value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && flow) void login.submit(code);
          }} placeholder={t(`${K}.codeLabel`)} label={t(`${K}.codeLabel`)} autoComplete="off" spellCheck={false} disabled={!flow || submitting} />
      )}
      {failed ? (
        <T w="full" {...s.engineConnectPromptError} role="alert">
          {error ?? t(`${K}.failed`)}
        </T>
      ) : null}
      <row {...s.engineConnectPromptActions}>
        <Button variant="ghost" onClick={login.cancel}>
          {t("common.cancel")}
        </Button>
        {failed ? (
          <Button variant="primary" onClick={login.restart}>
            {t(`${K}.startAgain`)}
          </Button>
        ) : approving ? null : (
          <Button variant="primary" onClick={() => void login.submit(code)} disabled={!flow || submitting || !code.trim()}>
            {submitting ? t(`${K}.submitting`) : t(`${K}.submit`)}
          </Button>
        )}
      </row>
    </col>
  );
}
