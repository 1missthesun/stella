import { useEffect } from "react";
import type { AppState, Message, Store } from "../host/store";
import { initialMessages } from "./data";
import { Markdown } from "./markdown";
import { Sidebar } from "./Sidebar";
import { tokens, type Tokens } from "./theme";

export function initialState(): AppState {
  return {
    dark: process.env.STELLA_RUNE_THEME !== "light",
    sidebarOpen: true,
    messages: initialMessages(),
    draft: "",
    activeChat: "Morning plan",
    error: null,
    swaps: 0,
    lastSwapMs: null,
    preview: null,
  };
}

/** Window-level shortcuts the engine forwards (Ctrl/Cmd + key). */
export function onKey(key: string, store: Store) {
  if (key === "mod+b") store.set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  if (key === "mod+j") store.set((s) => ({ dark: !s.dark }));
}

function TopBar({ t }: { t: Tokens }) {
  const open = stella.useStore((s) => s.sidebarOpen);
  const dark = stella.useStore((s) => s.dark);
  const chat = stella.useStore((s) => s.activeChat);
  const swap = stella.useStore((s) => s.lastSwapMs);
  return (
    <row id="topbar" w="full" h={46} px={10} gap={6} align="center" fill={t.bg}>
      <box id="toggle-sidebar" w={32} h={30} radius={8} center hover={t.hover} press={t.press} label="Toggle sidebar" onPress={() => stella.store.set({ sidebarOpen: !open })}>
        <row gap={3} h={14}>
          <box w={4} h={14} radius={1.5} fill={t.textWeak} />
          <box w={10} h={14} radius={1.5} border={t.textWeak} borderWidth={1.5} />
        </row>
      </box>
      <text size={14} weight={620} color={t.textStrong} pl={4}>Stella</text>
      <text size={13.5} color={t.textWeaker} pl={8} truncate shrink>{chat}</text>
      <box grow={1} />
      <box id="open-preview" px={10} h={30} radius={8} center hover={t.hover} press={t.press} onPress={() => stella.store.set((s) => ({ preview: s.preview ? null : "file://" + new URL("./assets/lisbon-plan.html", APP_URL).pathname }))}>
        <text size={12.5} weight={520} color={t.text}>Lisbon plan</text>
      </box>
      <text id="live" size={12} color={t.textWeaker} pr={6}>{swap == null ? "TypeScript UI on Rune" : `Live edit applied in ${swap} ms`}</text>
      <box id="theme" px={10} h={30} radius={8} center hover={t.hover} press={t.press} onPress={() => stella.store.set({ dark: !dark })}>
        <text size={12.5} weight={520} color={t.text}>{dark ? "Light" : "Dark"}</text>
      </box>
    </row>
  );
}

// The bundle runs from ui/.hot/, so resolve assets against the source folder.
const APP_URL = "file://" + (process.env.STELLA_RUNE_ROOT ?? "") + "/ui/app/";

function Preview({ t }: { t: Tokens }) {
  const url = stella.useStore((s) => s.preview);
  if (!url) return null;
  return (
    <col id="preview" w={460} h="full" fill={t.bgWeak} enter="fade">
      <row w="full" h={40} px={14} align="center" justify="between">
        <text size={13} weight={600} color={t.textStrong}>Lisbon plan.html</text>
        <box id="close-preview" px={8} h={26} radius={6} center hover={t.hover} press={t.press} onPress={() => stella.store.set({ preview: null })}>
          <text size={12.5} color={t.textWeak}>Close</text>
        </box>
      </row>
      <box id="preview-slot" w="full" grow={1} minH={0} webview={url} fill={t.raised} />
    </col>
  );
}

function Bubble({ m, t }: { m: Message; t: Tokens }) {
  if (m.role === "user") {
    return (
      <row id={`msg-${m.id}`} w="full" justify="end" enter="rise">
        <box maxW={520} px={14} py={9} radius={18} fill={t.bubble}>
          <text size={14.5} lineHeight={21} color={t.bubbleText} selectable>{m.text}</text>
        </box>
      </row>
    );
  }
  return (
    <col id={`msg-${m.id}`} w="full" gap={6} enter="fade" selectionGroup>
      <Markdown id={m.id} src={m.text} t={t} />
    </col>
  );
}

