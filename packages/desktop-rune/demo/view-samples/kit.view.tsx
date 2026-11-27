import { useState, useEffect, Column, Row, Text, Button, Select, Checkbox, Slider, Tabs, Disclosure, Modal, Markdown, Code, Table, Chart, Canvas, Grid, Pressable, useKey, stella } from "@stella/view";

type Planet = { id: string; name: string; moons: number; au: number; kind: string };
const PLANETS: Planet[] = [
  { id: "me", name: "Mercury", moons: 0, au: 0.39, kind: "Rocky" },
  { id: "ve", name: "Venus", moons: 0, au: 0.72, kind: "Rocky" },
  { id: "ea", name: "Earth", moons: 1, au: 1, kind: "Rocky" },
  { id: "ma", name: "Mars", moons: 2, au: 1.52, kind: "Rocky" },
  { id: "ju", name: "Jupiter", moons: 95, au: 5.2, kind: "Gas giant" },
  { id: "sa", name: "Saturn", moons: 146, au: 9.58, kind: "Gas giant" },
];

export default function Kit() {
  const [tab, setTab] = useState("data");
  const [kind, setKind] = useState("all");
  const [onlyMoons, setOnlyMoons] = useState(false);
  const [zoom, setZoom] = useState(0.6);
  const [open, setOpen] = useState<Planet | null>(null);
  const [points, setPoints] = useState<number[][]>([]);
  const [presses, setPresses] = useState(0);
  const [fetched, setFetched] = useState("…");
  useKey("mod+k", () => setPresses((n) => n + 1));
  useEffect(() => {
    stella.fetch("https://api.github.com/zen").then((r) => r.text()).then(setFetched, (e) => setFetched(`fetch failed: ${e.message}`));
  }, []);

  const rows = PLANETS.filter((p) => (kind === "all" || p.kind === kind) && (!onlyMoons || p.moons > 0));
  return (
    <Column gap={16} maxWidth={600}>
      <Row gap={8}>
        <Text variant="title" grow={1}>Kit</Text>
        <Text variant="caption">mod+K pressed {presses}×</Text>
      </Row>
      <Tabs value={tab} tabs={[{ value: "data", label: "Data" }, { value: "draw", label: "Draw" }, { value: "text", label: "Text" }]} onChange={setTab} />
      {tab === "data" ? (
        <Column gap={12}>
          <Row gap={12}>
            <Select value={kind} options={[{ value: "all", label: "All planets" }, "Rocky", "Gas giant"]} onChange={setKind} />
            <Checkbox checked={onlyMoons} onChange={setOnlyMoons} label="Has moons" />
          </Row>
          <Table
            columns={[{ key: "name", title: "Planet", sortable: true }, { key: "moons", title: "Moons", align: "end", sortable: true }, { key: "au", title: "Distance (AU)", align: "end", sortable: true }]}
            rows={rows}
            striped
            onRowPress={(row) => setOpen(row)}
          />
          <Grid columns={2} gap={12}>
            <Chart type="pie" data={rows} x="name" y="moons" height={120} />
            <Chart type="line" data={rows} x="name" y="au" height={140} />
          </Grid>
        </Column>
      ) : tab === "draw" ? (
        <Column gap={12}>
          <Slider value={zoom} min={0.2} max={1} step={0.05} onChange={setZoom} label="Brush" />
          <Canvas
            width={560}
            height={260}
            fit
            background="subtle"
            onPointer={(e) => setPoints((p) => (e.type === "down" ? [...p, [e.x, e.y]] : [...p.slice(0, -1), [...(p[p.length - 1] ?? []), e.x, e.y]]))}
            draw={(g) => {
              g.text("Drag to draw", 16, 28, { color: "muted", size: 13 });
              for (const line of points) g.polyline(line, { stroke: "accent", width: 2 + zoom * 10, cap: "round" });
              g.save().translate(480, 70).rotate(zoom * 3).rect(-30, -30, 60, 60, { fill: "warning", radius: 10, opacity: 0.85 }).restore();
            }}
          />
          <Button onPress={() => setPoints([])} icon="trash" variant="ghost">Clear</Button>
        </Column>
      ) : (
        <Column gap={12}>
          <Markdown>{"**Views** run on your device. They redraw in *milliseconds* when an agent edits them.\n\n- Native, no WebView\n- State survives edits"}</Markdown>
          <Code>{"const x = useStorage(\"x\", 0);"}</Code>
          <Disclosure title="From the network">
            <Text variant="body">{fetched}</Text>
          </Disclosure>
          <Pressable onPress={() => stella.clipboard.writeText(fetched)} padding={[6, 10]} radius="md" border>
            <Text variant="label">Copy that line</Text>
          </Pressable>
        </Column>
      )}
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.name}>
        <Text>{open ? `${open.name} is ${open.au} AU from the Sun and has ${open.moons} moons.` : ""}</Text>
        <Row justify="end"><Button variant="primary" onPress={() => setOpen(null)}>Done</Button></Row>
      </Modal>
    </Column>
  );
}
