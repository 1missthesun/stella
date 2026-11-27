import type { IconData } from "./catalog.gen";

export * as Icons from "./catalog.gen";
export type { IconData } from "./catalog.gen";

const strokeCache = new Map<string, IconData>();

/** The same icon drawn with another root stroke width (desktop-ui's `strokeWidth` prop). */
export function withStroke(icon: IconData, width: number): IconData {
  const key = `${icon.name}@${width}`;
  let hit = strokeCache.get(key);
  if (!hit) {
    hit = { ...icon, name: key, body: icon.body.replace(/^(<g[^>]*?)stroke-width="[^"]*"/, `$1stroke-width="${width}"`) };
    strokeCache.set(key, hit);
  }
  return hit;
}

export type IconProps = {
  icon: IconData;
  size?: number;
  color?: string;
  strokeWidth?: number;
  spin?: number;
  id?: string;
  title?: string;
  opacity?: number;
};

/** A catalog icon drawn by the engine, tinted with `color` (currentColor) unless it names its own colours. */
export function Icon({ icon, size = 16, color, strokeWidth, spin, id, title, opacity }: IconProps) {
  const data = strokeWidth === undefined ? icon : withStroke(icon, strokeWidth);
  return <icon id={id} svg={data.body} name={data.name} view={data.view} size={size} color={color ?? icon.color} spin={spin} title={title} opacity={opacity} />;
}
