import { readFileSync } from "node:fs";
import path from "node:path";

const BOOT = "packages/desktop-ui/public/stella-boot.js";
const THEME = "packages/desktop-ui/src/context/theme-context.tsx";
const DEVICE_PERF = "packages/desktop-ui/src/shared/lib/device-perf.ts";

const lowPowerRules = (source) => ({
  cores: source.match(/cores > 0 && cores <= (\d+)/)?.[1] ?? null,
  memory: source.match(/\((?:mem|memory) > 0 && (?:mem|memory) <= (\d+)\)/)?.[1] ?? null,
  windowsMemory: source.match(/isWindows && (?:mem|memory) > 0 && (?:mem|memory) <= (\d+)/)?.[1] ?? null,
  windowsTest: source.includes("/^Win/i.test(platform) || /\\bWindows\\b/i.test(userAgent)"),
  forcedFlag: source.includes('get("lowPower") === "1"'),
});

export async function check(root) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const boot = read(BOOT);
  const theme = read(THEME);
  const problems = [];

  const bootRules = lowPowerRules(boot);
  const tsRules = lowPowerRules(read(DEVICE_PERF));
  for (const key of Object.keys(bootRules)) {
    if (bootRules[key] === null || bootRules[key] === false || bootRules[key] !== tsRules[key]) {
      problems.push(`${BOOT} low-power rule "${key}" (${bootRules[key]}) must match isLowPowerDevice() in ${DEVICE_PERF} (${tsRules[key]})`);
    }
  }

  for (const constant of ["THEME_STORAGE_KEY", "COLOR_MODE_STORAGE_KEY"]) {
    const key = theme.match(new RegExp(`const ${constant} = "([^"]+)"`))?.[1];
    if (!key) problems.push(`${THEME} no longer declares ${constant}`);
    else if (!boot.includes(`readStorage("${key}")`)) problems.push(`${BOOT} must read "${key}" (${constant} in ${THEME})`);
  }

  const themeDefault =
    theme.includes('if (!window.electronAPI) return "dark";') &&
    theme.includes('uiState.getItem("stella-onboarding-complete") === "true" ? "dark" : "system"');
  const bootDefault = /window\.electronAPI && readStorage\("stella-onboarding-complete"\) !== "true"\s*\?\s*"system"\s*:\s*"dark"/.test(boot);
  if (!themeDefault || !bootDefault) {
    problems.push(`the default color mode (system on a new desktop install, dark otherwise) must read the same in ${THEME} defaultColorMode() and ${BOOT}`);
  }
  return problems;
}
