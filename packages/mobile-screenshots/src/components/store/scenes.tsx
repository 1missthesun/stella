import type { CSSProperties, ReactNode } from "react";
import { CANVAS, type Frame, type SlideSlug } from "@/store/slides";
import { BrandCharacter } from "../BrandCharacter";
import { AppIcon, ChatBar, Composer, Mascot, Mine, Notification, Photo, ProviderMark, RoundButton, ViewerBar } from "./app";
import { DeviceFrame, FRAMES, Icon, Laptop, frameSize } from "./frames";
import type { IconName } from "./icons";

export interface SceneProps { frame: Frame; height: number; top: number; bottom: number }

/** The device, centred in the space between the headline and the bottom margin. */
function fit({ frame, height, top, bottom }: SceneProps) {
  const size = frameSize(frame);
  const scale = Math.min((height - top - bottom) / size.h, 1040 / size.w);
  const slack = height - top - bottom - size.h * scale;
  return { scale, style: { left: (CANVAS - size.w * scale) / 2, top: top + slack / 2 } as CSSProperties };
}

// 1 — what it is: your day, already handled.
function Assistant(props: SceneProps) {
  const { frame } = props;
  const { tablet } = FRAMES[frame];
  return (
    <DeviceFrame frame={frame} {...fit(props)} locked light screen={
      <div className={`lock ${tablet ? "tablet" : ""}`}>
        <div className="lock-date">Friday, June 12</div>
        <div className="lock-time">9:41</div>
        <Mascot size={tablet ? 300 : 206} />
      </div>
    } over={
      <div className={`notifications ${tablet ? "tablet" : ""}`}>
        <Notification title="Dinner is booked" body="Tonight at 8, by the window" thumb="table" />
        <Notification title="Lisbon is planned" body="3 days, hotel and flights" thumb="tram" />
        {frame !== "ipad" && <Notification title="Your slides are ready" body="Autumn menu" thumb="coldbrew" />}
        <Notification title="Mia’s poster is done" body="Ready to print" thumb="poster" />
      </div>
    } />
  );
}

function Slide({ kind }: { kind: "cover" | "bun" | "brew" | "cake" | "chart" }) {
  const product = { bun: ["Cinnamon", "bun", "#5a2c12"], brew: ["Maple", "iced coffee", "#fff4e6"], cake: ["Apple", "cake", "#22341f"] } as const;
  if (kind === "cover")
    return <div className="slide"><Photo name="latte" style={{ width: "100%", height: "100%" }} /><div className="slide-title" style={{ color: "#fff4e6" }}>Autumn<br />menu</div></div>;
  if (kind === "chart")
    return (
      <div className="slide" style={{ background: "#fbf3e7" }}>
        <div className="slide-title small" style={{ color: "#8c3512" }}>+24%</div>
        <div className="slide-bars">{[34, 46, 42, 61, 78, 96].map((v, i) => <i key={i} style={{ height: `${v}%`, background: i > 3 ? "#b84a1b" : "#e9c9a8" }} />)}</div>
      </div>
    );
  const [a, b, color] = product[kind];
  const photo = { bun: "bun", brew: "coldbrew", cake: "applecake" }[kind];
  const bg = { bun: "#f4e6d2", brew: "#b4430f", cake: "#9fae93" }[kind];
  return <div className="slide" style={{ background: bg }}><Photo name={photo} style={{ position: "absolute", right: 0, top: 0, height: "100%", width: "56.25%", maskImage: "linear-gradient(90deg,transparent,#000 22%)" }} /><div className="slide-title small" style={{ color }}>{a}<br />{b}</div></div>;
}

