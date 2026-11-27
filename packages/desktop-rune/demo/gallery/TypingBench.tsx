import { useState } from "react";
import { StellaCharacter } from "../../ui/kit/StellaCharacter";
const MARK = process.env.TYP_MARK === "1";
const WEB = process.env.TYP_WEB === "1";
export function Root() {
  const [v, setV] = useState("");
  return (
    <window id="main" title="typ" bg="#ffffff" w={700} h={300}>
      <col pad={20} gap={16}>
        <row gap={12} align="center">
          {MARK ? <StellaCharacter size={22} /> : <box w={22} h={22} />}
          <text size={13} color="#000000">{v.length} chars</text>
        </row>
        {WEB ? <webview url="data:text/html,<p>map</p>" w={200} h={80} /> : null}
        <input id="composer" value={v} onInput={setV} w={600} h={40} size={15} color="#000000" fill="#f2f2f2" />
      </col>
    </window>
  );
}
