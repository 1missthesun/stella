export const ACCOUNT_REGISTRY_PREFIX = "account-key:";

export const accountRegistryId = (providerId: string): string => `${ACCOUNT_REGISTRY_PREFIX}${providerId}`;

export const accountProviderOfRegistryId = (registryId: string): string | undefined =>
  registryId.startsWith(ACCOUNT_REGISTRY_PREFIX) ? registryId.slice(ACCOUNT_REGISTRY_PREFIX.length) : undefined;
