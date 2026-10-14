declare const __STELLA_RELEASE__:
  | { version: string | null; releasedAt: string | null; commit: string | null }
  | undefined;

export type ServerRelease = { version: string | null; releasedAt: string | null; commit: string | null };

const read = (env: unknown, name: string): string | null => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const serverRelease = (env: unknown): ServerRelease => {
  const built = typeof __STELLA_RELEASE__ === "undefined" ? null : __STELLA_RELEASE__;
  return {
    version: read(env, "STELLA_SERVER_VERSION") ?? built?.version ?? null,
    releasedAt: read(env, "STELLA_SERVER_RELEASED_AT") ?? built?.releasedAt ?? null,
    commit: read(env, "STELLA_BUILD_COMMIT") ?? built?.commit ?? null,
  };
};
