export type ExecutionPlacementEligibilityInput = {
  started: boolean;
  hostReady: boolean;
  deviceIdentity:
    | { deviceId?: string | null; publicKey?: string | null }
    | null
    | undefined;
  hasDatabase: boolean;
  hasConnectedAccount: boolean | undefined;
  cloudSyncEnabled: boolean | undefined;
  authToken: string | null;
  backendUrl: string | null;
  canSignDeviceInput: boolean;
};

export const isExecutionPlacementEligible = (
  input: ExecutionPlacementEligibilityInput,
): boolean =>
  Boolean(
    input.started &&
      input.hostReady &&
      input.deviceIdentity?.deviceId &&
      input.deviceIdentity?.publicKey &&
      input.canSignDeviceInput &&
      input.hasDatabase &&
      input.hasConnectedAccount &&
      input.cloudSyncEnabled &&
      input.authToken &&
      input.backendUrl,
  );
