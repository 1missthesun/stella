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
