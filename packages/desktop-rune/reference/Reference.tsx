import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/context/theme-context";
import { LocalI18nProvider } from "@/shared/i18n/I18nProvider";
import { ShiftingGradient } from "@/shell/background/ShiftingGradient";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { ChevronDown, ExternalLink, Link, MoreHorizontal, Plus, Search, Settings, Share, Trash2, X } from "@/ui/icons";
import { Keybind } from "@/ui/keybind";
import { ManualCopyField } from "@/ui/manual-copy-field";
import { Popover } from "@/ui/popover";
import { Select } from "@/ui/select";
import { StellaMark } from "@/ui/stella-mark";
import { Switch } from "@/ui/switch";
import { TextField } from "@/ui/text-field";
import { showToast, ToastProvider } from "@/ui/toast";
import { WorkingDots } from "@/ui/working-dots";
import { ChatReference } from "./ChatReference";
import { Markdown } from "@/app/chat/Markdown";
import { useTheme } from "@/context/theme-context";
import * as Icons from "../ui/kit/icons/catalog.gen";
import { GALLERY_MARKDOWN, GALLERY_MOTIFS, TYPE_FAMILIES, TYPE_SAMPLE } from "../ui/gallery/spec";

type IconData = { name: string; view: number; body: string; color?: string };

const sectionTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-weaker)",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children, gap = 12 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap }}>{children}</div>;
}

const ICON_SIZE = { small: 12, normal: 14, large: 16 } as const;

function KitButton({ variant, size = "normal", icon, iconRight, disabled, children }: { variant: "primary" | "secondary" | "ghost"; size?: "small" | "normal" | "large"; icon?: typeof Plus; iconRight?: typeof Plus; disabled?: boolean; children: ReactNode }) {
  const I = icon;
  const R = iconRight;
  return (
    <Button variant={variant} size={size} disabled={disabled}>
      {I ? <I size={ICON_SIZE[size]} /> : null}
      {children}
      {R ? <R size={ICON_SIZE[size]} /> : null}
    </Button>
  );
}

function IconButton({ icon: I, size = 24, iconSize = 16, active, disabled }: { icon: typeof Plus; size?: number; iconSize?: number; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 6,
        border: "none",
        padding: 0,
        background: active ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <I size={iconSize} />
    </button>
  );
}

