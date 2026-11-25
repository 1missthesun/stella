import type { Tokens } from "./theme";
import { chats } from "./data";

const W = 264;

function Item({ id, label, active, t, onPress }: { id: string; label: string; active?: boolean; t: Tokens; onPress: () => void }) {
  return (
    <box id={id} w="full" px={10} py={7} radius={8} fill={active ? t.select : undefined} hover={active ? undefined : t.hover} press={t.press} onPress={onPress}>
      <text size={13.5} color={active ? t.textStrong : t.text} weight={active ? 560 : 450} truncate>{label}</text>
    </box>
  );
}

function Section({ title, t }: { title: string; t: Tokens }) {
  return <text size={12} weight={560} color={t.textWeaker} px={10} pt={14} pb={4}>{title}</text>;
}

export function Sidebar({ open, t }: { open: boolean; t: Tokens }) {
  const active = stella.useStore((s) => s.activeChat);
  const pick = (c: string) => () => stella.store.set({ activeChat: c });
  return (
    <col id="sidebar" w={open ? W : 0} h="full" clip={0} layout={0.32} fill={t.bgWeak}>
      <col id="sidebar-inner" w={W} h="full" px={10} pt={6} pb={12} gap={1}>
        <box id="new-chat" w="full" px={10} py={8} radius={8} hover={t.hover} press={t.press} onPress={() => stella.store.set({ activeChat: "New chat" })}>
          <text size={13.5} weight={560} color={t.textStrong}>New chat</text>
        </box>
        {/* live-edit-slot */}
        <Section title="Today" t={t} />
        {chats.today.map((c, i) => <Item key={c} id={`chat-t${i}`} label={c} active={c === active} t={t} onPress={pick(c)} />)}
        <Section title="Earlier" t={t} />
        {chats.earlier.map((c, i) => <Item key={c} id={`chat-e${i}`} label={c} active={c === active} t={t} onPress={pick(c)} />)}
        <box grow={1} />
        <row id="account" w="full" px={10} py={8} gap={10} align="center" radius={8} hover={t.hover}>
          <box w={26} h={26} radius={13} fill={t.bubble} center>
            <text size={12} weight={600} color={t.bubbleText}>S</text>
          </box>
          <text size={13.5} color={t.text}>Stella</text>
        </row>
      </col>
    </col>
  );
}
