import { useState, type ReactNode } from "react";
import { Avatar } from "@/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Check, MoreHorizontal } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import "./engine-accounts.css";

export type EngineAccountMenuItem = { key: string; label: string; onSelect: () => void };

export type EngineAccountPlace = {
  key: string;
  label: string;
  signedIn: boolean;
  inUse?: boolean;
};

const K = "settings.engineAccounts";

export const accountInitials = (row: { email?: string; label: string }): string => {
  const source = (row.email ?? row.label).split("@")[0] ?? "";
  const words = source.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase() || "?";
};

export const formatPlan = (plan: string | undefined): string | undefined =>
  plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : undefined;

export function EngineAccountPlaces({ places }: { places: EngineAccountPlace[] }) {
  const t = useT();
  if (places.length === 0) return null;
  return (
    <div className="engine-account-places">
      {places.map((place) => {
        const label = t(
          place.inUse
            ? `${K}.placeInUse`
            : place.signedIn
              ? `${K}.placeSignedIn`
              : `${K}.placeSignedOut`,
          { place: place.label },
        );
        return (
          <span
            key={place.key}
            className="engine-account-place"
            data-signed-in={place.signedIn || undefined}
            data-in-use={place.inUse || undefined}
            aria-label={label}
            title={label}
          >
            {place.label}
          </span>
        );
      })}
    </div>
  );
}

export function EngineAccountHeader({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-label">{title}</div>
        {description ? <div className="settings-row-sublabel">{description}</div> : null}
      </div>
      {control ? <div className="settings-row-control">{control}</div> : null}
    </div>
  );
}

export function EngineAccountRowView({
  id,
  title,
  initials,
  subtitle,
  places = [],
  active,
  activeLabel,
  leading,
  busy,
  onPick,
  items,
  tail = [],
}: {
  id: string;
  title: string;
  initials: string;
  subtitle?: string;
  places?: EngineAccountPlace[];
  active: boolean;
  activeLabel?: string;
  leading?: ReactNode;
  busy: boolean;
  onPick?: () => void;
  items: EngineAccountMenuItem[];
  tail?: EngineAccountMenuItem[];
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = (
    <>
      {leading ?? <Avatar fallback={initials} size="small" />}
      <div className="engine-account-identity__text">
        <div className="settings-row-label">{title}</div>
        {subtitle ? <div className="settings-row-sublabel">{subtitle}</div> : null}
        <EngineAccountPlaces places={places} />
      </div>
    </>
  );
  return (
    <div
      className="settings-row engine-account-row"
      data-engine-account={id}
      data-active={active || undefined}
    >
      {onPick && !active ? (
        <button
          type="button"
          className="settings-row-info engine-account-identity engine-account-identity--pick"
          onClick={onPick}
          disabled={busy}
          title={t(`${K}.useAccount`)}
          aria-label={`${t(`${K}.useAccount`)}: ${title}`}
        >
          {identity}
        </button>
      ) : (
        <div className="settings-row-info engine-account-identity">{identity}</div>
      )}
      <div className="engine-account-controls settings-row-control">
        {active ? (
          <span className="engine-account-badge">
            <Check size={14} aria-hidden />
            {activeLabel ?? t(`${K}.active`)}
          </span>
        ) : null}
        {items.length + tail.length > 0 ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="pill-btn"
                aria-label={t(`${K}.moreLabel`, { name: title })}
                disabled={busy}
              >
                <MoreHorizontal size={16} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12}>
              {items.map((item) => (
                <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
              {items.length > 0 && tail.length > 0 ? <DropdownMenuSeparator /> : null}
              {tail.map((item) => (
                <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
