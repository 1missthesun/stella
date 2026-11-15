import type { ReactNode } from "react";
import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useViewState } from "@/platform/view-state/view-state";
import { ChevronRight, ExternalLink, MoreHorizontal } from "@/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Button } from "@/ui/button";
import "./ai-accounts.css";

/** One provider on the Claude and ChatGPT tab: who is signed in, what needs you, and the rest folded away. */
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
  const [open, setOpen] = useViewState<boolean>(
    `settings.ai.${id}.open`,
    false,
    (value) => typeof value === "boolean",
  );
  return (
    <section className="settings-card ai-provider" data-ai-provider={id}>
      <div className="ai-provider__head">
        <SettingsCardTitle titleKey={titleKey} />
        {action ? <div className="ai-provider__action">{action}</div> : null}
      </div>
      {children}
      {notes}
      {details && detailsLabel ? (
        <>
          <button
            type="button"
            className="ai-provider__more"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={14} aria-hidden className="ai-provider__chevron" />
            {detailsLabel}
          </button>
          {open ? <div className="ai-provider__details">{details}</div> : null}
        </>
      ) : null}
    </section>
  );
}

/** The account a provider runs on, in one line, with where it works and how much is used beneath it. */
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
  return (
    <div className="ai-primary">
      <div className="ai-primary__text">
        <div className="ai-primary__name">{name}</div>
        {meta ? <div className="ai-primary__meta">{meta}</div> : null}
      </div>
      {status ? <div className="ai-primary__status">{status}</div> : null}
      {trailing}
    </div>
  );
}

export function AiInUse({ label }: { label: string }) {
  return (
    <span className="ai-in-use">
      <span className="ai-in-use__dot" aria-hidden />
      {label}
    </span>
  );
}

/** Something that needs the person, with the one action that settles it. */
export function AiNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ai-note" role="note">
      <span className="ai-note__text">{children}</span>
      {action}
    </div>
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
  return (
    <button type="button" className="ai-link" onClick={onClick} disabled={disabled}>
      {label}
      {external ? <ExternalLink size={12} aria-hidden /> : null}
    </button>
  );
}

export function AiDetailsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ai-details-group">
      <div className="ai-details-group__label">{label}</div>
      {children}
    </div>
  );
}

export type AiMenuItem = { key: string; label: string; onSelect: () => void };

/** A row in the folded list: an account or a computer, its state, and its few controls. */
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
  return (
    <div className="ai-row">
      <div className="ai-row__text">
        <div className="ai-row__name" title={name}>{name}</div>
        {meta ? <div className="ai-row__meta">{meta}</div> : null}
        {extra}
      </div>
      <div className="ai-row__controls">
        {inUseLabel ? <AiInUse label={inUseLabel} /> : null}
        {onUse && useLabel ? (
          <Button type="button" variant="ghost" className="pill-btn" onClick={onUse} disabled={busy}>
            {useLabel}
          </Button>
        ) : null}
        {children}
        {menu.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="pill-btn" aria-label={menuLabel} disabled={busy}>
                <MoreHorizontal size={16} aria-hidden />
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
      </div>
    </div>
  );
}
