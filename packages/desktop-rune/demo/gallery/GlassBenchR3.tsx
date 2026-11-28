// Liquid Glass bench (round 3): the scenes of the iOS 26.2 truth app (`GlassTruth3.swift`) at
// iPhone 17 size (402×874 pt), with Stella's own glass recipes, for side-by-side comparison.
// Run with STELLA_RUNE_APP=demo/gallery/GlassBenchR3.tsx and:
//   BENCH_SCENE  clarity | corners | morph_plain | unified_morph   (default unified_morph)
//   BENCH_THEME  dark | light                                       (default dark)
//   BENCH_AUTO   "open,close" in ms after launch: opens the menu, then closes it (optional;
//                otherwise press the + button at (50, 784) and outside the menu to close).
import { useEffect, useState, type ReactNode } from "react";
import { tokensFor } from "../../ui/theme/ThemeProvider";
import { chromeGlass } from "../../ui/shell/glass";
import { menuGlass } from "../../ui/kit/menu-glass";

const ART = `${process.env.STELLA_RUNE_ROOT ?? "."}/../mobile-screenshots/public/art`;
const SCENE = process.env.BENCH_SCENE ?? "unified_morph";
const DARK = (process.env.BENCH_THEME ?? "dark") !== "light";
const AUTO = (process.env.BENCH_AUTO ?? "").split(",").map(Number).filter((n) => n > 0);

const t = tokensFor("default", DARK ? "dark" : "light");
const BG = DARK ? "#0b0b0d" : "#f8f8fa";
const FG = DARK ? "#ffffff" : "#141414";
const CARD = DARK ? "#242424" : "#ededed";
const YELLOW = "#ffd600";
const BLUE = "#2871c9";

const PARA =
  "Liquid Glass bends light at its edge and stays clear in the middle, so the text and photos underneath remain readable while controls float above them. Sorting algorithms compared: merge sort O(n log n) stable, quicksort O(n log n) in place, heapsort O(n log n) in place, timsort O(n) best case stable, radix sort O(nk) stable. The quick brown fox jumps over the lazy dog 0123456789.";

// BENCH_GLASS: {"controls"|"clear"|"menu": {glass overrides}} while tuning a recipe.
const OVERRIDE: Record<string, object> = process.env.BENCH_GLASS ? JSON.parse(process.env.BENCH_GLASS) : {};
const tuned = <M extends { fx?: unknown }>(m: M, name: string): M => {
  const o = OVERRIDE[name];
  const g = (m.fx as { glass?: object } | undefined)?.glass;
  if (!o || !g) return m;
  return { ...m, fx: { glass: { ...g, ...o } } };
};
const controls = () => tuned(chromeGlass(t).controls, "controls");
const clear = () => tuned(chromeGlass(t).clear, "clear");

function At({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }) {
  return <box absolute={{ left: x - w / 2, top: y - h / 2 }} w={w} h={h}>{children}</box>;
}

function ClaritySet({ y }: { y: number }) {
  const c = controls();
  return (
    <>
      <At x={110} y={y} w={150} h={50}>
        <row w={150} h={50} radius={25} fx={c.fx} fill={c.fill} border={c.border} align="center" justify="center">
          <text size={15} weight={600} color={FG}>Regular</text>
        </row>
      </At>
      <At x={250} y={y} w={56} h={56}>
        <box w={56} h={56} radius={28} fx={c.fx} fill={c.fill} border={c.border} align="center" justify="center">
          <text size={26} weight={400} color={FG}>+</text>
        </box>
      </At>
      <At x={330} y={y} w={56} h={56}>
        <box w={56} h={56} radius={28} fx={clear().fx} />
      </At>
      <At x={201} y={y + 110} w={300} h={120}>
        <box w={300} h={120} radius={28} fx={c.fx} fill={c.fill} border={c.border} />
      </At>
    </>
  );
}

function Clarity() {
  return (
    <box w="full" h="full" fill={BG}>
      <col w="full" h="full">
        <image src={`${ART}/tram.jpg`} w={402} h={437} fit="cover" />
        <box w={402} h={437} clip={0} px={16} pt={14}>
          <text size={15} color={FG}>{`${PARA} ${PARA}`}</text>
        </box>
      </col>
      <ClaritySet y={110} />
      <ClaritySet y={547} />
    </box>
  );
}

function Corners() {
  const black = { ...controls(), fx: { glass: { ...(controls().fx as { glass: object }).glass, tint: "#000000" } } };
  return (
    <box w="full" h="full" fill="#000000">
      <col absolute={{ left: 31, top: 70 }} gap={22}>
        <box w={340} h={150} radius={44} fill="#ffffff" />
        <box w={340} h={150} radius={44} fill="#ffffff" />
        <row gap={20}>
          <box w={160} h={80} radius={40} fill="#ffffff" />
          <box w={160} h={80} radius={40} fill="#ffffff" />
        </row>
      </col>
      <row absolute={{ left: 0, top: 70 + 150 * 2 + 80 * 2 + 22 * 4 }} w={402} h={130} fill={YELLOW} align="center" justify="center" gap={20}>
        <box w={160} h={80} radius={40} fx={black.fx} />
        <box w={160} h={80} radius={30} fx={black.fx} />
      </row>
    </box>
  );
}

