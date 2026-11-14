import type { ComponentType } from "react";
import { BlocksSkin } from "../skin-blocks";
import { AnimeSkin } from "./AnimeSkin";
import { AquariumSkin } from "./AquariumSkin";
import { BeatSkin } from "./BeatSkin";
import { CockpitSkin } from "./CockpitSkin";
import type { SkinProps } from "./content";
import { CrayonSkin } from "./CrayonSkin";
import { DefaultSkin } from "./DefaultSkin";
import { KeycapsSkin } from "./KeycapsSkin";
import { NodesSkin } from "./NodesSkin";
import { PlatformerSkin } from "./PlatformerSkin";
import { RaceDashSkin } from "./RaceDashSkin";
import { StitchSkin, warmStitch } from "./StitchSkin";
import { SynthSkin } from "./SynthSkin";
import { TrailSkin, trailContours } from "./TrailSkin";
import { Y2KPlayerSkin } from "./Y2KPlayerSkin";
import type { FontSet } from "./kit";

export { loadFonts } from "./kit";
export type { SkinProps } from "./content";

/**
 * A look the window can take. `drawn` skins are pure functions of time laid out at a
 * fixed design size (1480x900 wide, 840x1400 tall) and scaled to the frame; `fluid`
 * ones lay themselves out in whatever box they're given and run their own motion. `warm`
 * does a drawn skin's one-off layout work ahead of its first frame.
 */
export type Look =
  | { kind: "drawn"; Skin: ComponentType<SkinProps>; fonts: readonly FontSet[]; warm?: (w: number, h: number) => void }
  | { kind: "fluid"; Skin: ComponentType; fonts: readonly FontSet[] };

export const START: Look = { kind: "fluid", Skin: DefaultSkin, fonts: [] };

export const LOOKS: Record<string, Look> = {
  cockpit: { kind: "drawn", Skin: CockpitSkin, fonts: ["b612"] },
  trail: { kind: "drawn", Skin: TrailSkin, fonts: ["barlow"], warm: trailContours },
  crayon: { kind: "drawn", Skin: CrayonSkin, fonts: ["kid"] },
  beats: { kind: "drawn", Skin: BeatSkin, fonts: [] },
  racedash: { kind: "drawn", Skin: RaceDashSkin, fonts: ["saira"] },
  anime: { kind: "drawn", Skin: AnimeSkin, fonts: ["dela", "comic", "bangers"] },
  synth: { kind: "drawn", Skin: SynthSkin, fonts: [] },
  stitch: { kind: "drawn", Skin: StitchSkin, fonts: [], warm: warmStitch },
  nodes: { kind: "drawn", Skin: NodesSkin, fonts: ["manrope"] },
  aquarium: { kind: "drawn", Skin: AquariumSkin, fonts: ["nunito"] },
  platformer: { kind: "drawn", Skin: PlatformerSkin, fonts: ["press"] },
  keycaps: { kind: "drawn", Skin: KeycapsSkin, fonts: [] },
  y2kplayer: { kind: "drawn", Skin: Y2KPlayerSkin, fonts: ["nunito"] },
  blocks: { kind: "fluid", Skin: BlocksSkin, fonts: [] },
};
