// Liquid Glass morphing: a menu growing out of the button that opened it (`morphFrom`), two
// capsules merging and separating in one glass group (`group` + `spacing`), and a glass pill
// sliding between segments. Run with STELLA_RUNE_APP=demo/gallery/GlassMorph.tsx; MORPH_AUTO=1
// plays all three on a loop (state changes only: the engine animates every frame).
import { useEffect, useState } from "react";
import type { Glass } from "../../host/rune-jsx/props";

const ART = `${process.env.STELLA_RUNE_ROOT ?? "."}/../mobile-screenshots/public/art`;
const AUTO = process.env.MORPH_AUTO === "1";
const SLOW = Number(process.env.MORPH_SLOW ?? 1);
const INK = "#f5f5f7";
const DIM = "#d4d4d8";

const GLASS: Glass = { bevel: 12, depth: 24, dispersion: 0.08, magnification: 1.05, frost: 0.22, frostSigma: 4, rim: 0.3, shadow: 0.3, veil: 0.42, tint: "#1c1c1e", saturation: 1.5 };
const BUTTON: Glass = { ...GLASS, veil: 0.3 };

const ITEMS = ["Add photos & files", "Take screenshot", "Record screen", "Connect apps"];

function Menu({ close }: { close: () => void }) {
  return (
    <col id="plus-menu" anchor={{ to: "plus", side: "top", align: "start", gap: 10 }} raise={10000} modal={{ clickOutside: true }} onDismiss={close}
      w={240} pad={6} gap={2} radius={22} fx={{ glass: { ...GLASS, morphFrom: true, morphMotion: { dur: 0.5 * SLOW, bounce: 0.18 } } }}>
      {ITEMS.map((label) => (
        <row key={label} h={40} px={12} align="center" radius={14} hover="#ffffff1f" onPress={close}>
          <text size={14} weight={500} color={INK}>{label}</text>
        </row>
      ))}
    </col>
  );
}

function Capsules({ together }: { together: boolean }) {
  const glass = { glass: { ...BUTTON, group: "pair", spacing: 26 } };
  return (
    <box w={360} h={64}>
      <row absolute={{ left: 0, top: 0 }} x={together ? 96 : 0} motion={{ dur: 0.9 * SLOW, bounce: 0.15 }} w={120} h={56} radius={28} fx={glass} align="center" justify="center">
        <text size={15} weight={600} color={INK}>Share</text>
      </row>
      <box absolute={{ left: 240, top: 0 }} x={together ? -96 : 0} motion={{ dur: 0.9 * SLOW, bounce: 0.15 }} w={56} h={56} radius={28} fx={glass} align="center" justify="center">
        <text size={20} weight={500} color={INK}>♥</text>
      </box>
    </box>
  );
}

const TABS = ["Chats", "Apps", "Files"];
const TAB_W = 96;

function Tabs({ at, pick }: { at: number; pick: (i: number) => void }) {
  return (
    <row w={TAB_W * 3 + 8} h={52} pad={4} radius={26} fx={{ glass: BUTTON }}>
      <box absolute={{ left: 4, top: 4 }} x={at * TAB_W} motion={{ dur: 0.45 * SLOW, bounce: 0.2 }} w={TAB_W} h={44} radius={22}
        fx={{ glass: { ...GLASS, veil: 0.18, tint: "#ffffff", depth: 14, bevel: 10, rim: 0.5, shadow: 0.15 } }} />
      {TABS.map((t, i) => (
        <row key={t} w={TAB_W} h={44} align="center" justify="center" onPress={() => pick(i)}>
          <text size={14} weight={600} color={i === at ? INK : DIM}>{t}</text>
        </row>
      ))}
    </row>
  );
}

export function Root() {
  const [open, setOpen] = useState(false);
  const [together, setTogether] = useState(false);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    if (!AUTO) return;
    const steps: [number, () => void][] = [
      [600, () => setOpen(true)], [1500, () => setOpen(false)],
      [1300, () => setTogether(true)], [1600, () => setTogether(false)],
      [1300, () => setTab(1)], [800, () => setTab(2)], [800, () => setTab(0)],
    ];
    let i = 0;
    let id: ReturnType<typeof setTimeout>;
    const next = () => {
      const [ms, run] = steps[i % steps.length];
      const wait = ms * SLOW;
      id = setTimeout(() => { run(); i++; next(); }, wait);
    };
    next();
    return () => clearTimeout(id);
  }, []);
  return (
    <window id="main" title="Glass morph" bg="#0b0b0d" w={900} h={640}>
      <box w="full" h="full">
        <image src={`${ART}/tram.jpg`} w="full" h="full" fit="cover" />
        <col absolute={{ left: 48, top: 40 }} gap={36}>
          <Tabs at={tab} pick={setTab} />
          <Capsules together={together} />
          <row gap={12}>
            <text size={13} color={DIM} onPress={() => setTogether((t) => !t)}>merge / separate</text>
          </row>
        </col>
        <box id="plus" absolute={{ left: 48, bottom: 48 }} w={48} h={48} radius={24} fx={{ glass: BUTTON }} align="center" justify="center" onPress={() => setOpen((o) => !o)}>
          <text size={24} weight={400} color={INK}>+</text>
        </box>
        {open ? <Menu close={() => setOpen(false)} /> : null}
      </box>
    </window>
  );
}
