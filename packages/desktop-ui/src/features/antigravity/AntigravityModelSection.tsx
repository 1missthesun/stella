import type { ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { AntigravitySignInPrompt } from "./AntigravitySignInPrompt";
import { useAntigravity } from "./use-antigravity";

const K = "settings.engineAccounts";

/** Antigravity's models in the model picker, or its sign-in while this computer has none. */
export function AntigravityModelSection({ children }: { children: ReactNode }) {
  const t = useT();
  const antigravity = useAntigravity();
  const { status, signIn, start } = antigravity;
  if (!status || status.signedIn) return <>{children}</>;
  return (
    <div className="agent-model-picker-connection" role="status">
      {signIn.state === "idle" ? (
        <>
          {t(status.signInAgain ? `${K}.antigravityAgain` : `${K}.antigravityHint`)}{" "}
          <button type="button" onClick={() => void start()}>
            {t(`${K}.antigravitySignIn`)}
          </button>
        </>
      ) : (
        <AntigravitySignInPrompt antigravity={antigravity} onStart={() => void start()} />
      )}
    </div>
  );
}
