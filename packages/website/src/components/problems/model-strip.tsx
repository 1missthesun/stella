import s from "./model-strip.module.css";

export type ModelId = "claude" | "gemini" | "chatgpt";

const MODELS: { id: ModelId; name: string; logo: string }[] = [
  { id: "claude", name: "Claude", logo: "/landing/logos/claude-mark.svg" },
  { id: "gemini", name: "Gemini", logo: "/landing/logos/gemini.svg" },
  { id: "chatgpt", name: "ChatGPT", logo: "/landing/logos/chatgpt.svg" },
];

export function ModelStrip({ recommended, className }: { recommended?: ModelId; className?: string }) {
  return (
    <div className={`${s.strip} ${className ?? ""}`}>
      <span className={s.label}>Runs on</span>
      <ul className={s.list}>
        {MODELS.map((m) => (
          <li key={m.id} className={s.model} data-on={m.id === recommended ? "1" : undefined}>
            <span className={s.logo} style={{ ["--logo" as string]: `url(${m.logo})` }} aria-hidden="true" />
            <span className={s.name}>{m.name}</span>
            {m.id === recommended ? <span className={s.pick}>Recommended</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
