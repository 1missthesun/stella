import { useCallback, useEffect, useMemo, useRef } from "react";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import {
  getModelRestrictionActionLabel,
  getModelRestrictionDescription,
  isRestrictedModelOverrideAudience,
  type ManagedModelAudience,
} from "@/global/billing/audience";
import { useCapabilityAccess } from "@/global/billing/use-capability-access";
import { useModelCatalog } from "@/global/settings/hooks/use-model-catalog";
import { BYOK_TOAST_ACTION } from "@/global/billing/byok-action";
import {
  resolveTierRestrictedModelNotice,
  type NoticeRuntimeEngine,
} from "./tier-restricted-model-notice";
import { notify } from "@/features/notifications/notification-store";
import { translateNow } from "@/shared/i18n/active-translator";

type LocalModelPreferences = {
  modelOverrides?: Record<string, string>;
  agentRuntimeEngine?: NoticeRuntimeEngine;
};

const buildToastDedupeKey = (
  audience: ManagedModelAudience,
  agent: string,
  model: string,
): string => `${audience}|${agent}|${model}`;

export function useTierRestrictedModelToast() {
  const { audience } = useCapabilityAccess();
  const audienceRef = useRef<ManagedModelAudience | null>(audience);
  audienceRef.current = audience;

  const { models } = useModelCatalog();
  const allowedStellaModelIds = useMemo(() => {
    const stellaRows = models.filter((model) => model.provider === "stella");
    if (stellaRows.length === 0) return null;
    return new Set(
      stellaRows
        .filter((model) => model.allowedForAudience !== false)
        .map((model) => model.id),
    );
  }, [models]);
  const allowedRef = useRef(allowedStellaModelIds);
  allowedRef.current = allowedStellaModelIds;

  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    seenRef.current = new Set();
  }, [audience]);

  return useCallback(async () => {
    const audience = audienceRef.current;
    if (!isRestrictedModelOverrideAudience(audience) || !audience) return;

    let preferences: LocalModelPreferences | null | undefined;
    try {
      preferences =
        await window.electronAPI?.system?.getLocalModelPreferences?.();
    } catch {
      return;
    }
    const notice = resolveTierRestrictedModelNotice({
      audience,
      agentRuntimeEngine: preferences?.agentRuntimeEngine,
      modelOverrides: preferences?.modelOverrides,
      allowedStellaModelIds: allowedRef.current,
    });
    if (!notice) return;

    const dedupeKey = buildToastDedupeKey(audience, notice.agent, notice.model);
    if (seenRef.current.has(dedupeKey)) return;
    seenRef.current.add(dedupeKey);

    notify({
      id: `model-not-on-plan:${dedupeKey}`,
      kind: "plan",
      title: translateNow("shell.notifications.modelNotOnPlan"),
      detail: getModelRestrictionDescription({
        audience,
        modelLabel: notice.modelLabel,
        tense: "is",
      }),
      actions: [
        { label: BYOK_TOAST_ACTION.label, run: BYOK_TOAST_ACTION.onClick },
        {
          label: getModelRestrictionActionLabel(audience),
          primary: true,
          run: () => planUsageDialog.openPlans(),
        },
      ],
    });
  }, []);
}
