import { useEffect, useRef } from "react";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  cloudEnginesApi,
  useAccountProviders,
  useCloudEngines,
} from "./cloud-engines-api";
import { publishCloudExecutionSelection } from "./cloud-execution-store";
import {
  cloudExecutionFromLocal,
  localPatchForCloudExecution,
  sameCloudExecution,
  type MirroredModelPreferences,
} from "./cloud-model-selection-mirror";

const LOCAL_PREFERENCES_CHANGED_EVENT = "stella:local-model-preferences-changed";

const readLocal = async (): Promise<MirroredModelPreferences | null> =>
  (await window.electronAPI?.system?.getLocalModelPreferences?.()) ?? null;

/**
 * Keeps the desktop's local model preferences in step with the account's
 * server selection, which phone and web pickers write. A server change is
 * applied locally; a local pick is saved to the server. Before the account has
 * ever saved one, the desktop's current choice seeds it.
 *
 * Only a real local change is saved: the bridge remembers the local selection
 * it last reconciled (`reconciledRef`, read back after every apply and set on
 * every save) and saves only when the local preferences have moved away from
 * it. Applying a server selection never saves, so a server that stores a
 * selection differently from how this computer stores it (an older server
 * keeping "default" effort, say) can never start a save loop.
 */
export function CloudModelSelectionBridge() {
  const { isAuthenticated } = useAuthState();
  const hasLocalRuntime = Boolean(
    window.electronAPI?.system?.setLocalModelPreferences,
  );
  const connections = useCloudEngines(isAuthenticated && hasLocalRuntime);
  const providers = useAccountProviders(isAuthenticated && hasLocalRuntime);
  const reconciledRef = useRef<CloudExecutionSelection | null>(null);
  const accountProvidersRef = useRef<ReadonlySet<string>>(new Set());
  accountProvidersRef.current = new Set(
    (providers?.providers ?? [])
      .filter((provider) => provider.connection?.status === "ok")
      .map((provider) => provider.id),
  );
  const queue = useRef<Promise<void>>(Promise.resolve());

  const execution = connections?.selection ?? connections?.execution;
  const selectedAt = connections?.selectedAt;
  const loaded = connections !== undefined;

  const enqueue = (step: () => Promise<void>) => {
    queue.current = queue.current.then(step).catch(() => undefined);
  };

  const derive = (local: MirroredModelPreferences) =>
    cloudExecutionFromLocal(local, accountProvidersRef.current);

  const pushLocal = async (local: MirroredModelPreferences) => {
    const derived = derive(local);
    if (!derived) return;
    const reconciled = reconciledRef.current;
    if (reconciled && sameCloudExecution(derived, reconciled)) return;
    reconciledRef.current = derived;
    publishCloudExecutionSelection(derived);
    await cloudEnginesApi.setExecution(derived);
  };

  useEffect(() => {
    if (!loaded || !execution) return;
    enqueue(async () => {
      const local = await readLocal();
      if (!local) return;
      if (selectedAt === null) {
        await pushLocal(local);
        return;
      }
      const current = derive(local);
      const patch = localPatchForCloudExecution(local, execution);
      const target = derive({ ...local, ...patch });
      if (current && target && sameCloudExecution(current, target)) {
        reconciledRef.current = current;
        return;
      }
      await window.electronAPI?.system?.setLocalModelPreferences?.(patch);
      const applied = await readLocal();
      reconciledRef.current = (applied && derive(applied)) ?? target;
      window.dispatchEvent(new CustomEvent(LOCAL_PREFERENCES_CHANGED_EVENT));
    });
    // The selection's identity is the trigger; helpers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loaded,
    selectedAt,
    execution?.engine,
    execution?.provider,
    execution?.model,
    execution?.reasoningEffort,
  ]);

  useEffect(() => {
    if (!loaded) return;
    const onLocalChange = () => {
      enqueue(async () => {
        const local = await readLocal();
        if (local) await pushLocal(local);
      });
    };
    window.addEventListener(LOCAL_PREFERENCES_CHANGED_EVENT, onLocalChange);
    return () =>
      window.removeEventListener(LOCAL_PREFERENCES_CHANGED_EVENT, onLocalChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return null;
}
