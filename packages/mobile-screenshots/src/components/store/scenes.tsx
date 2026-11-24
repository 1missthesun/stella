import type { CSSProperties, ReactNode } from "react";
import { CANVAS, type Frame, type SlideSlug } from "@/store/slides";
import { BrandCharacter } from "../BrandCharacter";
import { ChatBar, Composer, Mascot, Mine, Notification, Photo, ProviderMark, RoundButton, ViewerBar } from "./app";
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
    <DeviceFrame frame={frame} {...fit(props)} locked screen={
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

function Pin({ photo, x, y, size }: { photo: string; x: string; y: string; size: number }) {
  return <div className="pin" style={{ left: x, top: y, width: size, height: size, marginLeft: -size / 2, marginTop: -size - 9 }}><Photo name={photo} style={{ width: "100%", height: "100%", borderRadius: "50%" }} /></div>;
}

// Walking route between the four stops, from OpenStreetMap routing, in map pixels.
const ROUTE = "M533 963L541 974L534 979L539 987L549 990L558 992L565 997L597 1047L603 1055L606 1062L598 1072L594 1078L608 1121L612 1128L604 1131L595 1136L583 1144L583 1163L583 1201L582 1219L585 1229L588 1241L567 1252L560 1256L522 1274L513 1279L504 1283L494 1283L490 1289L488 1348L487 1374L489 1382L490 1391L501 1394L505 1385L511 1381L528 1377L548 1374L569 1371L579 1371L596 1381L618 1392L650 1391L660 1389L680 1384L687 1380L699 1377L710 1376L735 1368L755 1428L771 1483L773 1491L782 1516L794 1546L804 1577L807 1588L810 1599L819 1597L826 1594L835 1591L865 1582L860 1565L852 1538L842 1505L890 1490L895 1485L945 1467L955 1466L979 1459L988 1457L1018 1448L1018 1428L1024 1417L1039 1391L1052 1368L1060 1353L1069 1352L1099 1334L1097 1313L1081 1297L1098 1299L1107 1301L1127 1307L1160 1322L1180 1330L1201 1304L1207 1296L1213 1289L1218 1277L1221 1270L1224 1260L1198 1231L1211 1223L1225 1212L1231 1205L1238 1197L1244 1192L1251 1184L1252 1162L1257 1151L1260 1143L1263 1134L1276 1116L1280 1110L1279 1093L1278 1084L1272 1071L1264 1064L1253 1051L1247 1044L1241 1039L1234 1022L1222 1005L1205 981L1190 964L1185 959L1170 945L1165 932L1162 919L1160 906L1154 868L1175 865";

// 4 — a trip you can see.
function Trip(props: SceneProps) {
  const { tablet, w } = FRAMES[props.frame];
  const mapW = props.frame === "ipad" ? w : tablet ? w * 1.12 : 610;
  const pin = tablet ? 124 : 90;
  const days = [["tram", "Fri", "Alfama"], ["belem", "Sat", "Belém"], ["miradouro", "Sun", "Graça"]];
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} screen={
      <div className={`trip ${tablet ? "tablet" : ""}`}>
        <div className="trip-map" style={{ width: mapW, height: (mapW * 2000) / 1629, left: (w - mapW) / 2 }}>
          <Photo name="lisbon-map" style={{ width: "100%", height: "100%" }} />
          <svg viewBox="0 0 1629 2000" preserveAspectRatio="none" fill="none" strokeLinejoin="round" strokeLinecap="round"><path d={ROUTE} stroke="#fff" strokeWidth={30} /><path d={ROUTE} stroke="#0a84ff" strokeWidth={18} /></svg>
          <Pin photo="hotel" x="33.3%" y="47.8%" size={pin} />
          <Pin photo="pastel" x="30.4%" y="68.7%" size={pin} />
          <Pin photo="tram" x="73.8%" y="65.2%" size={pin} />
          <Pin photo="miradouro" x="72.1%" y="43.5%" size={pin} />
        </div>
        <ViewerBar title="Lisbon" />
        <div className="trip-sheet"><span>© OpenStreetMap</span></div>
      </div>
    } over={
      <div className={`trip-days ${tablet ? "tablet" : ""}`}>
        {days.map(([photo, day, place]) => <div className="trip-day" key={day}><Photo name={photo} style={{ width: "100%", height: "100%" }} /><div><span>{day}</span><b>{place}</b></div></div>)}
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

// 7 — the morning, drawn.
function Morning(props: SceneProps) {
  const { tablet } = FRAMES[props.frame];
  const rain = [0, 0, 18, 64, 92, 58, 22, 0, 0];
  return (
    <DeviceFrame frame={props.frame} {...fit(props)} light darkHome screen={
      <div className={`morning ${tablet ? "tablet" : ""}`}>
        <div className="morning-sky"><Photo name="sunrise" position="50% 100%" style={{ width: "100%", height: "100%" }} /><div className="morning-hello">Good morning</div><div className="morning-temp">18°</div></div>
        <div className="morning-day">
          {([["10:30", "Dentist", "#ff9f0a", "#fff1db"], ["1:00", "Lunch with Ana", "#34c759", "#e2f7e7"], ["5:00", "Mia’s recital", "#af52de", "#f5e8fb"]] as const).map(([time, what, ink, bg]) =>
            <div key={time} className="morning-row"><span>{time}</span><div style={{ background: bg }}><i style={{ background: ink }} /><b>{what}</b></div></div>)}
        </div>
      </div>
    } over={
      <div className={`umbrella ${tablet ? "tablet" : ""}`}>
        <i className="umbrella-icon"><Icon name="umbrella" size={38} color="#fff" stroke={2.1} /></i>
        <div><strong>Take an umbrella</strong><span>Rain from 10 to 11</span><div className="umbrella-rain">{rain.map((v, i) => <u key={i} style={{ height: `${Math.max(8, v)}%`, opacity: v ? 1 : 0.22 }} />)}</div></div>
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
  assistant: Assistant, computer: Computer, approve: Approve, trip: Trip,
  create: Create, apps: Apps, morning: Morning, models: Models,
};
