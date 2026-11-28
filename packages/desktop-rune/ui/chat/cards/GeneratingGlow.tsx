import { useState } from "react";
import { derive, mixOklch, useTokens } from "../../theme";

const NOISE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";
const NOISE_TILE = 160;

const BLOBS: { at: [number, number]; r: [number, number]; strong: number; soft: number }[] = [
  { at: [0.2, 0.25], r: [0.45, 0.55], strong: 22, soft: 10 },
  { at: [0.8, 0.3], r: [0.5, 0.55], strong: 18, soft: 8 },
  { at: [0.7, 0.8], r: [0.55, 0.6], strong: 20, soft: 9 },
  { at: [0.25, 0.75], r: [0.5, 0.55], strong: 16, soft: 7 },
];

/** The image-generation placeholder: four drifting blurred foreground glows under a grain layer. */
export function GeneratingGlow({ drift = true }: { drift?: boolean }) {
  const tokens = useTokens();
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const stops = derive(tokens, "generating-glow", (k) =>
    BLOBS.map((blob) => [
      [0, mixOklch(k.c.foreground, blob.strong, "transparent")],
      [0.35, mixOklch(k.c.foreground, blob.soft, "transparent")],
      [0.7, mixOklch(k.c.foreground, 0, "transparent")],
    ] as [number, string][]),
  );
  const [w, h] = size;
  const ox = w * 0.4;
  const oy = h * 0.4;
  const tilesX = Math.ceil(w / NOISE_TILE);
  const tilesY = Math.ceil(h / NOISE_TILE);
  return (
    <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} clip={0} inert onSize={(r) => setSize([r.w, r.h])}>
      {w > 0 ? (
        <box
          absolute={{ left: -ox, top: -oy }}
          w={w + ox * 2}
          h={h + oy * 2}
          blur={32}
          loop={
            drift
              ? {
                  kind: "sequence",
                  period: 6,
                  frames: [
                    { at: 0, x: -0.06 * (w + ox * 2), y: -0.04 * (h + oy * 2), scale: 1 },
                    { at: 0.33, x: 0.05 * (w + ox * 2), y: -0.03 * (h + oy * 2), scale: 1.08 },
                    { at: 0.66, x: 0.04 * (w + ox * 2), y: 0.05 * (h + oy * 2), scale: 1.04 },
                    { at: 1, x: -0.06 * (w + ox * 2), y: -0.04 * (h + oy * 2), scale: 1 },
                  ],
                }
              : undefined
          }
        >
          {BLOBS.map((blob, index) => (
            <box key={index} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radial={{ center: blob.at, radius: [blob.r[0] * (w + ox * 2), blob.r[1] * (h + oy * 2)], stops: stops[index]! }} />
          ))}
        </box>
      ) : null}
      {w > 0
        ? Array.from({ length: tilesX * tilesY }, (_, index) => (
            <image key={index} absolute={{ left: (index % tilesX) * NOISE_TILE, top: Math.floor(index / tilesX) * NOISE_TILE }} w={NOISE_TILE} h={NOISE_TILE} src={NOISE} opacity={0.35} />
          ))
        : null}
    </box>
  );
}
