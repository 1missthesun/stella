import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { AntigravitySignInPrompt } from "./AntigravitySignInPrompt";
import { useAntigravity } from "./use-antigravity";
import "./antigravity.css";

const K = "settings.engineAccounts";

/** Antigravity's models in the model picker, or its sign-in while this computer has none. */
export function AntigravityModelSection({ children }: { children: ReactNode }) {
  const t = useT();
  const antigravity = useAntigravity();
  const { status, signIn, start } = antigravity;
  if (!status || status.signedIn) return <>{children}</>;
  if (signIn.state !== "idle") {
    return (
      <div className="antigravity-picker-prompt">
        <AntigravitySignInPrompt antigravity={antigravity} onStart={() => void start()} />
      </div>
    );
  }
  return (
    <div className="antigravity-picker-sign-in">
      <p className="antigravity-picker-sign-in__hint">
        {t(status.signInAgain ? `${K}.antigravityAgain` : `${K}.antigravityHint`)}
      </p>
      <Button type="button" variant="ghost" className="pill-btn" onClick={() => void start()}>
        {t(`${K}.antigravitySignIn`)}
      </Button>
    </div>
  );
}
