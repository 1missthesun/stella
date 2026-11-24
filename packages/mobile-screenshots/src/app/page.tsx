import { CANVAS, devices, slides, type Device, type Frame } from "@/store/slides";
import { SCENES } from "@/components/store/scenes";
import { SetAura } from "@/components/store/SetAura";
import "./store.css";

/** Headline and device placement per device family, in canvas units (1320 wide). */
const LAYOUT: Record<Frame, { copyTop: number; size: number; top: number; bottom: number }> = {
  iphone: { copyTop: 168, size: 176, top: 664, bottom: 150 },
  android: { copyTop: 96, size: 152, top: 478, bottom: 84 },
  ipad: { copyTop: 78, size: 116, top: 372, bottom: 74 },
  androidTablet: { copyTop: 96, size: 152, top: 478, bottom: 90 },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const device: Device = typeof query.device === "string" && Object.hasOwn(devices, query.device) ? (query.device as Device) : "iphone";
  const size = devices[device];
  const layout = LAYOUT[size.frame];
  const scale = size.width / CANVAS;
  const height = size.height / scale;
  const tablet = size.frame === "ipad" || size.frame === "androidTablet";
  const exportMode = query.export === "1";
  return (
    <main className={`store-studio ${exportMode ? "export-mode" : ""}`}>
      {!exportMode && (
        <header className="studio-toolbar">
          <strong>Stella store set</strong>
          <nav>{Object.entries(devices).map(([id, value]) => <a key={id} aria-current={id === device ? "page" : undefined} href={`/?device=${id}`}>{value.label}</a>)}</nav>
        </header>
      )}
      <div className="store-gallery">
        {slides.map((slide, index) => {
          const Scene = SCENES[slide.slug];
          const title = tablet && "tabletTitle" in slide ? slide.tabletTitle : slide.title;
          return (
            <section key={slide.slug} className="slide-preview" style={{ aspectRatio: `${size.width}/${size.height}`, "--fit": `calc(100cqw / ${size.width}px)` } as React.CSSProperties}>
              <article data-export-slide={slide.slug} className="store-slide" style={{ width: size.width, height: size.height }}>
                <div className={`slide-canvas frame-${size.frame}`} style={{ width: CANVAS, height, transform: `scale(${scale})` }}>
                  <SetAura index={index} count={slides.length} />
                  <h1 style={{ top: layout.copyTop, fontSize: layout.size }}>{title.map((line) => <span key={line}>{line}</span>)}</h1>
                  <Scene frame={size.frame} height={height} top={layout.top} bottom={layout.bottom} />
                </div>
              </article>
            </section>
          );
        })}
      </div>
    </main>
  );
}
