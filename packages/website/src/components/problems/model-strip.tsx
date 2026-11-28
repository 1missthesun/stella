import Link from "next/link";
import s from "./model-strip.module.css";

export type ModelId = "claude" | "gemini" | "chatgpt";

const MODELS: { id: ModelId; name: string; logo: string }[] = [
  { id: "claude", name: "Claude", logo: "/landing/logos/claude-mark.svg" },
  { id: "gemini", name: "Gemini", logo: "/landing/logos/gemini.svg" },
  { id: "chatgpt", name: "ChatGPT", logo: "/landing/logos/chatgpt.svg" },
];

function ModelList({ recommended, className }: { recommended?: ModelId; className?: string }) {
  return (
    <ul className={`${s.list} ${className ?? ""}`}>
      {MODELS.map((m) => (
        <li key={m.id} className={s.model} data-on={m.id === recommended ? "1" : undefined}>
          <span className={s.logo} style={{ ["--logo" as string]: `url(${m.logo})` }} aria-hidden="true" />
          <span className={s.name}>{m.name}</span>
          {m.id === recommended ? <span className={s.pick}>Recommended</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function ModelStrip({ recommended, className }: { recommended?: ModelId; className?: string }) {
  return (
    <div className={`${s.strip} ${className ?? ""}`}>
      <span className={s.label}>Runs on</span>
      <ModelList recommended={recommended} />
    </div>
  );
}

const PLAN_BODY = "Jobs like this need a top model. Sign in with the plan you already pay for, at no extra cost.";

export function PlanCallout({
  recommended,
  body = PLAN_BODY,
  className,
}: {
  recommended?: ModelId;
  body?: string;
  className?: string;
}) {
  return (
    <div className={`${s.plan} ${className ?? ""}`}>
      <p className={s.planTitle}>Use your Claude, Gemini or ChatGPT plan.</p>
      <p className={s.planBody}>{body}</p>
      <ModelList recommended={recommended} className={s.planList} />
      <p className={s.planNone}>
        Don&rsquo;t have one yet? Grab a $20/mo plan from any of them, or use <Link href="/pricing">Stella Plus</Link>.
      </p>
    </div>
  );
}
