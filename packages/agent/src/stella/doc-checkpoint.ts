import type { CheckpointInfo } from "@earendil-works/pi-durable";

/**
 * When a Stella document stores a complete value instead of a delta. A
 * document that never does keeps an unbounded chain of deltas that every open
 * replays, and pi can reclaim the older records of a latest-history document
 * only once a newer complete value is stored. Thirty-one deltas between
 * complete values is pi's own bound for documents like these.
 */
export const boundedReplay = (_value: unknown, _ops: unknown, info: CheckpointInfo): boolean =>
  info.deltasSinceBase >= 31;