function Pill({ tone, active, large, disabled, icon: I, children }: { tone?: "primary" | "danger"; active?: boolean; large?: boolean; disabled?: boolean; icon?: typeof Plus; children: ReactNode }) {
  const cls = ["pill-btn", active && "pill-btn--active", tone && `pill-btn--${tone}`, large && "pill-btn--lg"].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled}>
      {I ? <I size={14} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

function Buttons() {
  const [tab, setTab] = useState("chat");
  const variants = ["primary", "secondary", "ghost"] as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {variants.map((v) => (
        <Section key={v} title={`Button · ${v}`}>
          <Row>
            <KitButton variant={v} size="small">Small</KitButton>
            <KitButton variant={v}>Normal</KitButton>
            <KitButton variant={v} size="large">Large</KitButton>
            <KitButton variant={v} size="large" icon={Plus}>With icon</KitButton>
            <KitButton variant={v} size="large" disabled>Disabled</KitButton>
          </Row>
        </Section>
      ))}
      <Section title="IconButton">
        <Row gap={8}>
          <IconButton icon={X} />
          <IconButton icon={MoreHorizontal} />
          <IconButton icon={Search} size={28} />
          <IconButton icon={Settings} size={32} iconSize={18} active />
          <IconButton icon={Trash2} disabled />
        </Row>
      </Section>
      <Section title="Pill">
        <Row gap={8}>
          <Pill>Default</Pill>
          <Pill active>Active</Pill>
          <Pill tone="primary">Primary</Pill>
          <Pill tone="danger">Danger</Pill>
          <Pill disabled>Disabled</Pill>
          <Pill large icon={Plus}>Large</Pill>
        </Row>
      </Section>
      <Section title="Tabs">
        <div role="tablist" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          {["Chat", "Files", "Agents", "Apps"].map((label) => (
            <button key={label} type="button" className={`pill-btn${tab === label.toLowerCase() ? " pill-btn--active" : ""}`} onClick={() => setTab(label.toLowerCase())}>
              {label}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Controls() {
  const [sel, setSel] = useState("opus");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section title="Switch">
        <Row gap={28}>
          <Switch checked={false} label="Off" />
          <Switch checked label="On" />
          <Switch checked={false} label="Disabled" disabled />
          <Switch checked label="Sync across devices" description="Keep chats on every computer" />
        </Row>
      </Section>
      <Section title="TextField">
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ width: 300 }}>
            <TextField label="Name" placeholder="Your name" />
          </div>
          <div style={{ width: 300 }}>
            <TextField label="Email" defaultValue="rahul@stella.sh" description="We'll send a sign-in link." />
          </div>
          <div style={{ width: 300 }}>
            <TextField label="Code" defaultValue="12" error="Enter the 6-digit code." />
          </div>
        </div>
      </Section>
      <Section title="Select">
        <div style={{ width: 300 }}>
          <Select label="Model" value={sel} onValueChange={setSel} options={[{ value: "opus", label: "Claude Opus 5.5" }, { value: "gpt", label: "GPT 6.1" }, { value: "gemini", label: "Gemini 4" }]} />
        </div>
      </Section>
      <Section title="Keybind · Avatar · WorkingDots · StellaMark">
        <Row gap={24}>
          <Keybind keys={["⌘", "K"]} />
          <Keybind keys={["Ctrl", "Shift", "P"]} />
          <Avatar fallback="Stella" size="small" />
          <Avatar fallback="Rahul" />
          <Avatar fallback="omarchy" size="large" />
          <WorkingDots />
          <StellaMark size={16} />
          <StellaMark size={32} />
          <StellaMark size={58} />
        </Row>
      </Section>
      <Section title="ManualCopyField">
        <ManualCopyField value="https://stella.sh/c/9f2a1e" label="Copy link" />
      </Section>
    </div>
  );
}

function Overlays() {
  const [checked, setChecked] = useState(true);
  const [mode, setMode] = useState("dark");
  useEffect(() => {
    const timer = setTimeout(() => {
      showToast({ title: "Update ready", description: "Stella 18.2 is ready to install.", duration: 0, action: { label: "Restart", onClick: () => {} }, secondaryAction: { label: "Later", onClick: () => {} } });
      showToast({ description: "Copied to clipboard", variant: "success", duration: 0 });
      showToast({ title: "Couldn't send", description: "Check your connection and try again.", variant: "error", duration: 0 });
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="large">
            Menu
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Conversation</DropdownMenuLabel>
          <DropdownMenuItem>
            <span data-slot="dropdown-menu-item-icon">
              <Share size={16} />
            </span>
            Share
          </DropdownMenuItem>
          <DropdownMenuItem>
            <span data-slot="dropdown-menu-item-icon">
              <Link size={16} />
            </span>
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <span data-slot="dropdown-menu-item-icon">
              <ExternalLink size={16} />
            </span>
            Open in browser
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>
            Show tools
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value={mode} onValueChange={setMode}>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-variant="destructive">
            <span data-slot="dropdown-menu-item-icon">
              <Trash2 size={16} />
            </span>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover open modal={false}>
        <Popover.Trigger asChild>
          <Button variant="secondary" size="large">
            Popover
          </Button>
        </Popover.Trigger>
        <Popover.Content align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Popover.Body>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>Execution target</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-weak)" }}>Agents run on omarchy while it's online, otherwise in the cloud.</div>
            </div>
          </Popover.Body>
        </Popover.Content>
      </Popover>
    </div>
  );
}

function DialogPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Button variant="primary" size="large" style={{ alignSelf: "flex-start" }}>
        Open dialog
      </Button>
      <Dialog open>
        <DialogContent size="md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Sign out of Stella?</DialogTitle>
            <DialogCloseButton aria-label="Close" />
          </DialogHeader>
          <DialogDescription>Your chats stay on this computer. You can sign back in at any time.</DialogDescription>
          <DialogBody>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "0 24px 20px" }}>
              <TextField label="Type your email to confirm" placeholder="you@example.com" />
              <Switch checked label="Keep local files" />
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-weak)" }}>Signing out stops background agents on this computer.</div>
            </div>
          </DialogBody>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 24px 20px" }}>
            <Button size="large">Cancel</Button>
            <Button variant="primary" size="large">
              Sign out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconGrid({ group, icons }: { group: string; icons: Record<string, IconData> }) {
  return (
    <Section title={`${group} (${Object.keys(icons).length})`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {Object.entries(icons).map(([name, icon]) => (
          <div key={name} title={name} style={{ width: 64, height: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 8 }}>
            <svg width={20} height={20} viewBox={`0 0 ${icon.view} ${icon.view}`} style={{ color: icon.color ?? "var(--text-base)" }} dangerouslySetInnerHTML={{ __html: icon.body }} />
            <div style={{ fontSize: 9, color: "var(--text-weaker)", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function IconsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <IconGrid group="icons.tsx" icons={Icons.stella} />
      <IconGrid group="nav · window · marks" icons={{ ...Icons.nav, ...Icons.window, ...Icons.mark }} />
      <IconGrid group="workspace display" icons={Icons.display} />
      <IconGrid group="brands" icons={Icons.brand} />
    </div>
  );
}

function MarkdownPage() {
  return (
    <div className="chat-viewport-region">
      <div className="event-item assistant">
        <div className="message-line message-line--assistant">
          <div className="assistant-message-text chat-bubble-text">
            <Markdown text={GALLERY_MARKDOWN} cacheKey="gallery" />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 24, height: 360 }}>
        <EmptyState motif="files" title="No files yet" body="Files Stella makes or you drop here show up in this list." action={{ label: "Add files", onClick: () => {}, icon: Plus }} live={false} />
        <EmptyState motif="search" size="compact" title="Nothing matches" detail="“quarterly report”" body="Try another word." live={false} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {GALLERY_MOTIFS.map((m) => (
          <div key={m} style={{ width: 150, height: 200, display: "flex", flexDirection: "column" }}>
            <EmptyState motif={m} size="compact" title={m} live={false} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TypePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {TYPE_FAMILIES.map((f) => (
        <Section key={f.family} title={f.family}>
          {f.sizes.map((size) =>
            f.weights.map((w) => (
              <div key={`${size}-${w}`} style={{ fontFamily: `"${f.family}"`, fontSize: size, fontWeight: w, lineHeight: `${Math.round(size * 1.4)}px`, color: "var(--text-strong)", letterSpacing: 0 }}>
                {`${size}/${w} ${TYPE_SAMPLE}`}
              </div>
            )),
          )}
        </Section>
      ))}
    </div>
  );
}

const PAGES: Record<string, () => ReactNode> = {
  type: TypePage,
  buttons: Buttons,
  controls: Controls,
  overlays: Overlays,
  dialog: DialogPage,
  icons: IconsPage,
  markdown: MarkdownPage,
  empty: EmptyPage,
};

function Page({ page, themeKey }: { page: string; themeKey: string }) {
  const { gradientMode, gradientColor } = useTheme();
  const Body = PAGES[page] ?? Buttons;
  if (page === "chat") {
    return (
      <div className="app" style={{ position: "fixed", inset: 0 }}>
        <div className="window-shell full" style={{ position: "absolute", inset: 0 }}>
          <ShiftingGradient mode={gradientMode} colorMode={gradientColor} lightweight={false} />
          <ChatReference />
        </div>
      </div>
    );
  }
  return (
    <div className="app" style={{ position: "fixed", inset: 0 }}>
      <div className="window-shell full" style={{ position: "absolute", inset: 0 }}>
        <ShiftingGradient mode={gradientMode} colorMode={gradientColor} lightweight={false} />
        <div style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StellaMark size={20} />
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text-strong)" }}>{`Kit · ${page}`}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-weaker)" }}>{themeKey}</div>
            </div>
            <Body />
          </div>
        </div>
      </div>
    </div>
  );
}

export function mountReference(root: HTMLElement, page: string, themeKey: string) {
  createRoot(root).render(
    <LocalI18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <Page page={page} themeKey={themeKey} />
        </ToastProvider>
      </ThemeProvider>
    </LocalI18nProvider>,
  );
}