// 2 — the same deck on the computer and in your hand.
function Computer({ frame, height, top, bottom }: SceneProps) {
  const { tablet } = FRAMES[frame];
  const size = frameSize(frame);
  const laptop = frame === "ipad" ? 0.74 : tablet ? 0.9 : 0.985;
  const laptopTop = top - 10;
  const deviceTop = laptopTop + (frame === "ipad" ? 420 : tablet ? 580 : 640);
  const scale = Math.min((height - deviceTop - bottom) / size.h, tablet ? 1.05 : 1.9);
  return (
    <>
      <Laptop scale={laptop} style={{ left: (CANVAS - 1240 * laptop) / 2, top: laptopTop }}>
        <div className="desktop">
          <div className="window">
            <div className="window-bar"><i /><i /><i /><b>Autumn menu</b></div>
            <div className="window-body">
              <div className="window-rail"><Slide kind="cover" /><Slide kind="bun" /><Slide kind="brew" /><Slide kind="cake" /></div>
              <div className="window-main"><Slide kind="cover" /><BrandCharacter shape="cursor" className="agent-cursor" /></div>
            </div>
          </div>
        </div>
      </Laptop>
      <DeviceFrame frame={frame} scale={scale} style={{ left: (CANVAS - size.w * scale) / 2, top: deviceTop }} screen={
        <div className={`chat ${tablet ? "tablet" : ""}`}>
          <ChatBar />
          <Mine>Finish the deck on my computer</Mine>
          <div className="deck">
            <Slide kind="cover" />
            <div className="deck-grid"><Slide kind="bun" /><Slide kind="brew" /><Slide kind="cake" /><Slide kind="chart" /></div>
          </div>
          <div className="file"><i><Icon name="presentation" size={26} color="#fff" /></i><span><b>Autumn menu</b>On your desktop</span></div>
          {frame !== "ipad" && <Composer />}
        </div>
      } />
    </>
  );
}

// 3 — one tap.
function Approve(props: SceneProps) {
  const { tablet } = FRAMES[props.frame];
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} screen={
      <div className={`chat ${tablet ? "tablet" : ""}`}>
        <ChatBar />
        <Mine>Dinner tonight, with a view?</Mine>
        <Photo name="table" style={{ width: "100%", height: props.frame === "ipad" ? 470 : tablet ? 570 : 340, borderRadius: 22 }} />
      </div>
    } over={
      <div className={`ask ${tablet ? "tablet" : ""}`}>
        <strong>Book the window table?</strong>
        <span>Osteria Lume, tonight at 8, for two</span>
        <div className="ask-option selected"><b>Yes, book it</b><i><Icon name="check" size={22} color="#fff" stroke={3} /></i></div>
        <div className="ask-option"><b>Show me other times</b></div>
        <div className="ask-option"><em>Something else…</em></div>
      </div>
    } />
  );
}

// 4 — real work, finished: mail answered, the budget, the form, the shopping.
function Work(props: SceneProps) {
  const { tablet } = FRAMES[props.frame];
  const budget = [["Home", 92, "#4b8bff"], ["Food", 64, "#ff9f0a"], ["Fun", 38, "#ff5c93"]] as const;
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} screen={
      <div className={`mail ${tablet ? "tablet" : ""}`}>
        <div className="app-bar"><RoundButton icon="chevron-right" /><b className="page-title">Email</b><span style={{ width: 44 }} /></div>
        <div className="mail-item">
          <h2>Dinner on Thursday</h2>
          <p>Marco Ruiz · 9:12 AM</p>
          <div className="mail-draft">Thursday at 7 works for us.</div>
          <div className="mail-row"><b>Send reply</b><span>Tell Stella</span></div>
        </div>
      </div>
    } over={
      <div className={`works ${tablet ? "tablet" : ""}`}>
        <div className="work sheet">
          <div className="work-head"><span>Budget</span><i><Icon name="check" size={18} color="#fff" stroke={3.4} /></i></div>
          <div className="sheet-grid">{budget.map(([name, v, ink]) => <div key={name}><b>{name}</b><span><u style={{ width: `${v}%`, background: ink }} /></span></div>)}</div>
        </div>
        <div className="work form">
          <div className="form-page">
            <em>PDF</em>
            <strong>Lease</strong>
            {[100, 88, 94].map((w, i) => <s key={i} style={{ width: `${w}%` }} />)}
            <q><Icon name="check" size={15} color="#0a84ff" stroke={3.4} /></q><q className="short"><Icon name="check" size={15} color="#0a84ff" stroke={3.4} /></q>
          </div>
        </div>
        <div className="work shop">
          {["chair2", "chair1", "chair3"].map((name, i) => <div key={name} className={i === 1 ? "pick" : ""}><Photo name={name} style={{ width: "100%", height: "100%" }} />{i === 1 && <i><Icon name="check" size={18} color="#fff" stroke={3.2} /></i>}</div>)}
        </div>
        <div className="work tasks"><Mascot size={58} /><b>3 tasks in progress</b><span>{[72, 48, 26].map((v) => <svg key={v} viewBox="0 0 36 36" fill="none" strokeWidth={5.5} strokeLinecap="round"><circle cx="18" cy="18" r="14" stroke="#e4eaf4" /><circle cx="18" cy="18" r="14" stroke="#0a84ff" pathLength={100} strokeDasharray={`${v} 100`} transform="rotate(-90 18 18)" /></svg>)}</span></div>
      </div>
    } />
  );
}

