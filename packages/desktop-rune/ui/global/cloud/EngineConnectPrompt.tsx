import { Button, Input, T } from "../../kit/compat";
import { useEngineConnectPrompt } from "./EngineConnectPrompt.styles";
import { useState } from "react";
import { useT } from "@/shared/i18n";
import type { EngineConnect } from "@/features/cloud/use-engine-connect";

export function EngineConnectPrompt({ connect }: { connect: EngineConnect }) {
  const s = useEngineConnectPrompt();
  const t = useT();
  const { flow, error, busy } = connect;
  const [pasted, setPasted] = useState("");
  if (!flow) return null;

  if (flow.kind === "paste") {
    return (
      <col {...s.engineConnectPrompt} role="group">
        <T w="full" {...s.engineConnectPromptHint}>
          {t("settings.engineAccounts.pasteHintChatgpt")}
        </T>
        <Input {...s.engineConnectPromptInput} type="url" value={pasted} onChange={(event) => setPasted(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") void connect.finish(pasted);
          }} placeholder={t("settings.engineAccounts.pastePlaceholderUrl")} label={t("settings.engineAccounts.pastePlaceholderUrl")} autoComplete="off" spellCheck={false} disabled={busy} />
        {error ? (
          <T w="full" {...s.engineConnectPromptError} role="alert">
            {error}
          </T>
        ) : null}
        <row {...s.engineConnectPromptActions}>
          <Button variant="ghost" onClick={connect.cancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="ghost" onClick={connect.openAuthorizePage}>
            {t("settings.engineAccounts.openChatgptAgain")}
          </Button>
          <Button variant="primary" onClick={() => void connect.finish(pasted)} disabled={busy || !pasted.trim()}>
            {busy ? t("settings.engineAccounts.connecting") : t("settings.engineAccounts.finish")}
          </Button>
        </row>
      </col>
    );
  }

  return (
    <col {...s.engineConnectPrompt} role="group">
      <T w="full" {...s.engineConnectPromptHint}>
        {t("settings.engineAccounts.chatgptBrowserWaiting")}
      </T>
      <row {...s.engineConnectPromptActions}>
        <Button variant="ghost" onClick={connect.cancel}>
          {t("common.cancel")}
        </Button>
      </row>
    </col>
  );
}
