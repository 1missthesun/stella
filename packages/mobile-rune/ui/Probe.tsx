// A first-light screen: text, a long scroll, a press and a native text field.
import { useState } from "react";

export function Probe() {
  const [n, setN] = useState(0);
  const [text, setText] = useState("");
  const rows = Array.from({ length: 80 }, (_, i) => i);
  return (
    <col w="full" h="full" pt={64} gap={12} fill="#101012">
      <col px={20} gap={6}>
        <text size={28} weight={700} color="#ffffff">Stella on Rune</text>
        <text size={15} color="#a0a0a8">{`Metal · JavaScriptCore · taps ${n} · typed “${text}”`}</text>
      </col>
      <row px={20} gap={10}>
        <box px={16} py={10} radius={20} fill="#2f6df6" press="#1f4fc0" onPress={() => setN((v) => v + 1)}>
          <text size={15} weight={600} color="#ffffff">Tap me</text>
        </box>
      </row>
      <col grow={1} scrollY>
        {rows.map((i) => (
          <row key={i} px={20} py={14} gap={12} borderSides={[0, 0, 1, 0]} border="#222226">
            <box w={36} h={36} radius={18} fill={i % 2 ? "#2a2a30" : "#3a2f5a"} />
            <col gap={2}>
              <text size={16} weight={500} color="#f2f2f5">{`Row ${i + 1}`}</text>
              <text size={13} color="#8a8a92">Scrolling is Rune’s own physics at display rate</text>
            </col>
          </row>
        ))}
      </col>
      <col px={16} pb={40} pt={8}>
        <input id="probe-input" multiline maxLines={6} value={text} onInput={(e: any) => setText(e.value)} placeholder="Message Stella" placeholderColor="#77777f" color="#ffffff" size={16} px={16} py={12} radius={22} fill="#1c1c20" border="#2c2c32" />
      </col>
    </col>
  );
}
