export type AuthSessionScopeData =
  | {
      user?: {
        id?: string | null;
        isAnonymous?: boolean | null;
      } | null;
      session?: {
        id?: string | null;
      } | null;
    }
  | null
  | undefined;

export const resolveAuthSessionCacheScope = (
  sessionData: AuthSessionScopeData,
): string => {
  if (!sessionData) return "signed-out";
  const userId = sessionData.user?.id?.trim();
  const fallbackSessionId = sessionData.session?.id?.trim() || "unknown";
  return sessionData.user?.isAnonymous === true
    ? `anonymous:${userId || fallbackSessionId}`
    : `account:${userId || fallbackSessionId}`;
};

export const advanceAuthIdentityRevision = (args: {
  currentScope: string;
  currentRevision: number;
  nextSessionData: AuthSessionScopeData;
}): { scope: string; revision: number } => {
  const scope = resolveAuthSessionCacheScope(args.nextSessionData);
  return {
    scope,
    revision:
      scope === args.currentScope
        ? args.currentRevision
        : args.currentRevision + 1,
  };
};
