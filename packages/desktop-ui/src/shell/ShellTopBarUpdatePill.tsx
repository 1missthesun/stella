import { memo } from "react";
import { Download } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import {
  updateProgress,
  useAppSourceState,
  versionOffer,
} from "@/features/app-source/app-source-store";
import {
  addOffer,
  useAppSourceAction,
} from "@/features/app-source/AppSourceCards";
import "./shell-topbar-update-pill.css";

export const ShellTopBarUpdatePill = memo(function ShellTopBarUpdatePill() {
  const t = useT();
  const state = useAppSourceState();
  const { pending, run } = useAppSourceAction();
  const offer = state ? versionOffer(state) : null;
  if (!state || !offer) return null;
  const updating =
    offer.adding ||
    pending === offer.key ||
    updateProgress(state)?.state === "merging";
  const label = updating
    ? t("shell.appSource.updating")
    : t("shell.appSource.update");

  return (
    <div
      className="shell-topbar-update-pill"
      data-state={updating ? "updating" : "ready"}
      data-update-transition={updating ? "live" : undefined}
    >
      <button
        type="button"
        className="shell-topbar-update-pill__main"
        onClick={() => void run(offer.key, () => addOffer(offer))}
        disabled={updating || state.busy || pending !== null}
        aria-label={label}
        title={t("shell.appSource.updateAvailable")}
        data-testid="topbar-update-pill"
      >
        <Download
          className="shell-topbar-update-pill__icon"
          size={12}
          strokeWidth={2}
          aria-hidden
        />
        <span className="shell-topbar-update-pill__label">{label}</span>
      </button>
    </div>
  );
});
