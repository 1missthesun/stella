import { useId, useState, type ReactNode } from "react";
import { WELCOME_CLOSING, WELCOME_GREETING, WELCOME_ITEMS, WELCOME_LEAD } from "@stella/contracts/welcome-message";
import { useWelcomeActions, type WelcomeAction } from "@/features/welcome/use-welcome-actions";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { useT } from "@/shared/i18n";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, Press, T, tx } from "../../kit/compat";
import { Icon, Icons, withStroke, type IconData } from "../../kit";
import { look, fontSize, mix, useTokens } from "../../theme";
import { Markdown } from "../../chat/Markdown";
import { ThemePicker } from "../../settings/ThemePicker";
import { LegalDialog } from "../../global/legal/LegalDialog";
import { ChooseAiCard } from "./ChooseAiCard";

const ACTION_ICONS: Record<string, IconData> = {
  extension: Icons.stella.Globe,
  gmail: Icons.stella.Mail,
  signin: Icons.stella.LogIn,
  phone: Icons.stella.Smartphone,
  plan: Icons.stella.Plug,
  theme: Icons.stella.Palette,
};

// Under this width (the 480px window) each button drops under its text, as
// desktop-ui's container query does.
const NARROW_BELOW = 500;

/** desktop-ui's `WelcomeMessage`: Stella's first message, points separated by space, each with at most one button on the right of its text (under it when narrow); all the text ends at one edge, with the buttons in a column as wide as the widest. */
export function WelcomeMessage() {
  const t = useTokens();
  const [chooseAiOpen, setChooseAiOpen] = useState(false);
  // The demos are DOM films, which the Rune viewer can't play yet.
  const actionFor = useWelcomeActions({ openChooseAi: () => setChooseAiOpen(true), demos: false });
  const hairline = mix(t.c.chatAssistantBubbleText, 11, "transparent");
  const [width, setWidth] = useState(0);
  const [buttonWidths, setButtonWidths] = useState<Record<string, number>>({});
  const narrow = width > 0 && width < NARROW_BELOW;
  const rows = WELCOME_ITEMS.map((item) => ({ item, action: actionFor(item.id) }));
  const column = Math.max(0, ...rows.map(({ item, action }) => (action ? (buttonWidths[item.id] ?? 0) : 0)));
  return (
    <col w="full" gap={0} id="welcome-message">
      <ChooseAiDialog open={chooseAiOpen} onOpenChange={setChooseAiOpen} />
      <Markdown text={`**${WELCOME_GREETING}**\n\n${WELCOME_LEAD}`} cacheKey="welcome:lead" />
      <col w="full" mt={14} gap={14} onLayout={(r) => setWidth(Math.round(r.w))}>
        {rows.map(({ item, action }) => {
          const button = action ? (
            <WelcomeButton
              itemId={item.id}
              action={action}
              hairline={hairline}
              onWidth={(w) => setButtonWidths((prev) => (prev[item.id] === w ? prev : { ...prev, [item.id]: w }))}
            />
          ) : null;
          const text = <Markdown text={`**${item.title}** ${item.body}`} cacheKey={`welcome:${item.id}`} />;
          return narrow ? (
            <col key={item.id} w="full" gap={8} id={`welcome-item:${item.id}`}>
              {text}
              {button ? <row>{button}</row> : null}
            </col>
          ) : (
            <row key={item.id} w="full" align="center" gap={column > 0 ? 24 : 0} id={`welcome-item:${item.id}`}>
              <col grow={1} minW={0}>
                {text}
              </col>
              <row w={column > 0 ? column : undefined} justify="end">
                {button}
              </row>
            </row>
          );
        })}
      </col>
      <col w="full" mt={14}>
        <Markdown text={WELCOME_CLOSING} cacheKey="welcome:closing" />
      </col>
      <LegalLine />
    </col>
  );
}

// One button family: neutral for every setup step, the same box outlined for
// demos, and the accent only on the primary one (Sign in while signed out).
function WelcomeButton({ itemId, action, hairline, onWidth }: { itemId: string; action: WelcomeAction; hairline: string; onWidth: (w: number) => void }) {
  const t = useTokens();
  const anchor = `welcome-action:${itemId}:${action.id}:${useId()}`;
  const [themeOpen, setThemeOpen] = useState(false);
  const run = action.theme ? () => setThemeOpen((open) => !open) : action.run;
  // The theme line's `run` marks the picker seen once it closes.
  const onThemeOpenChange = (open: boolean) => {
    setThemeOpen(open);
    if (!open) action.run?.();
  };
  const primary = Boolean(action.primary);
  const demo = Boolean(action.demo) && !primary;
  const icon = action.busy ? Icons.stella.LoaderCircle : demo ? Icons.stella.Play : ACTION_ICONS[action.id];
  const label = primary ? t.c.interactiveForeground : demo ? t.c.textWeak : t.c.textStrong;
  return (
    <>
      <box
        id={anchor}
        role="button"
        label={action.label}
        focusable
        disabled={action.busy}
        opacity={action.busy ? 0.6 : 1}
        cursor={action.busy ? undefined : "pointer"}
        align="center"
        gap={6}
        h={28}
        px={10}
        radius={8}
        fill={primary ? t.c.interactive : demo ? "transparent" : t.c.card}
        border={primary ? t.c.interactive : hairline}
        hoverFill={action.busy ? undefined : primary ? mix(t.c.foreground, 10, t.c.interactive) : demo ? mix(t.c.foreground, 5, "transparent") : mix(t.c.foreground, 4, t.c.card)}
        hoverBorder={action.busy || primary ? undefined : mix(t.c.foreground, 17, "transparent")}
        onPress={action.busy ? undefined : run}
        onLayout={(r) => onWidth(Math.ceil(r.w))}
      >
        {icon ? (
          <Icon
            icon={withStroke(icon, demo ? 2 : 1.8)}
            size={demo ? 10 : 13}
            color={primary ? t.c.interactiveForeground : t.c.textWeak}
            spin={action.busy ? 1 : undefined}
          />
        ) : null}
        <text {...look(fontSize.sm, 500)} lineHeight={14} color={label}>
          {action.label}
        </text>
      </box>
      {action.theme && themeOpen ? <ThemePicker hideTrigger open={themeOpen} onOpenChange={onThemeOpenChange} side="top" align="end" anchor={anchor} /> : null}
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
      <T w="full" mt={10} {...line}>
        {parts.map((part, index) => (
          <T {...tx(line)} key={index}>
            {index % 2 === 0 ? part : (slots[part] ?? `{${part}}`)}
          </T>
        ))}
      </T>
    </>
  );
}
