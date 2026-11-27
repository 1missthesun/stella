// The Apps list's views: every Stella View the account has made, newest first, from the account's
// view index (owner-store `viewIndex.list`, live). Opening one runs it in the panel outside its chat.
import type { IndexedView } from "@stella/contracts/backend/view-index";
import { backendClient } from "@/platform/backend/backend-client";
import { contextMenu } from "@/platform/context-menu";
import { translateNow } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import { Icon, Icons } from "../kit";
import { Press, T, tx } from "../kit/compat";
import { useAppsSection } from "../global/shared/apps-section.styles";
import { useViewIcon } from "../views/ViewRenderer";
import { openIndexedView } from "./open-indexed-view";

const open = (view: IndexedView) => {
  openIndexedView(view).catch(() => showToast(translateNow("app.apps.viewOpenFailed")));
};

const remove = (view: IndexedView) => {
  backendClient.call("viewIndex.remove", { id: view.id }).catch(() => showToast(translateNow("app.apps.viewRemoveFailed")));
};

function ViewCard({ view }: { view: IndexedView }) {
  const s = useAppsSection();
  const icon = useViewIcon(view.icon) ?? Icons.stella.AppWindowMac;
  return (
    <row
      {...s.appsSectionCard}
      onContextMenu={contextMenu(() => [
        [
          { label: translateNow("contextMenu.open"), run: () => open(view) },
          { label: translateNow("app.apps.removeView"), run: () => remove(view) },
        ],
      ]) as unknown as (at: { x: number; y: number }) => void}
    >
      <Press id={`apps-view-${view.id.replace(/[^\w-]/gu, "_").slice(-60)}`} text={tx(s.appsSectionCard)} {...s.appsSectionCardOpen} title={view.conversationTitle ?? undefined} onPress={() => open(view)}>
        <Icon icon={icon} size={16} strokeWidth={1.7} color={s.appsSectionCardIcon.color} />
        <T {...tx(s.appsSectionCard, s.appsSectionCardOpen)} {...s.appsSectionCardLabel}>
          {view.title}
        </T>
      </Press>
    </row>
  );
}

export function ViewsLibrary({ views, heading }: { views: readonly IndexedView[]; heading?: string }) {
  const s = useAppsSection();
  if (views.length === 0) return null;
  return (
    <col w="full" {...s.cloudAppsLibrary}>
      {heading ? (
        <row {...s.cloudAppsLibraryHeading}>
          <T {...tx(s.cloudAppsLibraryHeading)}>{heading}</T>
          <T {...tx(s.cloudAppsLibraryHeading)}>{views.length}</T>
        </row>
      ) : null}
      <col {...s.appsSectionGrid} {...s.cloudAppsLibraryGrid}>
        {views.map((view) => (
          <ViewCard key={view.id} view={view} />
        ))}
      </col>
    </col>
  );
}
