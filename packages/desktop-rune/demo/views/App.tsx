// Opens one Stella View in a window, as the display panel does: STELLA_VIEW_FILE=<path.view.tsx>
// (default: ../view-samples/trip-budget.view.tsx) and STELLA_VIEW_THEME=light|dark.
import { join } from "node:path";
import { I18nProvider } from "../../ui/i18n";
import { ThemeBackdrop, ThemeScope } from "../../ui/theme";
import { ViewTabContent } from "../../ui/views/ViewTabContent";

const FILE = process.env.STELLA_VIEW_FILE ?? join(import.meta.dir, "../view-samples/trip-budget.view.tsx");
const MODE = process.env.STELLA_VIEW_THEME === "dark" ? "dark" : "light";

export function App() {
  return (
    <I18nProvider>
      <ThemeScope themeId="custom" mode={MODE} customBase="default">
        <col id="views-demo" w="full" h="full">
          <ThemeBackdrop id="views-demo-backdrop" />
          <ViewTabContent filePath={FILE} />
        </col>
      </ThemeScope>
    </I18nProvider>
  );
}
