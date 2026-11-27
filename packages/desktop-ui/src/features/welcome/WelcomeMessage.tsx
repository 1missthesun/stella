import { useState, type ReactElement, type ReactNode } from "react";
import { Globe, LoaderCircle, LogIn, Mail, Palette, Play, Plug, Smartphone, type IconComponent } from "@/ui/icons";
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
import { useWelcomeActions, type WelcomeAction } from "./use-welcome-actions";
import { ChooseAiCard } from "./ChooseAiCard";
import "./welcome.css";

// Stella's first message. The words come from contracts so every client and
// the model share them; each point is a row with its one button on the
// right, like a settings row, and the button moves under the text when the
// message is narrow.

const ACTION_ICONS: Record<string, IconComponent> = {
  extension: Globe,
  gmail: Mail,
  signin: LogIn,
  phone: Smartphone,
  plan: Plug,
  theme: Palette,
};

function ActionButton({ action, item }: { action: WelcomeAction; item: string }) {
  const Icon = action.busy ? LoaderCircle : action.demo ? Play : ACTION_ICONS[action.id];
  const variant = action.primary ? " welcome-message__action--primary" : action.demo ? " welcome-message__action--demo" : "";
  const button = (
    <button
      type="button"
      className={`welcome-message__action${variant}`}
      data-welcome-action={`${item}:${action.id}`}
      disabled={action.busy}
      onClick={action.theme ? undefined : action.run}
    >
      {Icon ? (
        <Icon
          className={action.busy ? "welcome-message__icon welcome-message__icon--busy" : "welcome-message__icon"}
          size={action.demo ? 10 : 13}
          strokeWidth={action.demo ? 2 : 1.8}
          fill={action.demo && !action.busy ? "currentColor" : "none"}
          aria-hidden
        />
      ) : null}
      {action.label}
    </button>
  );
  return action.theme ? <ThemeAction button={button} onClosed={action.run} /> : button;
}

function ThemeAction({ button, onClosed }: { button: ReactElement; onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ThemePicker
      trigger={button}
      side="top"
      align="end"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onClosed?.();
      }}
    />
  );
}

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
  const actionFor = useWelcomeActions({ openChooseAi: () => setChooseAiOpen(true) });

  return (
    <div className="welcome-message" data-testid="welcome-message">
      <ChooseAiDialog open={chooseAiOpen} onOpenChange={setChooseAiOpen} />
      <div className="markdown welcome-message__body">
        <p className="welcome-message__greeting">{WELCOME_GREETING}</p>
        <p>{WELCOME_LEAD}</p>
        <div className="welcome-message__points">
          {WELCOME_ITEMS.map((item) => {
            const action = actionFor(item.id);
            return (
              <div key={item.id} className="welcome-message__point" data-welcome-item={item.id}>
                <p>
                  <strong>{item.title}</strong> {item.body}
                </p>
                {action ? <ActionButton action={action} item={item.id} /> : null}
              </div>
            );
          })}
        </div>
        <p className="welcome-message__closing">{WELCOME_CLOSING}</p>
      </div>
      <LegalLine />
    </div>
  );
}
