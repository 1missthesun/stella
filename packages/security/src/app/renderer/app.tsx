import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { STELLA_STAR_PATH } from "../../../../contracts/stella-mark.ts";
import type { Finding, HandledLine, RunSummary } from "../../engine/types.ts";

type View = {
  phase: "signed-out" | "first-check" | "checking" | "ready";
  progress?: string;
  summary?: RunSummary;
  account?: { email?: string };
  email?: { connected: boolean; address?: string };
  error?: string;
};

type Api = {
  view(): Promise<View>;
  onView(cb: (v: View) => void): () => void;
  checkNow(): Promise<void>;
  signIn(how: { kind: "google" } | { kind: "email"; email: string }): Promise<void>;
  connectEmail(): Promise<void>;
  disconnectEmail(): Promise<void>;
  fix(id: string): Promise<void>;
  snooze(id: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  signOut(): Promise<void>;
};
declare global {
  interface Window {
    security: Api;
  }
}
const api = window.security;

const ago = (t: number, now: number) => {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};
const short = (t: number, now: number) => {
  const m = Math.round((now - t) / 60_000);
  if (m < 60) return m < 1 ? "now" : `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
};

const Star = () => (
  <svg viewBox="0 0 228.5 228.5" aria-hidden="true">
    <path d={STELLA_STAR_PATH} fill="currentColor" />
  </svg>
);

const useNow = () => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
};

const STEPS = [
  { key: "Looking at this computer", label: "Your computer" },
  { key: "Checking", label: "New downloads, apps and extensions" },
  { key: "accounts", label: "Your accounts and known leaks" },
  { key: "news", label: "Today's security news" },
  { key: "email", label: "Your email" },
];

const Steps = ({ progress, email }: { progress?: string; email: boolean }) => {
  const idx = Math.max(0, STEPS.findIndex((s) => progress?.toLowerCase().includes(s.key.toLowerCase())));
  return (
    <ul className="steps">
      {STEPS.filter((s) => email || s.key !== "email").map((s, i) => (
        <li key={s.key} className={i < idx ? "done" : i === idx ? "on" : ""}>
          <span className="mark" />
          {s.label}
        </li>
      ))}
    </ul>
  );
};

const Privacy = () => (
  <div className="privacy fade">
    <p>Checks run on this computer. Your files, browsing history and saved passwords never leave it; passwords aren't even read.</p>
    <p>What does leave: your email address, to look it up in known leaks; short facts about a new download, extension or suspicious email (its name, where it came from) when Stella Security asks a model about it, through your Stella account; and, if you connect email, nothing is stored anywhere but here.</p>
    <p>Stella Security isn't an antivirus. Your computer's built-in protection already does that job.</p>
  </div>
);

const SignIn = ({ view }: { view: View }) => {
  const [email, setEmail] = useState("");
  const [useEmail, setUseEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  const go = async (how: { kind: "google" } | { kind: "email"; email: string }) => {
    setBusy(true);
    await api.signIn(how);
    setBusy(false);
  };
  return (
    <>
      <div className="hero signin fade">
        <h1 className="headline">Keep this computer safe.</h1>
        <div className="lead">A few times a day, Stella Security checks your computer, your accounts and the day's security news. It only speaks up when something needs you.</div>
        {useEmail ? (
          <>
            <input className="field" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && void go({ kind: "email", email })} autoFocus />
            <button className="primary" disabled={busy || !email} onClick={() => void go({ kind: "email", email })}>
              Send sign-in link
            </button>
            <button className="quiet" onClick={() => setUseEmail(false)}>
              Use Google instead
            </button>
          </>
        ) : (
          <>
            <button className="primary" disabled={busy} onClick={() => void go({ kind: "google" })}>
              Continue with Google
            </button>
            <button className="quiet" onClick={() => setUseEmail(true)}>
              Use email instead
            </button>
          </>
        )}
        {busy && view.progress && <div className="waiting">{view.progress}</div>}
        {view.error && <div className="error">{view.error}</div>}
      </div>
      <div className="foot">
        <div className="row">
          <span className="t">Uses your Stella account</span>
          <button className="link grey" onClick={() => setWhy(!why)}>
            {why ? "Hide" : "What leaves this computer"}
          </button>
        </div>
        {why && <Privacy />}
      </div>
    </>
  );
};

const Why = ({ f }: { f: Finding }) => {
  const [open, setOpen] = useState(false);
  const ev = f.evidence ?? {};
  const lines: string[] = [];
  if (Array.isArray(ev.why)) lines.push(...(ev.why as string[]).map((w) => `Matched because ${w}.`));
  if (typeof ev.headline === "string") lines.unshift(ev.headline);
  if (typeof ev.from === "string") lines.push(`From ${ev.from}`);
  if (Array.isArray(ev.from)) lines.push(`Downloaded from ${(ev.from as string[]).filter(Boolean).map((u) => { try { return new URL(u).hostname; } catch { return u; } }).join(", ")}`);
  if (typeof ev.installed === "string" && typeof ev.mustHave === "string") lines.push(`You have ${ev.installed}; ${ev.mustHave} or newer has the fixes.`);
  if (typeof ev.breachDate === "string") lines.push(`Leak happened ${ev.breachDate}; reported ${String(ev.added ?? "").slice(0, 10)}.`);
  if (typeof ev.subject === "string") lines.push(`Subject: ${ev.subject}`);
  const sources = (ev.sources as string[] | undefined) ?? [];
  if (!lines.length && !sources.length) return null;
  return (
    <div className="why">
      <button onClick={() => setOpen(!open)}>{open ? "Hide details" : "How we know"}</button>
      {open && (
        <ul className="fade">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {sources.slice(0, 3).map((s) => (
            <li key={s}>
              <a href={s} onClick={(e) => (e.preventDefault(), void api.openUrl(s))}>
                {(() => { try { return new URL(s).hostname.replace(/^www\./, ""); } catch { return s; } })()}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Item = ({ f, rest, pick }: { f: Finding; rest: Finding[]; pick: (id: string) => void }) => {
  const [busy, setBusy] = useState(false);
  return (
    <div className="item fade" key={f.id}>
      <div className="title">
        <span className="dot" />
        <span>{f.title}</span>
      </div>
      <div className="detail">{f.detail}</div>
      <Why f={f} />
      {f.action ? (
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api.fix(f.id);
            setBusy(false);
          }}
        >
          {f.action.label}
        </button>
      ) : null}
      <button className="quiet" onClick={() => void api.snooze(f.id)}>
        {f.action ? "Not now" : "Got it"}
      </button>
      {rest.length > 0 && (
        <div className="next">
          After this
          {rest.slice(0, 4).map((r) => (
            <button key={r.id} onClick={() => pick(r.id)}>
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Handled = ({ lines, now }: { lines: HandledLine[]; now: number }) => {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, 6);
  if (!lines.length) return null;
  return (
    <div className="section">
      <div className="label">Handled</div>
      {shown.map((h) => (
        <div className="row" key={h.id}>
          <span className="t">{h.text}</span>
          <span className="when">{short(h.at, now)}</span>
        </div>
      ))}
      {lines.length > 6 && (
        <button className="more" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${lines.length}`}
        </button>
      )}
    </div>
  );
};