// 5 — pictures, film, music.
function Create(props: SceneProps) {
  const { tablet } = FRAMES[props.frame];
  const bars = [10, 22, 14, 34, 48, 30, 56, 40, 64, 46, 28, 52, 38, 60, 44, 24, 50, 32, 18, 40, 26, 12];
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} light screen={
      <div className="create"><Photo name="fox" style={{ width: "100%", height: "100%" }} position="3% 50%" /></div>
    } over={
      <div className={`creations ${tablet ? "tablet" : ""}`}>
        <div className="creation poster"><Photo name="poster" style={{ width: "100%", height: "100%" }} /></div>
        <div className="creation dog"><Photo name="dog" style={{ width: "100%", height: "100%" }} /></div>
        <div className="creation film"><Photo name="robot" style={{ width: "100%", height: "100%" }} /><i><Icon name="play" size={34} color="#fff" fill="#fff" /></i></div>
        <div className="creation song"><i><Icon name="play" size={24} color="#fff" fill="#fff" /></i><span>{bars.map((v, i) => <u key={i} style={{ height: v, opacity: i < 9 ? 1 : 0.28 }} />)}</span></div>
      </div>
    } />
  );
}

function Plants({ tablet }: { tablet: boolean }) {
  const rest = [["plant2", "Snake plant"], ["plant3", "Calathea"], ["plant4", "Olive tree"]];
  return (
    <div className={`plants ${tablet ? "tablet" : ""}`}>
      <div className="plants-hero"><div className="plants-title">My plants</div><Photo name="plant1" style={{}} />
        <div className="plants-water"><i><Icon name="droplets" size={26} color="#fff" /></i><b>Water today</b></div></div>
      <div className="plants-grid">{rest.slice(0, tablet ? 3 : 2).map(([photo, name]) => <div key={name}><Photo name={photo} style={{}} /><b>{name}</b></div>)}</div>
    </div>
  );
}

/** Apps peeking out on the left show their leading edge only, so nothing readable is ever cut. */
function Chores() {
  const rows: [IconName, string, string][] = [["bed", "#ff7a59", "#ffe1d8"], ["paw-print", "#ffab1a", "#ffedc9"], ["book-open", "#2fb673", "#d5f3e2"], ["shirt", "#4b8bff", "#dbe8ff"], ["music", "#a66bff", "#eadfff"], ["heart", "#ff5c93", "#ffdde9"]];
  return <div className="chores">{rows.map(([icon, ink, bg]) => <div key={icon} style={{ background: bg }}><i style={{ background: ink }}><Icon name={icon} size={40} color="#fff" stroke={2.3} /></i></div>)}</div>;
}

function Habits() {
  const rows: [string, boolean][] = [["#c8f560", true], ["#7ce0ff", true], ["#ff9ecb", true], ["#ffd25e", false], ["#b9a5ff", true], ["#7af0b4", false]];
  return <div className="habits">{rows.map(([ink, done], i) => <div key={i} style={{ background: done ? ink : "#1c1e26" }}><i style={done ? { background: "#0d0e13" } : { border: `5px solid ${ink}` }}>{done && <Icon name="check" size={34} color={ink} stroke={3.4} />}</i></div>)}</div>;
}

