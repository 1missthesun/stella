import { loadFonts } from "../../ui/theme/fonts";

const LINES: [string, string][] = [
  ["ar", "الإعدادات الحساب والخصوصية"],
  ["he", "הגדרות חשבון ופרטיות"],
  ["keys", "⌘↵ →"],
];

export function Root() {
  loadFonts();
  return (
    <window id="main" title="script fallback" bg="#ffffff" w={500} h={240}>
      <col pad={10} gap={10} align="start">
        {LINES.map(([id, t]) => (
          <text key={id} id={id} family="Manrope" size={14} color="#000000" nowrap>
            {t}
          </text>
        ))}
      </col>
    </window>
  );
}
