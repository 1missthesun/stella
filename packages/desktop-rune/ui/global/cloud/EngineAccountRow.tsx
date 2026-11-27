import { SettingsRow } from "../../settings/parts";
import { Avatar, Check, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MoreHorizontal, Press, T, tx } from "../../kit/compat";
import { useEngineAccounts } from "./engine-accounts.styles";
import { useSettings } from "../../settings/settings.styles";
import { usePill } from "../shared/pill.styles";
import { useState, type ReactNode } from "react";
import { useT } from "@/shared/i18n";

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
  const s = useEngineAccounts();
  const t = useT();
  if (places.length === 0) return null;
  return (
    <row {...s.engineAccountPlaces}>
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
          <T {...tx(s.engineAccountPlaces)} {...s.engineAccountPlace} key={place.key} label={label} title={label} {...((place.inUse || undefined) ? s.engineAccountPlaceInUse : null)}>
            {place.label}
          </T>
        );
      })}
    </row>
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
  const sSettings = useSettings();
  return (
    <SettingsRow>
      <col {...sSettings.settingsRowInfo}>
        <T w="full" {...sSettings.settingsRowLabel}>{title}</T>
        {description ? <T w="full" {...sSettings.settingsRowSublabel}>{description}</T> : null}
      </col>
      {control ? <T {...sSettings.settingsRowControl}>{control}</T> : null}
    </SettingsRow>
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
  const s = useEngineAccounts();
  const sSettings = useSettings();
  const sPill = usePill();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = (
    <>
      {leading ?? <Avatar fallback={initials} size="small" />}
      <col w="full" {...s.engineAccountIdentityText}>
        <T w="full" {...sSettings.settingsRowLabel}>{title}</T>
        {subtitle ? <T w="full" {...sSettings.settingsRowSublabel}>{subtitle}</T> : null}
        <EngineAccountPlaces places={places} />
      </col>
    </>
  );
  return (
    <SettingsRow>
      {onPick && !active ? (
        <Press {...sSettings.settingsRowInfo} {...s.engineAccountIdentity} {...s.engineAccountIdentityPick} onPress={onPick} disabled={busy} title={t(`${K}.useAccount`)} label={`${t(`${K}.useAccount`)}: ${title}`} {...((busy) ? s.engineAccountIdentityPickDisabled : null)}>
          {identity}
        </Press>
      ) : (
        <T {...sSettings.settingsRowInfo} {...s.engineAccountIdentity}>{identity}</T>
      )}
      <row {...s.engineAccountControls} {...sSettings.settingsRowControl}>
        {active ? (
          <row {...s.engineAccountBadge}>
            <Check size={14} color={s.engineAccountBadge.color} />
            {activeLabel ?? t(`${K}.active`)}
          </row>
        ) : null}
        {items.length + tail.length > 0 ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Press {...sPill.pillBtn} label={t(`${K}.moreLabel`, { name: title })} disabled={busy} {...((busy) ? sPill.pillBtnDisabled : null)}>
                <MoreHorizontal size={16} color={sPill.pillBtn.color} />
              </Press>
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
      </row>
    </SettingsRow>
  );
}