function Backdrop() {
  return (
    <box w="full" h="full" fill={BG}>
      <col absolute={{ left: 18, top: 64, right: 18 }} gap={14}>
        <col w="full" h={150} radius={20} gradient={{ angle: 135, stops: [[0, "#2871c9"], [0.5, "#7c3aed"], [1, "#ec4899"]] }} justify="end" pad={16} gap={6}>
          <text size={18} weight={700} color="#ffffff">Liquid Glass Optical Reference</text>
          <text size={13} weight={500} color="#ffffffd9">Refraction, edge lensing, rim specular & morph physics</text>
        </col>
        <row w="full" justify="end">
          <box maxW={366} px={16} py={12} radius={20} fill={BLUE}>
            <text size={15} color="#ffffff">Include a markdown table comparing 8 sorting algorithms and highlight edge cases.</text>
          </box>
        </row>
        <col w="full" pad={14} radius={16} fill={CARD} gap={8}>
          <text size={16} weight={600} color={FG}>Sorting Algorithm Comparison</text>
          {["Merge sort     O(n log n)   Stable", "Quicksort      O(n log n)   In-place", "Heapsort       O(n log n)   In-place", "Timsort        O(n)         Stable", "Radix sort     O(nk)        Stable"].map((r) => (
            <col key={r} w="full" gap={8}>
              <text size={13} weight={500} mono color={DARK ? "#ffffffd9" : "#141414d9"}>{r}</text>
              <box w="full" h={0.5} fill={DARK ? "#ffffff33" : "#00000026"} />
            </col>
          ))}
        </col>
        <row w="full" gap={10}>
          {[["Blue", BLUE], ["Coral", "#f55a36"], ["Emerald", "#16a34a"]].map(([n, c]) => (
            <box key={n} w={(366 - 20) / 3} h={110} radius={14} fill={c} align="center" justify="center">
              <text size={15} weight={700} color="#ffffff" textAlign="center">{`${n}\nSurface`}</text>
            </box>
          ))}
        </row>
        <row w="full" justify="end">
          <box maxW={366} px={16} py={12} radius={20} fill={BLUE}>
            <text size={15} color="#ffffff">Answer directly, no tools: write a long reference on sorting algorithms.</text>
          </box>
        </row>
      </col>
    </box>
  );
}

// Nearest the button first, as UIKit orders a menu that opens upward.
const ITEMS = ["Connect apps", "Record screen", "Take screenshot", "Add photos & files"];
const ICONS = ["▦", "◉", "◎", "▧"];

/** The menu as Stella draws one (`menuSurface` / `MenuPanelGlass`), sized like UIKit's: 250 pt wide, four 44 pt rows. */
function Menu({ close }: { close: () => void }) {
  const base = menuGlass(t);
  const g = { ...base, morph: OVERRIDE.menu && base.morph ? { glass: { ...base.morph.glass, ...OVERRIDE.menu } } : base.morph };
  return (
    <col id="plus-menu" anchor={{ to: "plus", side: "top", align: "start", gap: -52 }} raise={10000} modal={{ clickOutside: true }} onDismiss={close}
      w={250} pad={6} radius={32} border={g.border} fx={g.morph} fill={g.fill} shadows={g.shadows}>
      <col w="full" gap={0}>
        {ITEMS.map((label, i) => (
          <row key={label} h={44} px={14} gap={12} align="center" radius={26} hover={g.pill} onPress={close}>
            <text size={16} weight={500} color={FG}>{ICONS[i]}</text>
            <text size={16} weight={500} color={FG}>{label}</text>
          </row>
        ))}
      </col>
    </col>
  );
}

function Morph({ plain }: { plain: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (AUTO.length === 0) return;
    const ids = AUTO.map((ms, i) => setTimeout(() => setOpen(i % 2 === 0), ms));
    return () => ids.forEach(clearTimeout);
  }, []);
  const c = controls();
  return (
    <box w="full" h="full">
      {plain ? <box w="full" h="full" fill={YELLOW} /> : <Backdrop />}
      <box id="plus" absolute={{ left: 24, bottom: 64 }} w={52} h={52} radius={26} fx={c.fx} fill={c.fill} border={c.border} align="center" justify="center" onPress={() => setOpen((o) => !o)}>
        <text size={26} weight={400} color={FG}>+</text>
      </box>
      {open ? <Menu close={() => setOpen(false)} /> : null}
    </box>
  );
}

export function Root() {
  const scene =
    SCENE === "clarity" ? <Clarity /> : SCENE === "corners" ? <Corners /> : SCENE === "morph_plain" ? <Morph plain /> : <Morph plain={false} />;
  return (
    <window id="main" title={`Glass bench R3 · ${SCENE}`} bg={BG} w={402} h={874} minSize={[402, 874]} resizable={false} frameless>
      {scene}
    </window>
  );
}