/** Several "your password there is older than the leak" lines read better as one. */
const tidy = (lines: HandledLine[]): HandledLine[] => {
  const ok = lines.filter((l) => l.id.startsWith("breach-ok:"));
  const rest = lines.filter((l) => !l.id.startsWith("breach-ok:"));
  if (ok.length > 1) rest.push({ id: "breach-ok", text: `${ok.length} sites you use had leaks; you've changed those passwords since`, at: ok[0]!.at });
  else rest.push(...ok);
  const order = (l: HandledLine) => (l.id.startsWith("fixed:") ? 0 : l.id.startsWith("news") ? 1 : l.id.startsWith("email") ? 2 : 3);
  return rest.sort((a, b) => order(a) - order(b));
};

const Main = ({ view }: { view: View }) => {
  const now = useNow();
  const [front, setFront] = useState<string | undefined>();
  const [privacy, setPrivacy] = useState(false);
  const s = view.summary;
  const needs = s?.needsYou ?? [];
  const current = needs.find((f) => f.id === front) ?? needs[0];
  const rest = needs.filter((f) => f !== current);
  const handled = useMemo(() => tidy(s?.handled ?? []), [s]);
  const checking = view.phase === "checking" || view.phase === "first-check";
  if (view.phase === "first-check" || !s) {
    return (
      <div className="hero fade">
        <h1 className="headline">Checking your computer</h1>
        <div className="sub">The first check takes a minute or two.</div>
        <div style={{ height: 22 }} />
        <Steps progress={view.progress} email={Boolean(view.email?.connected)} />
        {view.error && <div className="error">{view.error}</div>}
      </div>
    );
  }
  return (
    <>
      <div className="hero">
        <h1 className="headline fade" key={needs.length}>
          {needs.length === 0 ? "You're safe." : needs.length === 1 ? "1 thing needs you" : `${needs.length} things need you`}
        </h1>
        <div className="sub">
          {checking ? (
            <span>Checking now{view.progress ? ` · ${view.progress.toLowerCase()}` : ""}</span>
          ) : (
            <>
              <span>Checked {ago(s.finishedAt, now)}</span>
              <span>·</span>
              <button onClick={() => void api.checkNow()}>Check now</button>
            </>
          )}
        </div>
        {view.error && <div className="error">{view.error}</div>}
      </div>
      {current && <Item f={current} rest={rest} pick={setFront} key={current.id} />}
      <Handled lines={handled} now={now} />
      <div className="foot">
        <div className="label">Connected</div>
        <div className="row">
          <span className="t">{view.email?.connected ? `Email · ${view.email.address}` : "Email: catch fake emails and real security alerts"}</span>
          {view.email?.connected ? (
            <button className="link grey" onClick={() => void api.disconnectEmail()}>
              Disconnect
            </button>
          ) : (
            <button className="link" onClick={() => void api.connectEmail()}>
              Connect
            </button>
          )}
        </div>
        <div className="row">
          <span className="t">{view.account?.email ? `Stella account · ${view.account.email}` : "Stella account"}</span>
          <button className="link grey" onClick={() => setPrivacy(!privacy)}>
            {privacy ? "Hide" : "What leaves this computer"}
          </button>
        </div>
        {privacy && <Privacy />}
      </div>
    </>
  );
};

const App = () => {
  const [view, setView] = useState<View | undefined>();
  useEffect(() => {
    void api.view().then(setView);
    return api.onView(setView);
  }, []);
  const mac = navigator.userAgent.includes("Mac");
  return (
    <div className={`app${mac ? " mac" : ""}`}>
      <div className="top">
        <Star />
        <span>Security</span>
        <span className="spacer" />
      </div>
      {!view ? null : view.phase === "signed-out" ? <SignIn view={view} /> : <Main view={view} />}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
