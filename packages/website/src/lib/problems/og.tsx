import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { FREE_LINE } from "./index";

export const OG_SIZE = { width: 1200, height: 630 };

const font = (file: string) => readFile(path.join(process.cwd(), "assets/og-fonts", file));

/** The share image for /how pages, built once at build time, in the site's own type. */
export async function problemOgImage({
  eyebrow,
  headline,
  note,
  poster,
}: {
  eyebrow: string;
  headline: string;
  note?: string;
  /** A frame from the proof recording, shown beside the headline. */
  poster?: string;
}) {
  const [medium, heavy, logo] = await Promise.all([
    font("MonaSans-Medium.ttf"),
    font("MonaSans-ExtraBold.ttf"),
    readFile(path.join(process.cwd(), "public/stella-logo.svg")),
  ]);
  const size = poster
    ? headline.length > 40 ? 56 : 66
    : headline.length > 52 ? 64 : headline.length > 36 ? 76 : 92;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "60px 72px 54px",
          background: "#ffffff",
          color: "#0a0a0d",
          fontFamily: "Mona Sans",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the browser */}
          <img src={`data:image/svg+xml;base64,${logo.toString("base64")}`} width={40} height={40} alt="" />
          Stella
        </div>
        <div
          style={{
            marginTop: 54,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: "-0.015em",
            color: "rgba(10,10,13,0.5)",
          }}
        >
          {eyebrow}
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 40, alignItems: "flex-start" }}>
          <div
            style={{
              maxWidth: poster ? 560 : 1000,
              fontSize: size,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: "-0.05em",
            }}
          >
            {headline}
          </div>
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the browser
            <img
              src={poster}
              width={456}
              height={256}
              alt=""
              style={{ borderRadius: 12, objectFit: "cover", border: "1px solid rgba(10,10,13,0.12)" }}
            />
          ) : null}
        </div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            paddingTop: 20,
            borderTop: "1px solid rgba(10,10,13,0.14)",
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: "rgba(10,10,13,0.6)",
          }}
        >
          <span>{note ?? FREE_LINE}</span>
          <span style={{ color: "#703cff" }}>stella.sh</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Mona Sans", data: medium, weight: 500, style: "normal" },
        { name: "Mona Sans", data: heavy, weight: 800, style: "normal" },
      ],
    },
  );
}
