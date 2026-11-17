import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SECURITY_PRICE_LINE } from "@/lib/security";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Stella Security: a white wall stopping black shots, keeping the laptop behind it safe.";

const asset = (...parts: string[]) => readFile(path.join(process.cwd(), ...parts));

/** The share card: the headline beside a frame of the hero's own wall. */
export default async function Image() {
  const [medium, heavy, logo, wall] = await Promise.all([
    asset("assets/og-fonts", "MonaSans-Medium.ttf"),
    asset("assets/og-fonts", "MonaSans-ExtraBold.ttf"),
    asset("public", "stella-logo.svg"),
    asset("assets", "security-og-wall.jpg"),
  ]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", color: "#0a0a0d", fontFamily: "Mona Sans" }}>
        <div style={{ display: "flex", flexDirection: "column", padding: "60px 0 56px 72px", width: 620 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
            <img src={`data:image/svg+xml;base64,${logo.toString("base64")}`} width={40} height={40} alt="" />
            Stella Security
          </div>
          <div style={{ marginTop: 64, fontSize: 88, fontWeight: 800, lineHeight: 0.92, letterSpacing: "-0.055em" }}>
            Safe online, without the worry.
          </div>
          <div style={{ marginTop: "auto", fontSize: 26, fontWeight: 500, color: "rgba(10,10,13,0.55)" }}>
            {`Mac, Windows and Linux · ${SECURITY_PRICE_LINE}`}
          </div>
        </div>
        <img
          src={`data:image/jpeg;base64,${wall.toString("base64")}`}
          width={620}
          height={482}
          alt=""
          style={{ position: "absolute", right: -10, top: 96 }}
        />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Mona Sans", data: medium, weight: 500, style: "normal" },
        { name: "Mona Sans", data: heavy, weight: 800, style: "normal" },
      ],
    },
  );
}
