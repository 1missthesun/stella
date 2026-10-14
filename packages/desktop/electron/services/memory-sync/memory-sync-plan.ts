export type SyncedPair = { local: string; cloud: string };

export type SyncBase = Readonly<Record<string, SyncedPair>>;

export type MemorySyncAction =
  | { kind: "push"; path: string; localSha: string; expectCloud: string | null }
  | { kind: "pull"; path: string; expectLocal: string | null }
  | { kind: "deleteCloud"; path: string; expectCloud: string }
  | { kind: "deleteLocal"; path: string; expectLocal: string }
  | { kind: "record"; path: string; pair: SyncedPair }
  | { kind: "forget"; path: string }
  | { kind: "conflict"; path: string; localSha: string };

export const planMemorySync = (
  base: SyncBase,
  local: ReadonlyMap<string, string>,
  cloud: ReadonlyMap<string, string>,
): MemorySyncAction[] => {
  const paths = new Set([...Object.keys(base), ...local.keys(), ...cloud.keys()]);
  const actions: MemorySyncAction[] = [];
  for (const path of [...paths].sort()) {
    const was = base[path];
    const here = local.get(path) ?? null;
    const there = cloud.get(path) ?? null;
    const changedHere = here !== (was?.local ?? null);
    const changedThere = there !== (was?.cloud ?? null);
    if (!changedHere && !changedThere) continue;
    if (changedHere && !changedThere) {
      actions.push(
        here === null
          ? { kind: "deleteCloud", path, expectCloud: was!.cloud }
          : { kind: "push", path, localSha: here, expectCloud: there },
      );
      continue;
    }
    if (!changedHere) {
      actions.push(
        there === null
          ? { kind: "deleteLocal", path, expectLocal: was!.local }
          : { kind: "pull", path, expectLocal: here },
      );
      continue;
    }
    if (here === null && there === null) {
      actions.push({ kind: "forget", path });
    } else if (here === null) {
      actions.push({ kind: "pull", path, expectLocal: null });
    } else if (there === null) {
      actions.push({ kind: "push", path, localSha: here, expectCloud: null });
    } else if (here === there) {
      actions.push({ kind: "record", path, pair: { local: here, cloud: there } });
    } else {
      actions.push({ kind: "conflict", path, localSha: here });
    }
  }
  return actions;
};
