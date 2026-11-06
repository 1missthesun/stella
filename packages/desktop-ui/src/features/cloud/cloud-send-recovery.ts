export type CloudSendRecovery = {
  retry: (clientMsgId: string) => void;
  dismiss: (clientMsgId: string) => void;
};

let current: CloudSendRecovery | null = null;

export const provideCloudSendRecovery = (
  recovery: CloudSendRecovery,
): (() => void) => {
  current = recovery;
  return () => {
    if (current === recovery) current = null;
  };
};

export const cloudSendRecovery = (): CloudSendRecovery | null => current;
