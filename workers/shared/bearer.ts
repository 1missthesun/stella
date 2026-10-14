export const MAX_BEARER_CREDENTIAL_LENGTH = 8_192;

export const bearerCredential = (
  authorization: string | null | undefined,
  maxLength = MAX_BEARER_CREDENTIAL_LENGTH,
): string | null => {
  if (!authorization || authorization.length > maxLength + 64) return null;
  const credential = /^\s*Bearer\s+(\S+)\s*$/iu.exec(authorization)?.[1];
  return credential && credential.length <= maxLength ? credential : null;
};
