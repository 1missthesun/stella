import { currentModelReference } from "@stella/contracts/engine-model-catalog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStellaModelsSignIn } from "@/global/auth/hooks/use-stella-models-sign-in";
import { saveModelSelection } from "@/global/settings/lib/save-model-selection";
import { openModelPicker } from "@/features/workspace-display/default-tabs";
import { useModelCatalog } from "@/global/settings/hooks/use-model-catalog";
import { getStellaResolvedModelName } from "@/global/settings/lib/model-catalog";
import { buildModelDefaultsMap, buildResolvedModelDefaultsMap, getConfigurableAgents, getLocalModelDefaults, getModelPickerDisplayLabel, normalizeModelOverrides } from "@/global/settings/lib/model-defaults";
import { buildEngineReasoningPatch, buildRecentModelSelectionPatch, getActiveEngineModelId, isStellaModelId } from "@/global/settings/lib/engine-model-routing";
import { listReasoningEffortOptions } from "@/global/settings/lib/reasoning-effort-options";
import { normalizeReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import { buildRecentModelRows, createKnownModelIdPredicate, readRecentModels, recordRecentModel } from "@/global/settings/lib/recent-models";
import { modelBlockedAt, planOfModel, useModelDestination } from "@/features/execution-placement/use-model-destination";
import { enginePlaceBadge } from "@/features/execution-placement/EnginePlace";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { APP_TRACKING, BODY_TEXT, BrandIcon, Popover, PopoverContent, PopoverTrigger } from "../kit/compat";
import { Icon, Icons } from "../kit";
import { derive, fontSize, look, mixOklch, radius, useTokens } from "../theme";
import { panelSurface } from "./surfaces";

type LocalModelPreferences = NonNullable<Awaited<ReturnType<NonNullable<NonNullable<NonNullable<typeof window.electronAPI>["system"]>["getLocalModelPreferences"]>>>>;
type RecentRow = ReturnType<typeof buildRecentModelRows>[number];

const ASSISTANT_AGENT_KEYS = ["orchestrator", "general"];
const NO_EXCLUDED_IDS = new Set<string>();
const XS_MEDIUM = look(fontSize.xs, 500, { em: BODY_TEXT.em, lh: BODY_TEXT.lh, family: BODY_TEXT.family });
const TRIGGER_LABEL = { ...look(fontSize.xs, 400), tracking: APP_TRACKING };
const TRIGGER_MAX_W = 180;
const POPOVER_W = 292;

const getModelBrandKey = (modelId: string, providersById: Map<string, string>) => {
  if (modelId.startsWith("claude-code/")) return "anthropic";
  if (modelId.startsWith("codex-cli/")) return "openai";
  return providersById.get(modelId) ?? modelId.split("/")[0] ?? "stella";
};

let cachedMiniPickerPreferences: LocalModelPreferences | null = null;

const useMiniPickerLook = () =>
  derive(useTokens(), "chat:mini-model-picker", (k) => ({
    hover: mixOklch(k.c.foreground, 6, "transparent"),
    focus: mixOklch(k.c.primary, 38, "transparent"),
  }));

/** desktop-ui's `MiniModelPicker`: the composer's model pill, opening reasoning effort, recent models and the full picker. */
export function MiniModelPicker() {
  const t = useT();
  const tokens = useTokens();
  const c = tokens.c;
  const panel = panelSurface(tokens);
  const l = useMiniPickerLook();
  const { destination } = useModelDestination();
  const askToSignInForStella = useStellaModelsSignIn();
  const { allModels, defaults: stellaDefaultModels } = useModelCatalog();
  const [preferences, setPreferencesRaw] = useState<LocalModelPreferences | null>(cachedMiniPickerPreferences);
  const [recentIds, setRecentIds] = useState(() => readRecentModels());
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const setPreferences = useCallback((next: LocalModelPreferences | null) => {
    if (next) cachedMiniPickerPreferences = next;
    setPreferencesRaw(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPreferences = async () => {
      const next = await window.electronAPI?.system?.getLocalModelPreferences?.();
      if (cancelled || !next) return;
      cachedMiniPickerPreferences = next;
      setPreferencesRaw(next);
    };
    void loadPreferences().catch(() => undefined);
    const handlePreferencesChanged = () => void loadPreferences().catch(() => undefined);
    window.addEventListener("stella:local-model-preferences-changed", handlePreferencesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("stella:local-model-preferences-changed", handlePreferencesChanged);
    };
  }, []);

  useEffect(() => {
    if (open) setRecentIds(readRecentModels());
  }, [open]);

  const modelNamesById = useMemo(() => {
    const next = new Map<string, string>();
    for (const model of allModels) {
      const label = model.provider === "stella" ? getStellaResolvedModelName(model) : model.name;
      next.set(model.id, label);
      if (model.upstreamModel) next.set(model.upstreamModel, label);
    }
    return next;
  }, [allModels]);
  const modelProvidersById = useMemo(() => {
    const next = new Map<string, string>();
    for (const model of allModels) {
      next.set(model.id, model.provider);
      if (model.upstreamModel) next.set(model.upstreamModel, model.provider);
    }
    return next;
  }, [allModels]);
  const modelDefaults = useMemo(() => (preferences ? getLocalModelDefaults(preferences.defaultModels, stellaDefaultModels) : undefined), [preferences, stellaDefaultModels]);
  const configurableAgentKeys = useMemo(() => getConfigurableAgents(modelDefaults).map((agent) => agent.key), [modelDefaults]);
  const overrides = useMemo(() => (preferences ? normalizeModelOverrides(preferences.modelOverrides) : {}), [preferences]) as Record<string, string | undefined>;
  const committedEngine = preferences?.agentRuntimeEngine ?? "default";
  const currentId = getActiveEngineModelId(preferences) ?? currentModelReference(overrides.orchestrator ?? overrides.general ?? "");
  const defaultModelId = useMemo(() => buildResolvedModelDefaultsMap(modelDefaults).orchestrator ?? buildModelDefaultsMap(modelDefaults).orchestrator ?? "", [modelDefaults]);
  const triggerLabel = preferences === null ? t("app.chat.miniModelPicker.loading") : getModelPickerDisplayLabel(currentId || defaultModelId, modelNamesById);
  const reasoningEffortOptions = listReasoningEffortOptions();
  const currentReasoningEffort = normalizeReasoningEffortLevel(
    committedEngine === "codex_cli" ? preferences?.codexReasoningEffort : committedEngine === "claude_code_local" ? preferences?.claudeCodeReasoningEffort : (preferences?.reasoningEfforts?.orchestrator ?? preferences?.reasoningEfforts?.general),
  );
  const isKnownModelId = useMemo(() => createKnownModelIdPredicate(new Set(allModels.map((model) => model.id))), [allModels]);
  const recentRows = useMemo(() => buildRecentModelRows({ currentId, recentIds, excludeIds: NO_EXCLUDED_IDS, isKnownModelId, limit: 5 }), [currentId, isKnownModelId, recentIds]);

  const applyPreferencesPatch = useCallback(
    async (patch: Partial<LocalModelPreferences>, errorLabel: string) => {
      if (!preferences || pending) return;
      const previous = preferences;
      setPending(true);
      setPreferences({ ...preferences, ...patch });
      try {
        const saved = await window.electronAPI?.system?.setLocalModelPreferences?.(patch);
        if (saved) setPreferences(saved);
        window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
      } catch (caught) {
        setPreferences(previous);
        showToast({ title: t("app.chat.miniModelPicker.updateFailedTitle"), description: caught instanceof Error ? caught.message : errorLabel, variant: "error" });
      } finally {
        setPending(false);
      }
    },
    [pending, preferences, setPreferences, t],
  );

  const handleReasoningEffortSelect = useCallback(
    (effort: Parameters<typeof buildEngineReasoningPatch>[2]) => {
      if (!preferences) return;
      const patch = buildEngineReasoningPatch(preferences, preferences.agentRuntimeEngine, effort, ASSISTANT_AGENT_KEYS);
      void applyPreferencesPatch(patch, t("app.chat.miniModelPicker.reasoningUpdateFailed"));
    },
    [applyPreferencesPatch, preferences, t],
  );

  const handleRecentSelect = useCallback(
    (row: RecentRow) => {
      if (!preferences) return;
      setOpen(false);
      if (row.id === currentId || row.unavailable || modelBlockedAt(destination, row.id)) return;
      const target = { assistant: true as const, configurableAgentKeys };
      if (isStellaModelId(row.id) && askToSignInForStella(() => void saveModelSelection(row.id, target))) return;
      const patch = buildRecentModelSelectionPatch(preferences, row.id, target);
      setRecentIds(recordRecentModel(row.id));
      void applyPreferencesPatch(patch, t("app.chat.miniModelPicker.modelUpdateFailed"));
    },
    [applyPreferencesPatch, askToSignInForStella, configurableAgentKeys, currentId, destination, preferences, t],
  );

  const handleOpenFullPicker = useCallback(() => {
    setOpen(false);
    openModelPicker();
  }, []);

  const triggerBrand = getModelBrandKey(currentId || defaultModelId, modelProvidersById);
  const reasoningDisabled = !preferences || pending;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <row
          role="button"
          label={t("app.chat.miniModelPicker.triggerLabel", { model: triggerLabel })}
          title={triggerLabel}
          focusable
          expanded={open}
          minH={24}
          maxW={TRIGGER_MAX_W}
          px={12 + 1}
          py={5 + 1}
          gap={5}
          align="center"
          justify="center"
          radius={radius.full}
          fill={open ? l.hover : undefined}
          hover={c.ghostHover}
          press={c.ghostPress}
          hoverColor={c.textBase}
          focusRing={{ width: 2, offset: 2, color: c.ring }}
          motion={{ dur: 0.15 }}
        >
          <box opacity={0.85} shrink={false}>
            <BrandIcon brand={triggerBrand} size={13} />
          </box>
          <text {...TRIGGER_LABEL} color={open ? c.textStrong : c.textWeak} minW={0} shrink nowrap truncate>
            {triggerLabel}
          </text>
        </row>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} aria-label={t("app.chat.miniModelPicker.popoverLabel")} w={POPOVER_W} minW={0} maxW={POPOVER_W} pad={6 + 1}>
        <row w="full" align="center" gap={6} py={2} px={4}>
          <Icon icon={Icons.stella.Lightbulb} size={14} strokeWidth={1.75} color={c.textWeak} />
          <row role="radiogroup" label={t("app.chat.miniModelPicker.reasoningEffortLabel")} grow={1} minW={0} gap={2} pad={2} radius={radius.full} scrollX focusGroup>
            {reasoningEffortOptions.map((option) => {
              const active = currentReasoningEffort === option.id;
              return (
                <box
                  key={option.id}
                  role="radio"
                  checked={active}
                  label={t(option.labelKey)}
                  focusable={!reasoningDisabled}
                  disabled={reasoningDisabled}
                  grow={1}
                  shrink={false}
                  minH={26}
                  py={4 + 1}
                  px={7 + 1}
                  center
                  radius={radius.full}
                  fill={active ? c.background : undefined}
                  gradient={active ? panel.gradient : undefined}
                  border={active ? panel.border : undefined}
                  hoverFill={reasoningDisabled || active ? undefined : l.hover}
                  focusFill={reasoningDisabled || active ? undefined : l.hover}
                  hoverColor={reasoningDisabled ? undefined : c.textStrong}
                  opacity={reasoningDisabled ? 0.5 : undefined}
                  onPress={reasoningDisabled ? undefined : () => handleReasoningEffortSelect(option.id)}
                >
                  <text {...XS_MEDIUM} color={active ? c.textStrong : c.textWeak} nowrap>
                    {t(option.labelKey)}
                  </text>
                </box>
              );
            })}
          </row>
        </row>
        {recentRows.length > 0 ? (
          <col role="listbox" label={t("app.chat.miniModelPicker.modelsLabel")} w="full" gap={1} mt={4} align="stretch" focusGroup>
            {recentRows.map((row) => {
              const selected = row.id === currentId;
              const blocked = modelBlockedAt(destination, row.id);
              const plan = planOfModel(row.id);
              const note = row.unavailable
                ? t("app.chat.miniModelPicker.unavailable")
                : blocked === "only-here"
                  ? t("settings.engineAccounts.whereComputer")
                  : blocked
                    ? t("settings.engineAccounts.claude.noteSignedOut", { place: destination.kind === "here" ? "" : destination.placeStart })
                    : plan
                      ? enginePlaceBadge(t, destination, plan)
                      : undefined;
              const disabled = pending || row.unavailable || Boolean(blocked);
              const name = getModelPickerDisplayLabel(row.id, modelNamesById);
              return (
                <ModelRow key={row.id} selected={selected} disabled={disabled} label={name} note={note} brand={getModelBrandKey(row.id, modelProvidersById)} onPress={() => handleRecentSelect(row)} />
              );
            })}
          </col>
        ) : null}
        <col w="full" mt={5} pt={5 + 1} borderSides={[1, 0, 0, 0]} border={c.borderWeak} align="stretch">
          <ModelRow label={t("app.chat.miniModelPicker.moreModels")} more onPress={handleOpenFullPicker} />
        </col>
      </PopoverContent>
    </Popover>
  );
}

