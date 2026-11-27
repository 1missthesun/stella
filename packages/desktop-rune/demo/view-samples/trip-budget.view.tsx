import { useState, useMemo, Column, Row, Text, Button, TextField, Segmented, Chart, List, Progress, Switch, Pressable, Icon, Divider, Canvas, useFrame, useStorage } from "@stella/view";

type Expense = { id: string; what: string; amount: number; kind: string };

const KINDS = ["Stay", "Food", "Travel", "Fun"];
const START: Expense[] = [
  { id: "1", what: "Hotel in Lisbon", amount: 420, kind: "Stay" },
  { id: "2", what: "Train to Porto", amount: 38, kind: "Travel" },
  { id: "3", what: "Pastéis de nata", amount: 12, kind: "Food" },
  { id: "4", what: "Fado night", amount: 55, kind: "Fun" },
];

function Spinner() {
  const [angle, setAngle] = useState(0);
  useFrame((dt) => setAngle((a) => a + dt * 0.004));
  return (
    <Canvas width={28} height={28} draw={(g) => {
      g.circle(14, 14, 11, { stroke: "border", width: 3 });
      g.save().translate(14, 14).rotate(angle).path("M0 -11 A11 11 0 0 1 11 0", { stroke: "accent", width: 3, cap: "round" }).restore();
    }} />
  );
}

export default function TripBudget() {
  const [expenses, setExpenses] = useStorage<Expense[]>("expenses", START);
  const [budget] = useState(800);
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("Food");
  const [byKind, setByKind] = useState(true);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const perKind = useMemo(() => KINDS.map((k) => ({ kind: k, spent: expenses.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0) })), [expenses]);
  const add = () => {
    const value = Number(amount);
    if (!what.trim() || !(value > 0)) return;
    setExpenses([{ id: String(Date.now()), what: what.trim(), amount: value, kind }, ...expenses]);
    setWhat("");
    setAmount("");
  };

  return (
    <Column gap={20} maxWidth={560}>
      <Row gap={10}>
        <Column gap={2} grow={1}>
          <Text variant="caption">Portugal · 6 days</Text>
          <Text variant="title">${total.toLocaleString()} of ${budget}</Text>
        </Column>
        <Spinner />
      </Row>
      <Progress value={total / budget} color={total > budget ? "danger" : "accent"} />

      <Column gap={10}>
        <Row gap={8}>
          <TextField value={what} onChange={setWhat} onSubmit={add} placeholder="What for" grow={1} />
          <TextField value={amount} onChange={setAmount} onSubmit={add} placeholder="$" width={84} />
        </Row>
        <Row gap={8}>
          <Segmented value={kind} options={KINDS} onChange={setKind} />
          <Button variant="primary" icon="plus" onPress={add}>Add</Button>
        </Row>
      </Column>

      <Divider />
      <Row>
        <Text variant="heading" grow={1}>Spending</Text>
        <Switch checked={byKind} onChange={setByKind} label="By kind" />
      </Row>
      {byKind
        ? <Chart type="bar" data={perKind} x="kind" y="spent" height={180} format="currency" />
        : <Chart type="pie" data={perKind} x="kind" y="spent" height={160} />}

      <List
        items={expenses}
        itemKey={(e) => e.id}
        dividers
        renderItem={(e) => (
          <Row gap={10} padding={[8, 0]}>
            <Icon name={e.kind === "Stay" ? "house" : e.kind === "Travel" ? "globe" : e.kind === "Food" ? "star" : "sparkles"} color="muted" />
            <Text grow={1}>{e.what}</Text>
            <Text weight={600}>${e.amount}</Text>
            <Pressable onPress={() => setExpenses(expenses.filter((x) => x.id !== e.id))} padding={4} radius="sm" tooltip="Remove">
              <Icon name="x" size={14} color="muted" />
            </Pressable>
          </Row>
        )}
      />
    </Column>
  );
}