function Chat({ t }: { t: Tokens }) {
  const messages = stella.useStore((s) => s.messages);
  return (
    <col id="chat-scroll" w="full" grow={1} minH={0} scrollY stickBottom edgeFade={24} align="center">
      <col id="chat-col" w="full" maxW={760} px={28} pt={28} pb={20} gap={22}>
        {messages.map((m) => <Bubble key={m.id} m={m} t={t} />)}
      </col>
    </col>
  );
}

const replies = [
  "On it. I checked your calendar and **nothing clashes**, so I went ahead and added it.",
  "Here's what I found:\n\n- The build is green\n- `main` is 3 commits ahead of production\n- Nothing blocks a deploy",
  "Done. I kept the originals and left a note of what changed next to them.",
];

function send(text: string) {
  const s = stella.store;
  const id = `n${Date.now()}`;
  const at = new Date().toTimeString().slice(0, 5);
  s.set((st) => ({ draft: "", messages: [...st.messages, { id: `${id}u`, role: "user", text, at }] }));
  const full = replies[s.get().messages.length % replies.length];
  const words = full.split(/(\s+)/);
  let n = 0;
  setTimeout(() => {
    s.set((st) => ({ messages: [...st.messages, { id: `${id}a`, role: "assistant", text: "", at }] }));
    const timer = setInterval(() => {
      n += 2;
      const text = words.slice(0, n).join("");
      s.set((st) => ({ messages: st.messages.map((m) => (m.id === `${id}a` ? { ...m, text } : m)) }));
      if (n >= words.length) clearInterval(timer);
    }, 28);
  }, 260);
}

function Composer({ t }: { t: Tokens }) {
  const hasDraft = stella.useStore((s) => s.draft.trim().length > 0);
  return (
    <col w="full" px={28} pb={18} pt={6} align="center">
      <col id="composer-box" w="full" maxW={760} fill={t.raised} border={t.border} radius={20} pl={16} pr={10} pt={12} pb={10} gap={8} shadow={[8, 24, "#0000001f"]}>
        <input
          id="composer"
          w="full"
          minH={22}
          size={14.5}
          lineHeight={22}
          color={t.textStrong}
          placeholder="Ask Stella anything"
          placeholderColor={t.textWeaker}
          autoFocus
          onInput={(v) => { if ((v.trim().length > 0) !== hasDraft) stella.store.set({ draft: v }); }}
          onSubmit={(v) => { if (v.trim()) send(v.trim()); }}
        />
        <row w="full" align="center" justify="between">
          <row gap={4}>
            <box id="attach" px={8} h={28} radius={8} center hover={t.hover} press={t.press} onPress={() => {}}>
              <text size={12.5} color={t.textWeak}>Attach</text>
            </box>
            <box id="model" px={8} h={28} radius={8} center hover={t.hover} press={t.press} onPress={() => {}}>
              <text size={12.5} color={t.textWeak}>Opus 5.5</text>
            </box>
          </row>
          <box id="send" w={30} h={30} radius={15} center fill={hasDraft ? t.primary : t.inset} label="Send">
            <text size={15} weight={700} color={hasDraft ? "#ffffff" : t.textWeaker}>↑</text>
          </box>
        </row>
      </col>
    </col>
  );
}

function ErrorBar({ t }: { t: Tokens }) {
  const err = stella.useStore((s) => s.error);
  if (!err) return null;
  return (
    <row id="error" w="full" px={16} py={8} fill={t.inset} enter="fade">
      <text size={12.5} color={t.text} mono maxLines={3}>{`Live edit failed, still running the last good UI: ${err}`}</text>
    </row>
  );
}

export function App() {
  const dark = stella.useStore((s) => s.dark);
  const open = stella.useStore((s) => s.sidebarOpen);
  const t = tokens(dark);
  useEffect(() => { stella.command({ cmd: "bg", color: t.bg }); }, [dark]);
  return (
    <col id="app" w="full" h="full" fill={t.bg}>
      <TopBar t={t} />
      <box w="full" h={1} fill={t.borderWeak} />
      <ErrorBar t={t} />
      <row id="body" w="full" grow={1} minH={0}>
        <Sidebar open={open} t={t} />
        <col id="main" grow={1} shrink h="full" minH={0} fill={t.bg}>
          <Chat t={t} />
          <Composer t={t} />
        </col>
        <Preview t={t} />
      </row>
    </col>
  );
}
