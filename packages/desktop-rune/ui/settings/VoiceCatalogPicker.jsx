import { Check, ChevronDown, ChevronLeft, ChevronRight, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Press, T, tx } from "../kit/compat";
import { useVoiceCatalogPicker } from "./VoiceCatalogPicker.styles";
import { useCallback, useMemo } from "react";
import { DEFAULT_STELLA_TTS_VOICE, STELLA_TTS_VOICES, getDefaultRealtimeVoice, getRealtimeVoiceCatalog, } from "@stella/contracts/realtime-voice-catalog";
import { resolveReadAloudProvider, resolveRealtimeUnderlyingProvider, } from "@stella/contracts/local-preferences";
import { useT } from "@/shared/i18n";
function VoiceStepper({ catalog, activeVoiceId, sourceLabel, onPick, disabled }) {
  const s = useVoiceCatalogPicker();
    const t = useT();
    const activeIndex = useMemo(() => {
        const idx = catalog.findIndex((entry) => entry.id === activeVoiceId);
        return idx === -1 ? 0 : idx;
    }, [catalog, activeVoiceId]);
    const activeEntry = catalog[activeIndex] ?? catalog[0];
    const cycleBy = useCallback((delta) => {
        if (disabled || catalog.length === 0)
            return;
        const next = (activeIndex + delta + catalog.length) % catalog.length;
        onPick(catalog[next].id);
    }, [activeIndex, catalog, disabled, onPick]);
    const handleDropdownPick = useCallback((voiceId) => {
        if (disabled)
            return;
        onPick(voiceId);
    }, [disabled, onPick]);
    return (<col {...s.voiceCatalogStepperWrap}>
        <box {...s.voiceCatalogStepper} role="group" label={t("settings.voiceCatalog.label")}>
          <Press {...s.voiceCatalogStepperArrow} onPress={() => cycleBy(-1)} disabled={disabled || catalog.length < 2} label={t("settings.voiceCatalog.previousVoice")} {...((disabled || catalog.length < 2) ? s.voiceCatalogStepperArrowDisabled : null)}>
            <ChevronLeft size={14} strokeWidth={2} color={s.voiceCatalogStepperArrow.color} />
          </Press>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Press {...s.voiceCatalogStepperCurrent} disabled={disabled} {...((disabled) ? s.voiceCatalogStepperCurrentDisabled : null)}>
                <T {...tx(s.voiceCatalogStepperCurrent)} {...s.voiceCatalogStepperName}>
                  {activeEntry?.label ?? "—"}
                </T>
                <ChevronDown size={12} strokeWidth={2} color={s.voiceCatalogStepperCurrent.color} />
              </Press>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" sideOffset={6} {...s.voiceCatalogMenu} aria-label={t("settings.voiceCatalog.menuAriaLabel", { source: sourceLabel })}>
              {catalog.map((voice) => {
            const selected = voice.id === activeVoiceId;
            return (<DropdownMenuItem key={voice.id} onSelect={() => handleDropdownPick(voice.id)} disabled={disabled} data-selected={selected || undefined} {...s.voiceCatalogMenuItem}>
                    <col {...s.voiceCatalogMenuItemText}>
                      <T {...s.voiceCatalogMenuItemName}>
                        {voice.label}
                      </T>
                      <T {...s.voiceCatalogMenuItemDesc}>
                        {voice.description}
                      </T>
                    </col>
                    {selected ? (<Check size={13} {...s.voiceCatalogMenuItemCheck} color={s.voiceCatalogMenuItemCheck.color} />) : null}
                  </DropdownMenuItem>);
        })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Press {...s.voiceCatalogStepperArrow} onPress={() => cycleBy(1)} disabled={disabled || catalog.length < 2} label={t("settings.voiceCatalog.nextVoice")} {...((disabled || catalog.length < 2) ? s.voiceCatalogStepperArrowDisabled : null)}>
            <ChevronRight size={14} strokeWidth={2} color={s.voiceCatalogStepperArrow.color} />
          </Press>
        </box>
        {activeEntry?.description ? (<T w="full" {...s.voiceCatalogStepperDesc}>{activeEntry.description}</T>) : null}
      </col>);
}
export function VoiceCatalogPicker({ voiceProvider, selectedVoices, onSelectVoice, readAloudProvider, onSelectReadAloudProvider, onSelectReadAloudVoice, disabled = false, }) {
  const s = useVoiceCatalogPicker();
    const t = useT();
    const underlyingProvider = resolveRealtimeUnderlyingProvider({
        provider: voiceProvider,
    });
    const catalog = getRealtimeVoiceCatalog(underlyingProvider);
    const fallback = getDefaultRealtimeVoice(underlyingProvider);
    const activeVoiceId = selectedVoices?.[underlyingProvider]?.trim() || fallback;
    const activeReadAloud = resolveReadAloudProvider({ readAloudProvider });
    const showReadAloud = typeof onSelectReadAloudProvider === "function";
    const handleVoicePick = useCallback((voiceId) => {
        onSelectVoice(underlyingProvider, voiceId);
    }, [onSelectVoice, underlyingProvider]);
    const handleReadAloudVoicePick = useCallback((voiceId) => {
        onSelectReadAloudVoice?.(voiceId);
    }, [onSelectReadAloudVoice]);
    const activeReadAloudVoiceId = selectedVoices?.stella?.trim() || DEFAULT_STELLA_TTS_VOICE;
    const handleReadAloudPick = useCallback((provider) => {
        if (disabled || !onSelectReadAloudProvider)
            return;
        if (provider === activeReadAloud)
            return;
        onSelectReadAloudProvider(provider);
    }, [activeReadAloud, disabled, onSelectReadAloudProvider]);
    const labelSourceText = underlyingProvider === "xai"
        ? t("settings.voiceCatalog.source.xai")
        : underlyingProvider === "openai"
            ? t("settings.voiceCatalog.source.openai")
            : t("settings.voiceCatalog.source.gptlive");
    return (<col {...s.voiceCatalogPicker} {...((disabled || undefined) ? s.voiceCatalogPickerDisabled : null)}>
      <row {...s.voiceCatalogPickerLabel}>
        <T {...tx(s.voiceCatalogPickerLabel)}>{t("settings.voiceCatalog.label")}</T>
        <T {...tx(s.voiceCatalogPickerLabel)} {...s.voiceCatalogPickerLabelSource}>
          {labelSourceText}
        </T>
      </row>

      <VoiceStepper catalog={catalog} activeVoiceId={activeVoiceId} sourceLabel={labelSourceText} onPick={handleVoicePick} disabled={disabled} />
      {showReadAloud ? (<col {...s.voiceCatalogReadaloud}>
          <row {...s.voiceCatalogPickerLabel}>
            <T {...tx(s.voiceCatalogPickerLabel)}>{t("settings.voiceCatalog.readAloud.label")}</T>
            <row {...s.voiceCatalogSubtoggle} role="tablist" label={t("settings.voiceCatalog.readAloud.ariaLabel")}>
              <Press text={tx(s.voiceCatalogPickerLabel)} {...s.voiceCatalogSubtoggleBtn} role="tab" selected={activeReadAloud === "stella"} onPress={() => handleReadAloudPick("stella")} disabled={disabled} title={t("settings.voiceCatalog.readAloud.stellaTitle")} {...((activeReadAloud === "stella" || undefined) ? s.voiceCatalogSubtoggleBtnActive : null)} {...((disabled) ? s.voiceCatalogSubtoggleBtnDisabled : null)}>
                Speechify
              </Press>
              <Press text={tx(s.voiceCatalogPickerLabel)} {...s.voiceCatalogSubtoggleBtn} role="tab" selected={activeReadAloud === "openai"} onPress={() => handleReadAloudPick("openai")} disabled={disabled} title={t("settings.voiceCatalog.readAloud.openaiTitle")} {...((activeReadAloud === "openai" || undefined) ? s.voiceCatalogSubtoggleBtnActive : null)} {...((disabled) ? s.voiceCatalogSubtoggleBtnDisabled : null)}>
                OpenAI
              </Press>
            </row>
          </row>
          {activeReadAloud === "stella" ? (<VoiceStepper catalog={STELLA_TTS_VOICES} activeVoiceId={activeReadAloudVoiceId} sourceLabel={t("settings.voiceCatalog.source.stella")} onPick={handleReadAloudVoicePick} disabled={disabled || !onSelectReadAloudVoice} />) : null}
          <T w="full" {...s.voiceCatalogReadaloudDesc}>
            {t("settings.voiceCatalog.readAloud.description")}
          </T>
        </col>) : null}
    </col>);
}
