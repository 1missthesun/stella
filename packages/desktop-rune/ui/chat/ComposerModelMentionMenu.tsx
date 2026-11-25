import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { readRecentModels, recordRecentModel } from "@/global/settings/lib/recent-models";
import { useAntigravity } from "@/features/antigravity/use-antigravity";
import { useChatGptProfiles } from "@/features/chatgpt/use-chatgpt-profiles";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { planSignedInAt, useModelDestination } from "@/features/execution-placement/use-model-destination";
import {
  COMPOSER_ENGINE_MENTION_OPTIONS,
  filterComposerModelMentionOptions,
  resolveCurrentModelMentionValue,
  type ComposerModelMentionMenuHandle,
  type ComposerModelMentionOption,
  type ComposerModelMentionTrigger,
} from "@/app/chat/ComposerModelMentionMenu";
import { useT } from "@/shared/i18n";
import { BrandIcon } from "../kit/compat";
import { derive, fontSize, layer, mixOklch, useTokens, weight } from "../theme";
import { panelSurface } from "./surfaces";

type EngineMentionPreferences = { agentRuntimeEngine: "default" | "claude_code_local" | "codex_cli"; modelOverrides: Record<string, string> };

let cachedEngineMentionPreferences: EngineMentionPreferences | null = null;

const MENU_W = 300;
const MENU_MAX_H = 360;

function useEnginePlaceNotes(): (option: ComposerModelMentionOption) => string | undefined {
  const t = useT();
  const { destination, computers } = useModelDestination();
  const antigravity = useAntigravity().status?.signedIn;
  const chatGpt = useChatGptProfiles();
  const claude = useClaudeLocalAccounts();
  return (option) => {
    const plan = option.value === "stella" || option.value === "xai" ? undefined : option.value;
    if (!plan) return undefined;
    const here = plan === "antigravity" ? antigravity : plan === "chatgpt" ? !chatGpt.loaded || chatGpt.usable : !claude.loaded || claude.signedIn;
    if (destination.kind === "here" && here !== false) return undefined;
    const usedOn = (places: string) => t("settings.engineAccounts.claude.usedOn", { places });
    if (destination.kind !== "here" && planSignedInAt(destination, plan)) return destination.kind === "device" ? usedOn(destination.place) : undefined;
    if (destination.kind !== "here" && planSignedInAt(destination, plan) === undefined) return undefined;
    const others = computers.filter((computer) => computer.signedIn.includes(plan)).map((computer) => computer.label);
    if (destination.kind !== "here" && here) others.unshift(t("settings.engineAccounts.claude.thisComputerInline"));
    if (others.length > 0) return usedOn(others.join(", "));
    return destination.kind === "here" ? undefined : t("settings.engineAccounts.claude.notSignedIn");
  };
}

type ComposerModelMentionMenuProps = {
  trigger: ComposerModelMentionTrigger;
  /** The id of the composer input the menu opens above. */
  anchorTo: string;
  onSelect: (option: ComposerModelMentionOption) => void;
  onDismiss: () => void;
};

/** desktop-ui's `ComposerModelMentionMenu`: the engines an `@` mention can pick, above the composer input; the composer forwards its arrow, Enter, Tab and Escape keys. */
export const ComposerModelMentionMenu = forwardRef<ComposerModelMentionMenuHandle, ComposerModelMentionMenuProps>(function ComposerModelMentionMenu({ trigger, anchorTo, onSelect, onDismiss }, ref) {
  const t = useT();
  const tokens = useTokens();
  const c = tokens.c;
  const panel = panelSurface(tokens);
  const activeFill = derive(tokens, "chat:model-mention-active", (k) => mixOklch(k.c.foreground, 6, "transparent"));
  const [preferences, setPreferences] = useState<EngineMentionPreferences | null>(cachedEngineMentionPreferences);
  const [recentValues, setRecentValues] = useState(() => readRecentModels());
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadPreferences = async () => {
      const next = await window.electronAPI?.system?.getLocalModelPreferences?.();
      if (cancelled || !next) return;
      cachedEngineMentionPreferences = next;
      setPreferences(next);
    };
    void loadPreferences().catch(() => undefined);
    const handlePreferencesChanged = () => void loadPreferences().catch(() => undefined);
    window.addEventListener("stella:local-model-preferences-changed", handlePreferencesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("stella:local-model-preferences-changed", handlePreferencesChanged);
    };
  }, []);

  const placeNote = useEnginePlaceNotes();
  const currentValue = resolveCurrentModelMentionValue(preferences);
  const filteredOptions = useMemo(() => filterComposerModelMentionOptions(COMPOSER_ENGINE_MENTION_OPTIONS, trigger.query, { currentValue, recentValues }), [currentValue, recentValues, trigger.query]);
  const selectOption = useCallback(
    (option: ComposerModelMentionOption) => {
      setRecentValues(recordRecentModel(option.value));
      onSelect(option);
    },
    [onSelect],
  );
  const filteredOptionSignature = filteredOptions.map((option) => option.value).join("\u0000");

  useEffect(() => setActiveIndex(0), [filteredOptionSignature, trigger.query]);
  useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, filteredOptions.length - 1))), [filteredOptions.length]);

  useImperativeHandle(
    ref,
    () => ({
      handleKeyDown(event) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (filteredOptions.length > 0) setActiveIndex((current) => (current + 1) % filteredOptions.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          if (filteredOptions.length > 0) setActiveIndex((current) => (current - 1 + filteredOptions.length) % filteredOptions.length);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && filteredOptions[activeIndex]) {
          event.preventDefault();
          selectOption(filteredOptions[activeIndex]);
          return true;
        }
        return false;
      },
    }),
    [activeIndex, filteredOptions, onDismiss, selectOption],
  );

  return (
    <col
      id="composer-model-mention-options"
      role="listbox"
      label={t("app.chat.modelMention.enginesLabel")}
      anchor={{ to: anchorTo, side: "top", align: "start", gap: 8 }}
      raise={layer.menu}
      w={MENU_W}
      maxH={MENU_MAX_H}
      radius={11}
      clip={11}
      border={panel.border}
      fill={c.panelSurfaceBg}
      backdropBlur={22}
      shadows={[...tokens.shadow.lg, ...panel.shadows]}
    >
      <col w="full" minH={0} scrollY pad={4 + 1} align="stretch">
        {filteredOptions.map((option, index) => {
          const note = placeNote(option);
          return (
            <row
              key={option.value}
              id={`composer-model-mention-${index}`}
              role="option"
              selected={index === activeIndex}
              label={option.label}
              w="full"
              minH={34}
              align="center"
              gap={7}
              py={4}
              px={6}
              radius={7}
              fill={index === activeIndex ? activeFill : undefined}
              hoverFill={activeFill}
              onHover={(inside) => inside && setActiveIndex(index)}
              onPress={() => selectOption(option)}
            >
              <box w={18} h={18} center shrink={false}>
                <BrandIcon brand={option.brand} size={14} />
              </box>
              <text maxW="60%" minW={0} shrink={false} size={12} weight={weight.medium} color={c.textStrong} nowrap truncate>
                {option.label}
              </text>
              {note ? (
                <text minW={0} grow={1} shrink textAlign="end" size={fontSize["2xs"]} color={c.textWeak} nowrap truncate title={note}>
                  {note}
                </text>
              ) : null}
            </row>
          );
        })}
        {filteredOptions.length === 0 ? (
          <text py={10} px={12} size={12} color={c.textWeak}>
            {t("app.chat.modelMention.noMatch")}
          </text>
        ) : null}
      </col>
    </col>
  );
});
