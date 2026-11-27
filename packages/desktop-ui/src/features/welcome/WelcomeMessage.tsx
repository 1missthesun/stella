import { useState, type ReactNode } from "react";
import {
  WELCOME_CLOSING,
  WELCOME_GREETING,
  WELCOME_ITEMS,
  WELCOME_LEAD,
} from "@stella/contracts/welcome-message";
import { Dialog, DialogBody, DialogCloseButton, DialogContent } from "@/ui/dialog";
import { LegalDialog } from "@/global/legal/LegalDialog";
import { ThemePicker } from "@/global/settings/ThemePicker";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { useT } from "@/shared/i18n";
import { useWelcomeActions } from "./use-welcome-actions";
import { ChooseAiCard } from "./ChooseAiCard";
import "./welcome.css";

// Stella's first message. The words come from contracts so every client and
// the model share them; each line carries buttons for what it describes, and
// a button disappears once that thing is done.

function LegalLine() {
  const t = useT();
  const [open, setOpen] = useState<"terms" | "privacy" | null>(null);
  const parts = t("onboarding.legalFooter").split(/\{(\w+)\}/);
  const link = (document: "terms" | "privacy", label: string) => (
    <button type="button" className="welcome-message__legal-link" onClick={() => setOpen(document)}>
      {label}
    </button>
  );
  const slots: Record<string, ReactNode> = {
    terms: link("terms", t("onboarding.termsOfService")),
    privacy: link("privacy", t("onboarding.privacyPolicy")),
  };
  return (
    <>
      <LegalDialog document={open} onOpenChange={(next) => (next ? undefined : setOpen(null))} />
      <p className="welcome-message__legal">
        {parts.map((part, index) => (
          <span key={index}>{index % 2 === 0 ? part : (slots[part] ?? `{${part}}`)}</span>
        ))}
      </p>
    </>
  );
}

function ChooseAiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fit className="choose-ai-dialog">
        <DialogCloseButton className="choose-ai-dialog__close" />
        <DialogBody>
          <ChooseAiCard
            onDone={() => {
              recordAnonymousCount({ type: "engine_chosen" });
              onOpenChange(false);
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function WelcomeMessage() {
  const [chooseAiOpen, setChooseAiOpen] = useState(false);
  const actionsFor = useWelcomeActions({ openChooseAi: () => setChooseAiOpen(true) });

  return (
    <div className="welcome-message" data-testid="welcome-message">
      <ChooseAiDialog open={chooseAiOpen} onOpenChange={setChooseAiOpen} />
      <div className="markdown">
        <p>{WELCOME_GREETING}</p>
        <p>{WELCOME_LEAD}</p>
        <ul>
          {WELCOME_ITEMS.map((item) => {
            const actions = actionsFor(item.id);
            return (
              <li key={item.id} data-welcome-item={item.id}>
                <strong>{item.title}</strong> {item.body}
                {actions.length > 0 ? (
                  <span className="welcome-message__actions">
                    {actions.map((action) => {
                      const button = (
                        <button
                          key={action.id}
                          type="button"
                          className={`welcome-message__action${action.quiet ? "" : " welcome-message__action--primary"}`}
                          data-welcome-action={`${item.id}:${action.id}`}
                          disabled={action.busy}
                          onClick={action.run}
                        >
                          {action.label}
                        </button>
                      );
                      return action.theme ? (
                        <ThemePicker key={action.id} trigger={button} side="top" align="start" />
                      ) : (
                        button
                      );
                    })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p>{WELCOME_CLOSING}</p>
      </div>
      <LegalLine />
    </div>
  );
}
