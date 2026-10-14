import { useEffect, useMemo } from "react";
import { useDesktopAuthSession } from "@/global/auth/services/auth-session";
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

type ServerSelection = {
  execution: CloudExecutionSelection;
  selectedAt: number | null | undefined;
};

const createSelectionController = () => {
  let reconciled: CloudExecutionSelection | null = null;
  let accountProviders: ReadonlySet<string> = new Set();
  let lastServer: ServerSelection | null = null;
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const enqueue = (step: () => Promise<void>) => {
    queue = queue
      .then(() => (disposed ? undefined : step()))
      .catch(() => undefined);
  };

  const derive = (local: MirroredModelPreferences) =>
    cloudExecutionFromLocal(local, accountProviders);

  const pushLocal = async (local: MirroredModelPreferences) => {
    const derived = derive(local);
    if (!derived || disposed) return;
    if (reconciled && sameCloudExecution(derived, reconciled)) return;
    reconciled = derived;
    publishCloudExecutionSelection(derived);
    await cloudEnginesApi.setExecution(derived);
  };

  const applyServer = async ({ execution, selectedAt }: ServerSelection) => {
    const local = await readLocal();
    if (!local || disposed) return;
    if (selectedAt === null) {
      await pushLocal(local);
      return;
    }
    const current = derive(local);
    const patch = localPatchForCloudExecution(local, execution);
    const target = derive({ ...local, ...patch });
    if (current && target && sameCloudExecution(current, target)) {
      reconciled = current;
      return;
    }
    await window.electronAPI?.system?.setLocalModelPreferences?.(patch);
    const applied = await readLocal();
    reconciled = (applied && derive(applied)) ?? target;
    window.dispatchEvent(new CustomEvent(LOCAL_PREFERENCES_CHANGED_EVENT));
  };

  return {
    setAccountProviders(next: ReadonlySet<string>) {
      accountProviders = next;
    },
    serverSelection(next: ServerSelection) {
      if (
        lastServer &&
        lastServer.selectedAt === next.selectedAt &&
        sameCloudExecution(lastServer.execution, next.execution)
      ) {
        return;
      }
      lastServer = next;
      enqueue(() => applyServer(next));
    },
    localChanged() {
      enqueue(async () => {
        const local = await readLocal();
        if (local) await pushLocal(local);
      });
    },
    dispose() {
      disposed = true;
    },
  };
};

export function CloudModelSelectionBridge() {
  const session = useDesktopAuthSession();
  const accountId =
    (session.data as { user?: { id?: string } } | null | undefined)?.user?.id?.trim() ||
    null;
  const hasLocalRuntime = Boolean(
    window.electronAPI?.system?.setLocalModelPreferences,
  );
  const enabled = accountId !== null && hasLocalRuntime;
  const connections = useCloudEngines(enabled);
  const providers = useAccountProviders(enabled);

  const controller = useMemo(
    () => (accountId ? createSelectionController() : null),
    [accountId],
  );
  useEffect(() => () => controller?.dispose(), [controller]);

  const providerList = providers?.providers;
  const connectedProviders = useMemo(
    () =>
      new Set(
        (providerList ?? [])
          .filter((provider) => provider.connection?.status === "ok")
          .map((provider) => provider.id),
      ),
    [providerList],
  );
  useEffect(() => {
    controller?.setAccountProviders(connectedProviders);
  }, [controller, connectedProviders]);

  const execution = connections?.selection ?? connections?.execution;
  const selectedAt = connections?.selectedAt;
  const loaded = connections !== undefined;

  useEffect(() => {
    if (!controller || !loaded || !execution) return;
    controller.serverSelection({ execution, selectedAt });
  }, [controller, loaded, execution, selectedAt]);

  useEffect(() => {
    if (!controller || !loaded) return;
    const onLocalChange = () => controller.localChanged();
    window.addEventListener(LOCAL_PREFERENCES_CHANGED_EVENT, onLocalChange);
    return () =>
      window.removeEventListener(LOCAL_PREFERENCES_CHANGED_EVENT, onLocalChange);
  }, [controller, loaded]);

  return null;
}
