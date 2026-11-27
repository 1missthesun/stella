import { useEffect } from "react";
import { openModelPicker } from "@/features/workspace-display/default-tabs";
import { OPEN_MODEL_PICKER_EVENT } from "@/global/billing/byok-action";
import { engineOverlay, useEngineOverlayFocus, useEngineOverlayOpen } from "@/shell/display/engine-overlay-store";
import { composerModelPin, useComposerModelPinned } from "@/features/chat/composer-model-pin-store";
import { preloadModelsPicker } from "@/shell/topbar/nav-surface-preloads";
import { Icons, Switch } from "../kit";
import { fontSize, look, useTokens } from "../theme";
import { lazyScreen, useLazyReady } from "../kit/lazy";
import { GroupIcon, Panel, TopbarButton } from "./topbar/chrome";

const AgentModelPicker = lazyScreen(() => import("../replace/global/settings/AgentModelPicker"), (module) => module.AgentModelPicker);

/** desktop-ui's `GlobalModelsControl` in the top bar: "Models" and its picker popover. */
export function GlobalModelsControl({ visible = true }: { visible?: boolean; placement?: "footer" | "topbar" }) {
  const t = useTokens();
  const open = useEngineOverlayOpen();
  const modelPinned = useComposerModelPinned();
  const focus = useEngineOverlayFocus();
  const ready = useLazyReady(open && visible, AgentModelPicker);

  useEffect(() => {
    if (visible && open) preloadModelsPicker();
  }, [open, visible]);

  useEffect(() => {
    const handleOpenModelPicker = (event: Event) => {
      const provider = event instanceof CustomEvent ? (event.detail as { provider?: unknown } | null)?.provider : undefined;
      if (typeof provider === "string" && provider) engineOverlay.openAt(provider);
      else openModelPicker();
    };
    window.addEventListener(OPEN_MODEL_PICKER_EVENT, handleOpenModelPicker);
    return () => window.removeEventListener(OPEN_MODEL_PICKER_EVENT, handleOpenModelPicker);
  }, []);

  if (!visible) return null;
  const narrow = window.innerWidth <= 820;

  return (
    <>
      <TopbarButton id="work-models-button" label="Models" title={narrow ? "Models" : undefined} icon={narrow} active={open} onPress={() => engineOverlay.setOpen(!open)} onHover={(inside) => inside && preloadModelsPicker()}>
        {(color) => (
          <>
            <GroupIcon icon={Icons.stella.SlidersHorizontal} size={18} strokeWidth={1.5} color={color} hoverColor={t.c.textStrong} />
            {narrow ? null : <text {...look(fontSize.sm, 500, { lh: 1 })} nowrap color={color} hoverColor={t.c.textStrong}>Models</text>}
          </>
        )}
      </TopbarButton>
      <Panel id="models-popover" anchor="work-models-button" open={open && ready} onClose={() => engineOverlay.setOpen(false)} w={Math.min(380, window.innerWidth * 0.92)} h={Math.min(560, window.innerHeight * 0.72)} label="Models">
        <col grow={1} minH={0} pad={12}>
          <col grow={1} minH={0} minW={0} clip={0}>
            <AgentModelPicker active={open} focusSection={focus} />
          </col>
          <row pt={8} gap={8} align="center" justify="end">
            <text {...look(fontSize.sm, 400, { lh: 1.67 })} color={t.c.textWeak} onPress={() => composerModelPin.toggle()}>
              Show in composer
            </text>
            <Switch id="work-models-pin-switch" label="Show in composer" hideLabel checked={modelPinned} onCheckedChange={() => composerModelPin.toggle()} />
          </row>
        </col>
      </Panel>
    </>
  );
}