// 6 — software for one.
function Apps(props: SceneProps) {
  const { frame, height, top, bottom } = props;
  const { tablet, ios } = FRAMES[frame];
  const size = frameSize(frame);
  const phone: Frame = ios ? "iphone" : "android";
  const phoneSize = frameSize(phone);
  const scale = Math.min((height - top - bottom) / size.h, tablet ? (frame === "ipad" ? 1 : 1.12) : 2);
  const main = { w: size.w * scale, h: size.h * scale };
  const centredTop = top + (height - top - bottom - main.h) / 2;
  const side = Math.min(1.56, (main.h * 0.86) / phoneSize.h);
  const sideTop = centredTop + (main.h - phoneSize.h * side) / 2;
  const offset = 40;
  return (
    <>
      <DeviceFrame frame={phone} scale={side} className="back" style={{ left: offset, top: sideTop, transform: "rotate(-2.5deg)" }} screen={<Chores />} />
      <DeviceFrame frame={phone} scale={side} className="back" light style={{ right: offset, top: sideTop, transform: "rotate(2.5deg)" }} screen={<Habits />} />
      <DeviceFrame frame={frame} scale={scale} style={{ left: (CANVAS - main.w) / 2, top: centredTop }} screen={<><Plants tablet={tablet} /><div className="app-bar floating"><RoundButton icon="chevron-left" /><span /></div></>} />
    </>
  );
}

type Scheduled = [icon: IconName, title: string, when: string];

// 7 — the app's Schedule page, and what one of its watches found.
function Schedule(props: SceneProps) {
  const { tablet } = FRAMES[props.frame];
  const sections: [string, Scheduled[]][] = [
    ["Today", [["eye", "New apartments", "9:45 AM"], ["list-checks", "Sort my inbox", "5:00 PM"], ["bell", "Call Grandma", "7:30 PM"]]],
    ["Tomorrow", [["list-checks", "Morning briefing", "7:30 AM"], ["eye", "Concert tickets", "9:00 AM"]]],
  ];
  if (props.frame === "androidTablet") sections[1][1].push(["bell", "Water the plants", "6:00 PM"]);
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} screen={
      <div className={`schedule ${tablet ? "tablet" : ""}`}>
        <div className="app-bar"><RoundButton icon="chevron-right" /><b className="page-title">Schedule</b><span style={{ width: 44 }} /></div>
        {sections.map(([label, rows]) => <section key={label}><h2>{label}</h2>
          {rows.map(([icon, title, when]) => <div key={title} className={`schedule-row ${title === "New apartments" ? "highlighted" : ""}`}><Icon name={icon} size={27} color="#0a84ff" /><b>{title}</b><span>{when}</span></div>)}
        </section>)}
      </div>
    } over={
      <div className={`found ${tablet ? "tablet" : ""}`}>
        <div className="found-head"><AppIcon size={52} /><div><strong>Found an apartment</strong><span>Two bedrooms, by the park</span></div></div>
        <Photo name="room" position="60% 40%" style={{}} />
      </div>
    } />
  );
}

// 8 — the plans you have.
function Models(props: SceneProps) {
  const { tablet } = FRAMES[props.frame];
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} screen={
      <div className={`models ${tablet ? "tablet" : ""}`}><ViewerBar title="Model" /><Mascot size={tablet ? 250 : 196} /></div>
    } over={
      <div className={`model-cards ${tablet ? "tablet" : ""}`}>
        {([["claude", "Claude"], ["chatgpt", "ChatGPT"], ["gemini", "Gemini"]] as const).map(([id, name], i) =>
          <div className="model-card" key={id}><ProviderMark provider={id} size={66} /><b>{name}</b>{i === 0 && <i><Icon name="check" size={24} color="#fff" stroke={3} /></i>}</div>)}
      </div>
    } />
  );
}

export const SCENES: Record<SlideSlug, (props: SceneProps) => ReactNode> = {
  assistant: Assistant, computer: Computer, approve: Approve, work: Work,
  create: Create, apps: Apps, schedule: Schedule, models: Models,
};
