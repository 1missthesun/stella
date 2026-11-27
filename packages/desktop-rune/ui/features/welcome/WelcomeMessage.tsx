import { useId, useState, type ReactNode } from "react";
import { WELCOME_CLOSING, WELCOME_GREETING, WELCOME_ITEMS, WELCOME_LEAD, welcomeItemMarkdown } from "@stella/contracts/welcome-message";
import { useWelcomeActions, type WelcomeAction } from "@/features/welcome/use-welcome-actions";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { useT } from "@/shared/i18n";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, Press, T, tx } from "../../kit/compat";
import { look, fontSize, radius, useTokens } from "../../theme";
import { Markdown } from "../../chat/Markdown";
import { scheduleCardLook } from "../../chat/cards/ScheduleCard";
import { ThemePicker } from "../../settings/ThemePicker";
import { LegalDialog } from "../../global/legal/LegalDialog";
import { ChooseAiCard } from "./ChooseAiCard";

/** desktop-ui's `WelcomeMessage`: Stella's first message, each line with buttons for what it describes. */
export function WelcomeMessage() {
  const [chooseAiOpen, setChooseAiOpen] = useState(false);
  // The demos are DOM films, which the Rune viewer can't play yet.
  const actionsFor = useWelcomeActions({ openChooseAi: () => setChooseAiOpen(true), demos: false });
  return (
    <col w="full" gap={0} id="welcome-message">
      <ChooseAiDialog open={chooseAiOpen} onOpenChange={setChooseAiOpen} />
      <Markdown text={`${WELCOME_GREETING}\n\n${WELCOME_LEAD}`} cacheKey="welcome:lead" />
      {WELCOME_ITEMS.map((item, index) => {
        const actions = actionsFor(item.id);
        return (
          <col key={item.id} w="full" mt={index === 0 ? 8 : 0} id={`welcome-item:${item.id}`}>
            <Markdown text={welcomeItemMarkdown(item)} cacheKey={`welcome:${item.id}`} />
            {actions.length > 0 ? (
              <row wrap align="center" gap={14} rowGap={8} pl={24} mt={2} mb={4}>
                {actions.map((action) => (
                  <WelcomeButton key={action.id} itemId={item.id} action={action} />
                ))}
              </row>
            ) : null}
          </col>
        );
      })}
      <col w="full" mt={8}>
        <Markdown text={WELCOME_CLOSING} cacheKey="welcome:closing" />
      </col>
      <LegalLine />
    </col>
  );
}

function WelcomeButton({ itemId, action }: { itemId: string; action: WelcomeAction }) {
  const t = useTokens();
  const anchor = `welcome-action:${itemId}:${action.id}:${useId()}`;
  const [themeOpen, setThemeOpen] = useState(false);
  const run = action.theme ? () => setThemeOpen((open) => !open) : action.run;
  return (
    <>
      <box
        id={anchor}
        role="button"
        label={action.label}
        focusable
        disabled={action.busy}
        opacity={action.busy ? 0.6 : 1}
        cursor="pointer"
        my={-2}
        py={4}
        px={10}
        radius={radius.full}
        fill={t.c.interactive}
        hoverFill={action.busy ? undefined : scheduleCardLook(t).primaryHover}
        onPress={action.busy ? undefined : run}
      >
        <text {...look(fontSize.sm, 500)} lineHeight={14} color={t.c.interactiveForeground}>
          {action.label}
        </text>
      </box>
      {action.theme && themeOpen ? <ThemePicker hideTrigger open={themeOpen} onOpenChange={setThemeOpen} side="top" align="start" anchor={anchor} /> : null}
    </>
  );
}

function ChooseAiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fit maxW={500}>
        <DialogCloseButton absolute={{ top: 14, right: 14 }} raise />
        <DialogBody pt={26} px={24} pb={22}>
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

function LegalLine() {
  const t = useT();
  const tokens = useTokens();
  const [open, setOpen] = useState<"terms" | "privacy" | null>(null);
  const parts = t("onboarding.legalFooter").split(/\{(\w+)\}/);
  const line = { size: fontSize.xs, lh: 1.5, color: tokens.c.textWeaker };
  const link = { pad: 0, color: tokens.c.textWeak, underline: true, hoverColor: tokens.c.textStrong };
  const slots: Record<string, ReactNode> = {
    terms: (
      <Press {...link} onPress={() => setOpen("terms")}>
        {t("onboarding.termsOfService")}
      </Press>
    ),
    privacy: (
      <Press {...link} onPress={() => setOpen("privacy")}>
        {t("onboarding.privacyPolicy")}
      </Press>
    ),
  };
  return (
    <>
      <LegalDialog document={open} onOpenChange={(next) => (next ? undefined : setOpen(null))} />
      <T w="full" mt={14} {...line}>
        {parts.map((part, index) => (
          <T {...tx(line)} key={index}>
            {index % 2 === 0 ? part : (slots[part] ?? `{${part}}`)}
          </T>
        ))}
      </T>
    </>
  );
}
