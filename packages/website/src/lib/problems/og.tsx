import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { chatItems, parseBlocks, type DemoInline, type DemoStep } from "@/lib/demo";
import { FREE_LINE } from "./index";

export const OG_SIZE = { width: 1200, height: 630 };

const CHAT = { bg: "#1c1c1e", user: "#2871c9", userText: "#f2fbff", reply: "#3a3a3c", replyText: "#f5f5f7", edge: "rgba(0,0,0,0.09)" };

type OgChat = { you: string; stella?: string };

const plain = (parts: DemoInline[]) => parts.map((part) => part.text).join("");

const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).replace(/[\s,.;:]+$/, "")}…`;
};

export function ogChat(steps: DemoStep[]): OgChat | undefined {
  const items = chatItems(steps);
  const you = items.find((item) => item.kind === "user");
  const reply = items.findLast((item) => item.kind === "assistant");
  if (!you || you.kind !== "user") return undefined;
  const first = reply?.kind === "assistant" ? parseBlocks(reply.text).find((block) => (block.kind === "p" ? block.parts.length : block.items.length)) : undefined;
  let stella = first ? (first.kind === "p" ? plain(first.parts) : first.items.map(plain).join(". ")) : undefined;
  if (stella?.endsWith(":") && stella.includes(". ")) stella = stella.slice(0, stella.lastIndexOf(". ") + 1);
  return { you: clip(you.text, 110), stella: stella ? clip(stella, 120) : undefined };
}

function ChatStill({ chat }: { chat: OgChat }) {
  const bubble = { display: "flex", padding: "11px 15px", borderRadius: 18, fontSize: 21, fontWeight: 500, lineHeight: 1.32, letterSpacing: "-0.01em" } as const;
  return (
    <div
      style={{
        width: 470,
        height: 300,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "26px 24px",
        borderRadius: 14,
        background: CHAT.bg,
        boxShadow: `0 0 0 1px ${CHAT.edge}, 0 30px 70px -30px rgba(10,20,60,0.55)`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ ...bubble, maxWidth: 360, background: CHAT.user, color: CHAT.userText }}>{chat.you}</div>
      </div>
      {chat.stella ? (
        <div style={{ display: "flex" }}>
          <div style={{ ...bubble, maxWidth: 380, background: CHAT.reply, color: CHAT.replyText }}>{chat.stella}</div>
        </div>
      ) : null}
    </div>
  );
}

const font = (file: string) => readFile(path.join(process.cwd(), "assets/og-fonts", file));

export async function problemOgImage({
  eyebrow,
  headline,
  note,
  chat,
}: {
  eyebrow: string;
  headline: string;
  note?: string;
  chat?: OgChat;
}) {
  const [medium, heavy, logo] = await Promise.all([
    font("MonaSans-Medium.ttf"),
    font("MonaSans-ExtraBold.ttf"),
    readFile(path.join(process.cwd(), "public/stella-logo.svg")),
  ]);
  const size = chat
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
              maxWidth: chat ? 560 : 1000,
              fontSize: size,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: "-0.05em",
            }}
          >
            {headline}
          </div>
          {chat ? <ChatStill chat={chat} /> : null}
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
