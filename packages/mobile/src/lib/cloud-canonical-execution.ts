export type CanonicalExecutionStatus = {
  dispatchId: string;
  idempotencyKey: string;
  conversationId: string;
  cancelRequestId?: string;
};

export type CanonicalExecutionCancellationCommand = {
  dispatchId: string;
  cancelRequestId: string;
  reason: string;
};

export const cancelCanonicalCloudExecution = async <T>(args: {
  dispatchId: string;
  conversationId: string;
  readStatus: (dispatchId: string) => Promise<CanonicalExecutionStatus | null>;
  cancel: (command: CanonicalExecutionCancellationCommand) => Promise<T>;
}): Promise<T> => {
  const status = await args.readStatus(args.dispatchId);
  if (
    !status ||
    status.dispatchId !== args.dispatchId ||
    status.conversationId !== args.conversationId
  ) {
    throw new Error("Stella could not verify the running cloud turn.");
  }
  const inheritedCancelRequestId = status.cancelRequestId?.trim();
  const originalCancelRequestId = `cancel:${status.idempotencyKey}`;
  const cancelRequestId =
    inheritedCancelRequestId ||
    (originalCancelRequestId.length <= 128
      ? originalCancelRequestId
      : `cancel:${status.dispatchId}`);
  if (!cancelRequestId.trim() || cancelRequestId.length > 128) {
    throw new Error("Stella could not verify the cloud cancellation identity.");
  }
  return args.cancel({
    dispatchId: status.dispatchId,
    cancelRequestId,
    reason: "Stopped from the mobile conversation.",
  });
};
