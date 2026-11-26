import { useState } from "react";

export function Root() {
  const [hit, setHit] = useState("none");
  return (
    <window id="main" title="layer order" bg="#ffffff" w={500} h={360}>
      <col id="page" grow={1} pad={20} gap={12}>
        <row gap={12} align="center">
          <box id="bell" w={40} h={40} radius={8} fill="#8e8e93" />
          <text id="hit">pressed: {hit}</text>
        </row>
        <col id="panel" anchor={{ to: "bell", side: "bottom", align: "start", gap: 8 }} raise={9999} onPress={() => setHit("popover")} w={260} h={200} radius={10} fill="#3478f6" pad={12}>
          <text color="#ffffff">popover raise 9999</text>
        </col>
        <col id="toast" anchor={{ to: "bell", side: "right", align: "start", gap: 300 }} raise={1000} w={120} h={60} radius={10} fill="#34c759" pad={8}>
          <text color="#ffffff">toast 1000</text>
        </col>
      </col>
      <box id="scrim" fixed inset={0} raise={50} fill="#00000066" />
      <col id="dialog" fixed inset={0} raise={51} align="center" justify="center">
        <col id="card" onPress={() => setHit("dialog")} w={300} h={180} radius={12} fill="#ff9500" pad={12}>
          <text>dialog raise 51</text>
          <text id="hit2">pressed: {hit}</text>
        </col>
      </col>
    </window>
  );
}