function ModelRow({ label, note, brand, selected = false, disabled = false, more = false, onPress }: { label: string; note?: string; brand?: string; selected?: boolean; disabled?: boolean; more?: boolean; onPress: () => void }) {
  const c = useTokens().c;
  const l = useMiniPickerLook();
  const textColor = selected ? c.selectText : more ? c.textWeak : c.textBase;
  return (
    <row
      role={more ? "button" : "option"}
      selected={more ? undefined : selected}
      label={label}
      focusable={!disabled}
      disabled={disabled}
      w="full"
      minH={32}
      py={4 + 1}
      px={8 + 1}
      gap={8}
      align="center"
      radius={radius.sm}
      fill={selected ? c.selectFill : undefined}
      border={selected ? c.selectBorder : undefined}
      hoverFill={disabled || selected ? undefined : l.hover}
      hoverColor={disabled || selected ? undefined : c.textStrong}
      focusRing={{ width: 1, offset: -1, color: l.focus }}
      opacity={disabled ? 0.6 : undefined}
      motion={{ dur: 0.08 }}
      onPress={disabled ? undefined : onPress}
    >
      <box opacity={more ? undefined : selected ? 1 : 0.85} shrink={false}>
        {more ? <Icon icon={Icons.stella.SlidersHorizontal} size={14} strokeWidth={1.75} color={c.textWeaker} /> : <BrandIcon brand={brand ?? "stella"} size={14} />}
      </box>
      <text {...XS_MEDIUM} color={textColor} grow={1} minW={0} shrink nowrap truncate>
        {label}
      </text>
      {note ? (
        <text maxW="50%" minW={0} shrink size={fontSize["2xs"]} color={c.textWeaker} nowrap truncate title={note}>
          {note}
        </text>
      ) : null}
    </row>
  );
}
