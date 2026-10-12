const SHA256_HEX = /^[0-9a-f]{64}$/;
const BUILD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const ownerAppBuildRoot = (ownerHash: string): string => {
  if (!SHA256_HEX.test(ownerHash)) {
    throw new Error("Invalid app-build owner hash.");
  }
  return `builds/${ownerHash}`;
};

export const isOwnerAppBuildPrefix = (
  prefix: string,
  ownerHash: string,
): boolean => {
  let root: string;
  try {
    root = ownerAppBuildRoot(ownerHash);
  } catch {
    return false;
  }
  return (
    prefix.startsWith(`${root}/`) &&
    BUILD_ID.test(prefix.slice(root.length + 1))
  );
};

/**
 * Recovery markers are retired only after the whole R2 prefix is confirmed
 * empty. Returning false leaves the marker intact for the next alarm/purge.
 */
export const retireTransientAppBuild = async (args: {
  sweep: () => Promise<{ done: boolean }>;
  clearRecovery: () => Promise<void>;
}): Promise<boolean> => {
  const swept = await args.sweep();
  if (!swept.done) return false;
  await args.clearRecovery();
  return true;
};
