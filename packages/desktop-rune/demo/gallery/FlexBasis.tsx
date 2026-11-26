const LABELS = ["Low", "Medium", "High", "XHigh", "Max"];

export function Root() {
  return (
    <window id="main" title="flex basis" bg="#ffffff" w={400} h={200}>
      <col pad={20} gap={12}>
        {(["zero", "auto"] as const).map((b) => (
          <row key={b} id={`row-${b}`} w={238} gap={2} pad={2} fill="#eeeeee">
            {LABELS.map((l) => (
              <box key={l} id={`${b}-${l}`} grow={1} basis={b === "auto" ? "auto" : undefined} center py={4} fill="#ffffff">
                <text size={12} color="#000000">{l}</text>
              </box>
            ))}
          </row>
        ))}
      </col>
    </window>
  );
}
