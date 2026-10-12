# Effect ownership audit (M5 phases 1–4)

Status: the runtime ownership migration is **materially complete** as of
phase 4. Every seam that owns run- or worker-lifetime is Effect-owned;
what remains imperative is boundary or pure-transform code, each entry
retained deliberately with the reason recorded below. Do not migrate the
retained seams without new evidence — that would be architecture for
aesthetics.

## Effect-owned lifetime seams

| Seam                                              | Owner                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker RPC services + session graph               | `worker/server/` Layers; teardown order documented in `worker/server/sessions.ts`                                                                                          |
| Host worker lifecycle (lock/spawn/kill/readiness) | `host/lifecycle/` Scope + Schedule                                                                                                                                         |
| Boot readiness                                    | `shared/readiness-latch.ts` (Deferred; reset on stop)                                                                                                                      |
| toolHost shutdown                                 | idempotent memoized finalizer sequence; shell exits joined (3s bound) → repl kernels                                                                                       |
| Shell exit joins                                  | `kernel/tools/host.ts#killShell` — event-driven join on the shell's exit latch, 1.5s bound (was a 25ms poll)                                                               |

## Retained imperative seams (deliberate, with reasons)

- Claude Code stdio framing — protocol boundary code. Process
  lifetime is scope-joined via engine-turn resources + kill ladders;
  pendings settle exactly once; durable session ids/resume are covered by
  the integrations suites incl. the split-frame reassembly pin.
- One-shot utility spawns (`ripgrep`, `search`, `private-fs`,
  `deferred-delete-cli`, `schedule-scripts`) — per-call awaited children;
  `schedule-scripts` kills on abort/timeout. No persistent lifetime.
- CLI entrypoints (`stella-connect`, `stella-computer`, `native-helper`)
  and `connector-bridge` — sidecar-process boundary code owned by their
  own process lifetimes (`closeConnectorBridgeSessions` on the CLI side).
- Pure async transforms (prompt building, thread memory, image
  pipelines) and renderer/IPC facades — no lifetime ownership; stay
  imperative by design.
