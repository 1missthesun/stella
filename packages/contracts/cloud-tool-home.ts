export const CLOUD_TOOL_HOME = "/workspace/.stella-tool-home";

export const toolStateEnvironment = (root: string): Record<string, string> => ({
  XDG_CONFIG_HOME: `${root}/.config`,
  XDG_CACHE_HOME: `${root}/.cache`,
  XDG_STATE_HOME: `${root}/.local/state`,
  XDG_DATA_HOME: `${root}/.local/share`,
  npm_config_cache: `${root}/.npm`,
  BUN_INSTALL_CACHE_DIR: `${root}/.bun/install/cache`,
  PLAYWRIGHT_BROWSERS_PATH: `${root}/.cache/ms-playwright`,
  PUPPETEER_CACHE_DIR: `${root}/.cache/puppeteer`,
});

export const WORLD_UNSYNCED_PATHS: readonly string[] = [
  ".cache",
  ".npm",
  ".bun",
  ".local/share/pnpm",
  ".stella/skills",
];

export const isWorldUnsyncedPath = (relative: string): boolean =>
  WORLD_UNSYNCED_PATHS.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  );
