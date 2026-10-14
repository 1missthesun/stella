export type MobileAuthSession = {
  user?: { id?: string | null } | null;
  session?: { id?: string | null } | null;
} | null;

export type CloudConversationIdentity = {
  accountScope: string;
  expectedSubject: string;
  identityKey: string;
  revision: number;
};

let observedIdentityKey: string | null = null;
let observedRevision = 0;

export const observeCloudConversationIdentity = (
  session: MobileAuthSession,
): CloudConversationIdentity | null => {
  const userId = session?.user?.id?.trim() ?? "";
  if (!userId) return null;
  const sessionId = session?.session?.id?.trim() || "unknown";
  const identityKey = `account:${userId}:session:${sessionId}`;
  if (identityKey !== observedIdentityKey) {
    observedIdentityKey = identityKey;
    observedRevision += 1;
  }
  return {
    accountScope: `account:${userId}`,
    expectedSubject: userId,
    identityKey,
    revision: observedRevision,
  };
};
