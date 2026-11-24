import type { ComponentType } from "react";
import { BlocksSkin } from "../skin-blocks";
import { OpsSkin } from "../skin-ops";
import { AnimeSkin } from "./AnimeSkin";
import { LetterSkin, PaperSkin, PlainSkin, SerifSkin, TangerineSkin } from "./ChatLooks";
import type { SkinProps } from "./content";
import { CrayonSkin } from "./CrayonSkin";
import { PenRealSkin, PenSkin, PetSkin, PinSkin } from "./FeatureSkins";
import type { FontSet } from "./kit";
import { NodesSkin } from "./NodesSkin";
import { PlatformerSkin } from "./PlatformerSkin";
import { TrailSkin, trailContours } from "./TrailSkin";

export { loadFonts } from "./kit";
export type { SkinProps } from "./content";

export type Look =
  | { kind: "drawn"; Skin: ComponentType<SkinProps>; fonts: readonly FontSet[]; warm?: (w: number, h: number) => void }
  | { kind: "fluid"; Skin: ComponentType; fonts: readonly FontSet[] };

export const START: Look = { kind: "drawn", Skin: PlainSkin, fonts: ["manrope"] };

export const LOOKS: Record<string, Look> = {
  tangerine: { kind: "drawn", Skin: TangerineSkin, fonts: ["manrope"] },
  paper: { kind: "drawn", Skin: PaperSkin, fonts: ["manrope"] },
  serif: { kind: "drawn", Skin: SerifSkin, fonts: ["manrope", "serif"] },
  letter: { kind: "drawn", Skin: LetterSkin, fonts: ["manrope", "serif"] },
  pin: { kind: "drawn", Skin: PinSkin, fonts: ["manrope", "serif"] },
  pet: { kind: "drawn", Skin: PetSkin, fonts: ["manrope"] },
  pen: { kind: "drawn", Skin: PenSkin, fonts: ["manrope", "kid"] },
  penReal: { kind: "drawn", Skin: PenRealSkin, fonts: ["manrope"] },
  trail: { kind: "drawn", Skin: TrailSkin, fonts: ["barlow"], warm: trailContours },
  crayon: { kind: "drawn", Skin: CrayonSkin, fonts: ["kid"] },
  anime: { kind: "drawn", Skin: AnimeSkin, fonts: ["dela", "comic", "bangers"] },
  nodes: { kind: "drawn", Skin: NodesSkin, fonts: ["manrope"] },
  platformer: { kind: "drawn", Skin: PlatformerSkin, fonts: ["press"] },
  ops: { kind: "fluid", Skin: OpsSkin, fonts: [] },
  blocks: { kind: "fluid", Skin: BlocksSkin, fonts: [] },
};
