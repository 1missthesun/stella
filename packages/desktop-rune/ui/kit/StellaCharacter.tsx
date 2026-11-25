import { Icons, type IconData } from "./icons";

export type StellaCharacterProps = {
  size: number | null;
  state?: string;
  shape?: string;
  ink?: "aurora" | "vivid";
  eyeColor?: string;
  glow?: boolean;
  paused?: boolean;
  followPointer?: boolean;
};

const marks = new Map<string, IconData>();

function markWithEyes(size: number, eyeColor: string | undefined): IconData {
  const base = size <= 44 ? Icons.mark.stellaSmall : Icons.mark.stella;
  if (!eyeColor) return base;
  const key = `${base.name}:${eyeColor}`;
  let hit = marks.get(key);
  if (!hit) {
    hit = { ...base, name: key, body: base.body.replaceAll('fill="#fff"', `fill="${eyeColor}"`) };
    marks.set(key, hit);
  }
  return hit;
}

/** desktop-ui's `StellaCharacter`, drawn at its idle pose. */
export function StellaCharacter({ size, eyeColor }: StellaCharacterProps) {
  const px = size ?? 22;
  const data = markWithEyes(px, eyeColor);
  return <icon svg={data.body} name={data.name} view={data.view} size={px} />;
}
