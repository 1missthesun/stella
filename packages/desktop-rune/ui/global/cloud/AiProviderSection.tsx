import { SettingsCard } from "../../settings/parts";
import { Button, ChevronRight, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ExternalLink, Flow, MoreHorizontal, Press, T, tx } from "../../kit/compat";
import { useAiAccounts } from "./ai-accounts.styles";
import { usePill } from "../shared/pill.styles";
import type { ReactNode } from "react";
import { SettingsCardTitle } from "../../settings/settings-card-targets";
import { useViewState } from "@/platform/view-state/view-state";

export function AiProviderSection({
  id,
  titleKey,
  action,
  children,
  notes,
  details,
  detailsLabel,
}: {
  id: string;
  titleKey: string;
  action?: ReactNode;
  children: ReactNode;
  notes?: ReactNode;
  details?: ReactNode;
  detailsLabel?: string;
}) {
  const s = useAiAccounts();
  const [open, setOpen] = useViewState<boolean>(
    `settings.ai.${id}.open`,
    false,
    (value) => typeof value === "boolean",
  );
  return (
    <SettingsCard>
      <row {...s.aiProviderHead}>
        <SettingsCardTitle titleKey={titleKey} variant="provider" flush />
        {action ? <Flow shrink={false} minH={24} align="center">{action}</Flow> : null}
      </row>
      {children}
      {notes}
      {details && detailsLabel ? (
        <>
          <Press {...s.aiProviderMore} expanded={open} onPress={() => setOpen(!open)}>
            <ChevronRight size={14} {...s.aiProviderChevron} color={s.aiProviderMore.color} />
            {detailsLabel}
          </Press>
          {open ? <Flow vertical w="full" {...s.aiProviderDetails}>{details}</Flow> : null}
        </>
      ) : null}
    </SettingsCard>
  );
}

export function AiPrimaryAccount({
  name,
  meta,
  status,
  trailing,
}: {
  name: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  trailing?: ReactNode;
}) {
  const s = useAiAccounts();
  return (
    <row {...s.aiPrimary}>
      <col {...s.aiPrimaryText}>
        <T w="full" {...s.aiPrimaryName}>{name}</T>
        {meta ? <Flow w="full" {...s.aiPrimaryMeta}>{meta}</Flow> : null}
      </col>
      {status ? <Flow shrink={false} {...s.aiPrimaryStatus}>{status}</Flow> : null}
      {trailing}
    </row>
  );
}

export function AiInUse({ label }: { label: string }) {
  const s = useAiAccounts();
  return (
    <Flow shrink={false} {...s.aiInUse}>
      <box {...s.aiInUseDot} />
      {label}
    </Flow>
  );
}

export function AiNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const s = useAiAccounts();
  return (
    <Flow {...s.aiNote} role="note">
      <T {...tx(s.aiNote)} {...s.aiNoteText}>{children}</T>
      {action}
    </Flow>
  );
}

export function AiLink({
  label,
  onClick,
  external,
  disabled,
}: {
  label: string;
  onClick: () => void;
  external?: boolean;
  disabled?: boolean;
}) {
  const s = useAiAccounts();
  return (
    <Press {...s.aiLink} onPress={onClick} disabled={disabled}>
      {label}
      {external ? <ExternalLink size={12} color={s.aiLink.color} /> : null}
    </Press>
  );
}

export function AiDetailsGroup({ label, children }: { label: string; children: ReactNode }) {
  const s = useAiAccounts();
  return (
    <col>
      <T w="full" {...s.aiDetailsGroupLabel}>{label}</T>
      {children}
    </col>
  );
}

export type AiMenuItem = { key: string; label: string; onSelect: () => void };

export function AiRow({
  name,
  meta,
  inUseLabel,
  onUse,
  useLabel,
  menuLabel,
  menu = [],
  busy,
  children,
  extra,
}: {
  name: string;
  meta?: ReactNode;
  inUseLabel?: string;
  onUse?: () => void;
  useLabel?: string;
  menuLabel?: string;
  menu?: AiMenuItem[];
  busy?: boolean;
  children?: ReactNode;
  extra?: ReactNode;
}) {
  const s = useAiAccounts();
  const sPill = usePill();
  return (
    <row {...s.aiRow}>
      <col {...s.aiRowText}>
        <T w="full" {...s.aiRowName} title={name}>{name}</T>
        {meta ? <Flow w="full" {...s.aiRowMeta}>{meta}</Flow> : null}
        {extra}
      </col>
      <row {...s.aiRowControls}>
        {inUseLabel ? <AiInUse label={inUseLabel} /> : null}
        {onUse && useLabel ? (
          <Button variant="ghost" className="pill-btn" onClick={onUse} disabled={busy}>
            {useLabel}
          </Button>
        ) : null}
        {children}
        {menu.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="pill-btn" aria-label={menuLabel} disabled={busy}>
                <MoreHorizontal size={16} color={sPill.pillBtn.color} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12}>
              {menu.map((item) => (
                <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </row>
    </row>
  );
}

/** desktop-ui's `<span data-empty>` inside an `ai-primary__name`. */
export function AiEmptyName({ children }: { children?: ReactNode }) {
  const s = useAiAccounts();
  return <T {...s.aiPrimaryNameEmpty}>{children}</T>;
}
