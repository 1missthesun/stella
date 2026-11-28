import { useEffect } from "react";
import type { EngineConnection, EngineProvider } from "@stella/contracts/backend/engines";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useT } from "@/shared/i18n";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { glyph } from "../icons";
import { ChoiceRow, Dot, rt, SectionLabel, TEXT, TextAction, useRn } from "../rn";
import { Note, openMenu, Spinner, Switcher, tapLight, type MenuChoice } from "./kit";
import { ProviderMark } from "./ProviderMark";
import { REASONING_OPTIONS, type Brain, type ModelSettings } from "./use-model-settings";

// packages/mobile's chat-settings/BrainSection: the model switcher (the built-in brains, then
// Other for the providers page), the current brain's first models with a dot on the chosen one,
// "All N models", the Thinking row, and the engine's Account row.

const SHORT_LIST = 5;

export const brainReady = (brain: Brain, settings: ModelSettings) => {
  if (brain.id === settings.brainId) return true;
  if (brain.kind === "provider") return brain.provider.connection?.status === "ok";
  if (brain.kind === "computer") return (settings.computerSignIns[brain.provider]?.length ?? 0) > 0;
  if (brain.engine === "stella") return true;
  return settings.connectedProviders?.includes(brain.engine) ?? false;
};

export function BrainSection({ settings, active, onOpenProviders, onOpenBrain }: { settings: ModelSettings; active: boolean; onOpenProviders: () => void; onOpenBrain: (brainId: string) => void }) {
  const c = useRn();
  const t = useT();
  const { refresh } = settings;

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const ready = settings.execution !== null;
  const current = settings.brains.find((brain) => brain.id === settings.brainId) ?? settings.brains[0];
  const models = settings.modelsFor(settings.brainId);
  const chosen = models.find((model) => model.selected);
  const shown = models.slice(0, SHORT_LIST);
  if (chosen && !shown.includes(chosen)) shown[shown.length - 1] = chosen;
  const loadingModels = current?.kind === "provider" && settings.providerModelState(current.provider.id)?.status === "loading";
  const moreLabel = models.length > SHORT_LIST ? `All ${models.length} models` : current?.kind === "provider" ? "Manage" : null;

  const switchTo = (brain: Brain) => {
    if (brain.id === settings.brainId) return;
    tapLight();
    if (brain.kind === "engine") {
      settings.selectEngine(brain.engine);
      return;
    }
    if (brain.kind === "computer") {
      settings.selectProviderModel(brain.provider, settings.computerDefaultModel);
      return;
    }
    void settings.loadProviderModels(brain.provider.id).then((list) => {
      const first = list?.[0];
      if (first) settings.selectProviderModel(brain.provider.id, first.id);
      else onOpenBrain(brain.id);
    });
  };

  const choices: MenuChoice[] = [
    ...settings.brains
      .filter((brain) => brain.kind === "engine" || brain.kind === "computer")
      .map((brain): MenuChoice => ({ id: brain.id, label: brain.label, selected: brain.id === settings.brainId, run: () => switchTo(brain) })),
    { id: "other", label: "Other", selected: current?.kind === "provider", run: onOpenProviders },
  ];
  const title = current?.label ?? "Stella";

  return (
    <col w="full">
      <SectionLabel trailing={!ready ? <Spinner color={c.textMuted} /> : null}>Model</SectionLabel>
      <Switcher
        id="phone-chat-settings-model"
        mark={<ProviderMark provider={current?.mark ?? "stella"} size={26} />}
        title={title}
        label={`Model provider: ${title}`}
        disabled={!ready}
        onPress={() => void openMenu(choices, t("mobile.common.cancel"))}
      />
      <col ml={42} mt={2} role="radiogroup">
        {loadingModels ? (
          <box selfAlign="start" my={12}>
            <Spinner color={c.textMuted} />
          </box>
        ) : models.length === 0 ? (
          <Note>No models available.</Note>
        ) : (
          shown.map((model) => (
            <ChoiceRow
              key={model.id}
              id={`phone-chat-settings-model-${model.id}`}
              label={model.label}
              selected={model.selected}
              disabled={!model.available}
              onPress={() => {
                if (model.selected) return;
                tapLight();
                settings.selectModel(model.id);
              }}
            />
          ))
        )}
        {current && moreLabel ? <TextAction label={moreLabel} onPress={() => onOpenBrain(current.id)} /> : null}
      </col>
    </col>
  );
}

