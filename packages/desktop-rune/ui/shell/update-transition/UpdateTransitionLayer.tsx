import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  setTransitionAppLive,
  subscribeTransition,
  transitionApp,
  transitionScene,
  transitionVersion,
  type AppLook,
  type TransitionScene,
} from "../../../host/services/update-transition-scene";
import { StellaMark } from "../../kit";
import { look } from "../../theme";
import { systemFontFamily } from "../../theme/system-font";
import { useLaunchSplashPhase } from "../launch-splash";

const RAISE = 20_000;
const PULL_OUT = { opacity: 0, blur: 14, dur: 0.18, bounce: 0 };
const APPEAR = { opacity: 0, blur: 6, scale: 0.96, dur: 0.4, bounce: 0 };
const LEAVE = { opacity: 0, blur: 6, scale: 0.97, dur: 0.16, bounce: 0 };
const AT_ONCE = {};
const HOLD_FADE = { dur: 0.3, bounce: 0 };
const LABEL = look(13, 600, { em: -0.01, family: systemFontFamily() });
const SWEEP_MS = 1800;

const useTransition = () => {
  useSyncExternalStore(subscribeTransition, transitionVersion);
  return { scene: transitionScene(), app: transitionApp() };
};

/** The blur and scale the live app takes under the scene, each change landing after its `delayMs`. */
export function useUpdateTransitionAppLook(): { blur?: number; scale?: number; motion?: { dur: number; bounce: number } } {
  const { scene, app } = useTransition();
  const [applied, setApplied] = useState<AppLook>(app);
  useEffect(() => {
    if (!app.delayMs) {
      setApplied(app);
      return;
    }
    const timer = setTimeout(() => setApplied(app), app.delayMs);
    return () => clearTimeout(timer);
  }, [app]);
  if (!scene && !applied.blur && applied.scale === 1) return {};
  return { blur: applied.blur, scale: applied.scale, motion: applied.dur ? { dur: applied.dur, bounce: 0 } : undefined };
}

/** Electron's update-transition page, drawn by the full window over itself: the still of the old interface, the frost and the held mark. */
export function UpdateTransitionLayer() {
  const { scene } = useTransition();
  const phase = useLaunchSplashPhase();
  useEffect(() => setTransitionAppLive(phase === "exiting" || phase === "gone"), [phase]);
  if (!scene) return null;
  return (
    <col fixed inset={0} raise={RAISE} enter={AT_ONCE} exit={AT_ONCE} onPress={() => {}} label="Updating Stella">
      <Scene scene={scene} />
    </col>
  );
}

function Scene({ scene }: { scene: TransitionScene }) {
  switch (scene.kind) {
    case "cover":
    case "reveal":
      return <Still key={scene.before} src={scene.before} pulled={scene.kind === "reveal"} />;
    case "frost":
      return (
        <col absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} enter={AT_ONCE}>
          <image key={scene.before} src={scene.before} fit="stretch" absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} blur={26} enter={{ blur: 0, dur: scene.dur, bounce: 0 }} />
          <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} fill={scene.tint} enter={{ opacity: 0, dur: scene.dur, bounce: 0 }} />
        </col>
      );
    case "hold":
    case "focusIn":
      return <Hold scene={scene} leaving={scene.kind === "focusIn"} />;
  }
}

function Still({ src, pulled }: { src: string; pulled: boolean }) {
  return (
    <image
      src={src}
      fit="stretch"
      absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
      enter={AT_ONCE}
      opacity={pulled ? PULL_OUT.opacity : 1}
      blur={pulled ? PULL_OUT.blur : 0}
      motion={pulled ? { dur: PULL_OUT.dur, bounce: PULL_OUT.bounce } : undefined}
    />
  );
}

function Hold({ scene, leaving }: { scene: Extract<TransitionScene, { kind: "hold" | "focusIn" }>; leaving: boolean }) {
  const delayMs = scene.kind === "hold" ? scene.labelDelayMs : 0;
  const [labelShown, setLabelShown] = useState(delayMs === 0);
  useEffect(() => {
    if (labelShown) return;
    const timer = setTimeout(() => setLabelShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, labelShown]);
  const fg = scene.dark ? "#f5f5f7" : "#1d1d1f";
  const dim = scene.dark ? "#f5f5f773" : "#1d1d1f73";
  const sweepAtMs = scene.kind === "hold" ? scene.heldMs + scene.labelDelayMs : 0;
  return (
    <col absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} enter={AT_ONCE} opacity={leaving ? 0 : 1} motion={HOLD_FADE}>
      <image src={scene.frosted} fit="stretch" absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} enter={AT_ONCE} />
      <col absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} center enter={AT_ONCE}>
        {labelShown ? (
          <col
            align="center"
            gap={12}
            enter={APPEAR}
            opacity={leaving ? LEAVE.opacity : 1}
            blur={leaving ? LEAVE.blur : 0}
            scale={leaving ? LEAVE.scale : 1}
            motion={leaving ? { dur: LEAVE.dur, bounce: 0 } : undefined}
          >
            <StellaMark size={34} />
            <HoldLabel text={scene.label} fg={fg} dim={dim} sweepAtMs={sweepAtMs} />
          </col>
        ) : null}
      </col>
    </col>
  );
}

/**
 * Electron's `.hold-label`: dim text with a band of full colour from a 260%-wide gradient clipped to
 * the glyphs. Its centre runs from -0.3 to 1.3 label widths every 1.8 s, linearly, and fades to dim
 * over 0.312 widths each side. The sweep keeps the phase the hold has reached (`animation-delay`).
 */
function HoldLabel({ text, fg, dim, sweepAtMs }: { text: string; fg: string; dim: string; sweepAtMs: number }) {
  const [width, setWidth] = useState(0);
  const [phase] = useState(() => (sweepAtMs % SWEEP_MS) / SWEEP_MS);
  const half = width * 0.312;
  const loops = useMemo(() => {
    if (!width) return null;
    const [from, to] = [-0.3 * width - half, 1.3 * width - half];
    const x = (p: number) => from + p * (to - from);
    const at = phase > 0 ? [{ at: 0, x: x(phase) }, { at: 1 - phase, x: to }, { at: Math.min(1, 1 - phase + 1e-4), x: from }, { at: 1, x: x(phase) }] : [{ at: 0, x: from }, { at: 1, x: to }];
    const frames = at.filter((f, i) => i === 0 || f.at > at[i - 1]!.at);
    const loop = (sign: 1 | -1) => ({ kind: "sequence" as const, period: SWEEP_MS / 1000, ease: "linear" as const, frames: frames.map((f) => ({ at: f.at, x: sign * f.x })) });
    return { window: loop(1), inner: loop(-1) };
  }, [half, phase, width]);
  return (
    <box onSize={(r) => setWidth(Math.round(r.w))} clip={0}>
      <text {...LABEL} color={dim} nowrap>
        {text}
      </text>
      {loops ? (
        <box absolute={{ left: 0, top: 0, bottom: 0 }} w={half * 2} clipFade={[half, 0, half, 0]} loop={loops.window} inert>
          <text {...LABEL} color={fg} nowrap w={width} loop={loops.inner}>
            {text}
          </text>
        </box>
      ) : null}
    </box>
  );
}
