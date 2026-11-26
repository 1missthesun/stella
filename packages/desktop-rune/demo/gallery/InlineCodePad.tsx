import { Markdown } from "../../ui/chat/Markdown";
import { ThemeScope } from "../../ui/theme/ThemeProvider";

const SRC = "I’ll have it saved as `haiku.md` in your Drive and let you know when it’s done.";

const SOURCES = [
  SRC,
  "`x`",
  "a\u202f\u202fb",
  "100\u202f%",
];

export function Root() {
  return (
    <window id="main" title="inline code padding" bg="#1c1c1e" w={820} h={900}>
      <ThemeScope themeId="default" mode="dark">
      <col id="page" w={752} gap={4}>
        {SOURCES.map((src, w) => (
          <row key={w} w="full" minW={0} align="start" gap={4}>
            <col id={`b${w}`} w={500} minW={0} fill="#2c2c2e">
              <Markdown text={src} cacheKey={`probe${w}`} />
            </col>
          </row>
        ))}
      </col>
      </ThemeScope>
    </window>
  );
}