export const accountsEngine = (settings: ModelSettings): EngineProvider | null => {
  const current = settings.brains.find((brain) => brain.id === settings.brainId);
  return current?.kind === "engine" && current.engine !== "stella" ? current.engine : null;
};

export const accountInitials = (row: Pick<EngineConnection, "email" | "label">): string => {
  const source = (row.email ?? row.label).split("@")[0] ?? "";
  const words = source.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase() || "?";
};

const AVATAR_TEXT = rt(13, 700, -0.2);

export function EngineAccountRow({ provider, onPress }: { provider: EngineProvider; onPress: () => void }) {
  const c = useRn();
  const t = useT();
  const engines = useBackendValue("engines.get", {});
  const accounts = (engines?.connections ?? []).filter((row) => row.provider === provider);
  let row: EngineConnection | undefined;
  let label: string;
  let detail: string | undefined;
  let warn = false;
  if (provider === "anthropic") {
    const chosenId = engines?.claude?.chosenAccountId ?? null;
    row = accounts.find((entry) => entry.accountId === chosenId);
    if (row) {
      label = row.email ?? row.label;
      detail = row.plan ? `${row.plan.charAt(0).toUpperCase()}${row.plan.slice(1)}` : undefined;
    } else if (accounts.length > 0 || engines?.claude) {
      label = t("settings.engineAccounts.claude.automatic");
    } else {
      label = t("mobile.engineAccounts.connectClaude");
    }
  } else {
    row = accounts.find((entry) => entry.active);
    if (row) {
      label = row.email ?? row.name ?? row.label;
      warn = !isEngineConnectionUsable(row);
      detail =
        row.status === "signed_out"
          ? t("mobile.engineAccounts.statusSignedOut")
          : row.status === "reauth_required"
            ? t("mobile.engineAccounts.statusReauth")
            : row.planUsage === false
              ? t("mobile.engineAccounts.statusPlanUsageOff")
              : row.plan;
    } else {
      label = t("mobile.engineAccounts.connectChatgpt");
    }
  }
  if (!engines) label = "";

  return (
    <col w="full">
      <SectionLabel>Account</SectionLabel>
      <row
        id="phone-chat-settings-account"
        role="button"
        label={`Account: ${label}`}
        focusable
        minH={56}
        py={6}
        gap={12}
        align="center"
        pressScale={0.98}
        onPress={() => {
          tapLight();
          onPress();
        }}
      >
        <box w={32} h={32} radius={16} center fill={c.surfaceInset} shrink={false}>
          {row ? (
            <text {...AVATAR_TEXT} color={c.text} maxLines={1}>
              {accountInitials(row)}
            </text>
          ) : (
            <ProviderMark provider={provider} size={20} />
          )}
        </box>
        <col grow={1} minW={0}>
          <text {...TEXT.identityPrimary} color={c.text} maxLines={1} truncate="middle">
            {label}
          </text>
          {detail ? (
            <text {...TEXT.choiceDetail} color={warn ? c.warning : c.textMuted} mt={1} maxLines={1}>
              {detail}
            </text>
          ) : null}
        </col>
        {!engines ? <Spinner color={c.textMuted} /> : warn ? <Icon icon={glyph("alert-circle")} size={16} color={c.warning} /> : <Icon icon={glyph("chevron-right")} size={14} color={c.textWeaker} />}
      </row>
    </col>
  );
}

const EFFORT_LABEL = rt(16, 600, -0.3);

export function ThinkingRow({ settings }: { settings: ModelSettings }) {
  const c = useRn();
  const effort = settings.effort;
  return (
    <col w="full">
      <SectionLabel>Thinking</SectionLabel>
      <row w="full" justify="between" pr={6} role="radiogroup">
        {REASONING_OPTIONS.map((option) => {
          const picked = option.id === effort;
          return (
            <col
              key={option.id}
              id={`phone-chat-settings-effort-${option.id}`}
              role="radio"
              label={`Thinking ${option.label}`}
              selected={picked}
              focusable
              align="center"
              justify="center"
              gap={4}
              minH={40}
              minW={34}
              pressScale={picked ? undefined : 0.96}
              onPress={() => {
                if (picked) return;
                tapLight();
                settings.selectEffort(option.id);
              }}
            >
              <text {...EFFORT_LABEL} color={picked ? c.text : c.textMuted} maxLines={1}>
                {option.label}
              </text>
              <box w={6} h={6}>
                {picked ? <Dot size={6} /> : null}
              </box>
            </col>
          );
        })}
      </row>
    </col>
  );
}
