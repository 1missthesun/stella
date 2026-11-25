import { useEffect, useState, type ReactNode } from "react";
import { ThemeBackdrop, ThemeScope, fontSize, look, useTokens } from "../theme";
import {
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  EmptyState,
  Icon,
  IconButton,
  Icons,
  Keybind,
  ManualCopyField,
  Markdown,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  Pill,
  Popover,
  Select,
  StellaMark,
  Switch,
  Tabs,
  TextField,
  ToastRegion,
  WorkingDots,
  showToast,
  type IconData,
} from "../kit";
import { I18nProvider } from "../i18n";
import { GALLERY_MARKDOWN, GALLERY_MOTIFS, GALLERY_THEMES, TYPE_FAMILIES, TYPE_SAMPLE, type GalleryPage } from "./spec";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTokens();
  return (
    <col gap={12} w="full">
      <text {...look(fontSize.xs, 600, { em: 0.06 })} textCase="upper" color={t.c.textWeaker}>
        {title}
      </text>
      {children}
    </col>
  );
}

function Row({ children, gap = 12 }: { children: ReactNode; gap?: number }) {
  return (
    <row gap={gap} align="center" wrap>
      {children}
    </row>
  );
}

function Buttons() {
  const [tab, setTab] = useState("chat");
  const variants = ["primary", "secondary", "ghost"] as const;
  return (
    <col gap={28} w="full">
      {variants.map((v) => (
        <Section key={v} title={`Button · ${v}`}>
          <Row>
            <Button id={`b-${v}-s`} variant={v} size="small">Small</Button>
            <Button id={`b-${v}-n`} variant={v}>Normal</Button>
            <Button id={`b-${v}-l`} variant={v} size="large">Large</Button>
            <Button id={`b-${v}-i`} variant={v} size="large" icon={Icons.stella.Plus}>With icon</Button>
            <Button id={`b-${v}-d`} variant={v} size="large" disabled>Disabled</Button>
          </Row>
        </Section>
      ))}
      <Section title="IconButton">
        <Row gap={8}>
          <IconButton id="ib-1" icon={Icons.stella.X} label="Close" />
          <IconButton id="ib-2" icon={Icons.stella.MoreHorizontal} label="More" />
          <IconButton id="ib-3" icon={Icons.stella.Search} label="Search" size={28} />
          <IconButton id="ib-4" icon={Icons.stella.Settings} label="Settings" size={32} iconSize={18} active />
          <IconButton id="ib-5" icon={Icons.stella.Trash2} label="Delete" disabled />
        </Row>
      </Section>
      <Section title="Pill">
        <Row gap={8}>
          <Pill id="p-1">Default</Pill>
          <Pill id="p-2" active>Active</Pill>
          <Pill id="p-3" tone="primary">Primary</Pill>
          <Pill id="p-4" tone="danger">Danger</Pill>
          <Pill id="p-5" disabled>Disabled</Pill>
          <Pill id="p-6" large icon={Icons.stella.Plus}>Large</Pill>
        </Row>
      </Section>
      <Section title="Tabs">
        <Tabs id="tabs" value={tab} onValueChange={setTab} items={[{ value: "chat", label: "Chat" }, { value: "files", label: "Files" }, { value: "agents", label: "Agents" }, { value: "apps", label: "Apps" }]} />
      </Section>
    </col>
  );
}

function Controls() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(true);
  const [sel, setSel] = useState("opus");
  return (
    <col gap={28} w="full">
      <Section title="Switch">
        <Row gap={28}>
          <Switch id="sw-1" checked={a} onCheckedChange={setA} label="Off" />
          <Switch id="sw-2" checked={b} onCheckedChange={setB} label="On" />
          <Switch id="sw-3" checked={false} label="Disabled" disabled />
          <Switch id="sw-4" checked label="Sync across devices" description="Keep chats on every computer" />
        </Row>
      </Section>
      <Section title="TextField">
        <row gap={20} w="full" align="start">
          <col w={300}>
            <TextField id="tf-1" label="Name" placeholder="Your name" />
          </col>
          <col w={300}>
            <TextField id="tf-2" label="Email" value="rahul@stella.sh" description="We'll send a sign-in link." />
          </col>
          <col w={300}>
            <TextField id="tf-3" label="Code" value="12" error="Enter the 6-digit code." />
          </col>
        </row>
      </Section>
      <Section title="Select">
        <col w={300}>
          <Select id="sel" label="Model" value={sel} onValueChange={setSel} options={[{ value: "opus", label: "Claude Opus 5.5" }, { value: "gpt", label: "GPT 6.1" }, { value: "gemini", label: "Gemini 4" }]} />
        </col>
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
        <ManualCopyField id="mcf" value="https://stella.sh/c/9f2a1e" label="Copy link" />
      </Section>
    </col>
  );
}

function Overlays() {
  const [menu, setMenu] = useState(true);
  const [pop, setPop] = useState(true);
  const [checked, setChecked] = useState(true);
  const [mode, setMode] = useState("dark");
  useEffect(() => {
    showToast({ title: "Update ready", description: "Stella 18.2 is ready to install.", duration: 0, action: { label: "Restart", onClick: () => {} }, secondaryAction: { label: "Later", onClick: () => {} } });
    showToast({ description: "Copied to clipboard", variant: "success", duration: 0 });
    showToast({ title: "Couldn't send", description: "Check your connection and try again.", variant: "error", duration: 0 });
  }, []);
  return (
    <row gap={48} w="full" align="start">
      <DropdownMenu
        id="menu"
        open={menu}
        onOpenChange={setMenu}
        trigger={(tr) => (
          <Button id={tr.id} variant="secondary" size="large" iconRight={Icons.stella.ChevronDown} onPress={tr.toggle}>
            Menu
          </Button>
        )}
      >
        <MenuLabel>Conversation</MenuLabel>
        <MenuItem icon={Icons.stella.Share}>Share</MenuItem>
        <MenuItem icon={Icons.stella.Link}>Copy link</MenuItem>
        <MenuItem icon={Icons.stella.ExternalLink} disabled>Open in browser</MenuItem>
        <MenuSeparator />
        <MenuCheckboxItem checked={checked} onCheckedChange={setChecked}>Show tools</MenuCheckboxItem>
        <MenuRadioItem checked={mode === "light"} onSelect={() => setMode("light")}>Light</MenuRadioItem>
        <MenuRadioItem checked={mode === "dark"} onSelect={() => setMode("dark")}>Dark</MenuRadioItem>
        <MenuSeparator />
        <MenuItem icon={Icons.stella.Trash2} destructive>Delete</MenuItem>
      </DropdownMenu>
      <Popover
        id="pop"
        open={pop}
        onOpenChange={setPop}
        align="start"
        trigger={(tr) => (
          <Button id={tr.id} variant="secondary" size="large" onPress={tr.toggle}>
            Popover
          </Button>
        )}
      >
        <PopoverBody />
      </Popover>
      <ToastRegion />
    </row>
  );
}

function PopoverBody() {
  const t = useTokens();
  return (
    <col gap={6}>
      <text {...look(fontSize.md, 600)} color={t.c.textStrong}>Execution target</text>
      <text {...look(fontSize.sm, 400, { lh: 1.5 })} color={t.c.textWeak}>Agents run on omarchy while it's online, otherwise in the cloud.</text>
    </col>
  );
}

function DialogPage() {
  const [open, setOpen] = useState(true);
  const t = useTokens();
  return (
    <col gap={16} w="full" align="start">
      <Button id="open-dialog" variant="primary" size="large" onPress={() => setOpen(true)}>Open dialog</Button>
      <Dialog id="dlg" open={open} onOpenChange={setOpen} label="Sign out">
        <DialogHeader>
          <DialogTitle>Sign out of Stella?</DialogTitle>
          <DialogCloseButton id="dlg-close" onPress={() => setOpen(false)} />
        </DialogHeader>
        <DialogDescription>Your chats stay on this computer. You can sign back in at any time.</DialogDescription>
        <DialogBody>
          <col px={24} pb={20} gap={14}>
            <TextField id="dlg-tf" label="Type your email to confirm" placeholder="you@example.com" />
            <Switch id="dlg-sw" checked label="Keep local files" />
            <text {...look(fontSize.sm, 400, { lh: 1.5 })} color={t.c.textWeak}>Signing out stops background agents on this computer.</text>
          </col>
        </DialogBody>
        <row justify="end" gap={8} px={24} pb={20}>
          <Button id="dlg-cancel" size="large" onPress={() => setOpen(false)}>Cancel</Button>
          <Button id="dlg-ok" variant="primary" size="large" onPress={() => setOpen(false)}>Sign out</Button>
        </row>
      </Dialog>
    </col>
  );
}

function IconGrid({ group, icons }: { group: string; icons: Record<string, IconData> }) {
  const t = useTokens();
  return (
    <Section title={`${group} (${Object.keys(icons).length})`}>
      <row gap={6} wrap w="full">
        {Object.entries(icons).map(([name, icon]) => (
          <col key={name} w={64} h={56} gap={4} align="center" justify="center" radius={8} hover={t.c.ghostHover} title={name}>
            <Icon icon={icon} size={20} color={t.c.textBase} />
            <text size={9} lineHeight={13.5} color={t.c.textWeaker} truncate maxW={60}>{name}</text>
          </col>
        ))}
      </row>
    </Section>
  );
}

function IconsPage() {
  return (
    <col gap={20} w="full">
      <IconGrid group="icons.tsx" icons={Icons.stella} />
      <IconGrid group="nav · window · marks" icons={{ ...Icons.nav, ...Icons.window, ...Icons.mark }} />
      <IconGrid group="workspace display" icons={Icons.display} />
      <IconGrid group="brands" icons={Icons.brand} />
    </col>
  );
}

function MarkdownPage() {
  const t = useTokens();
  return (
    <row w="full" justify="start">
      <col maxW="85%" px={14} py={8} radius={18} fill={t.c.chatAssistantBubbleFillTop} gradient={t.gradient.assistantBubble}>
        <Markdown id="md" text={GALLERY_MARKDOWN} />
      </col>
    </row>
  );
}

function EmptyPage() {
  return (
    <col gap={8} w="full">
      <row gap={24} w="full" h={360}>
        <EmptyState id="es-1" motif="files" live={false} title="No files yet" body="Files Stella makes or you drop here show up in this list." action={{ label: "Add files", onClick: () => {}, icon: Icons.stella.Plus }} />
        <EmptyState id="es-2" motif="search" live={false} size="compact" title="Nothing matches" detail="“quarterly report”" body="Try another word." />
      </row>
      <row gap={0} w="full" wrap>
        {GALLERY_MOTIFS.map((m) => (
          <col key={m} w={150} h={200}>
            <EmptyState id={`es-${m}`} motif={m} live={false} size="compact" title={m} />
          </col>
        ))}
      </row>
    </col>
  );
}

function TypePage() {
  const t = useTokens();
  return (
    <col gap={20} w="full">
      {TYPE_FAMILIES.map((f) => (
        <Section key={f.family} title={f.family}>
          {f.sizes.map((size) =>
            f.weights.map((w) => (
              <text key={`${size}-${w}`} family={f.family} size={size} weight={w} lineHeight={Math.round(size * 1.4)} color={t.c.textStrong}>
                {`${size}/${w} ${TYPE_SAMPLE}`}
              </text>
            )),
          )}
        </Section>
      ))}
    </col>
  );
}

const PAGES: Record<GalleryPage, () => ReactNode> = {
  type: TypePage,
  buttons: Buttons,
  controls: Controls,
  overlays: Overlays,
  dialog: DialogPage,
  icons: IconsPage,
  markdown: MarkdownPage,
  empty: EmptyPage,
};

function Page({ page, themeKey }: { page: GalleryPage; themeKey: string }) {
  const t = useTokens();
  const Body = PAGES[page];
  return (
    <col id="gallery" w="full" h="full">
      <ThemeBackdrop id="gallery-backdrop" />
      <col id="gallery-scroll" w="full" h="full" scrollY>
        <col w="full" pad={32} gap={24}>
          <row gap={10} align="center">
            <StellaMark size={20} />
            <text {...look(fontSize.xl, 600)} color={t.c.textStrong}>{`Kit · ${page}`}</text>
            <text {...look(fontSize.sm, 500)} color={t.c.textWeaker}>{themeKey}</text>
          </row>
          <Body />
        </col>
      </col>
    </col>
  );
}

/** The kit gallery: one page of components in one theme, chosen by STELLA_RUNE_GALLERY ("page" or "page@theme"). */
export function Gallery() {
  const [page, themeKey] = (process.env.STELLA_RUNE_GALLERY ?? "buttons").split("@") as [GalleryPage, string | undefined];
  const key = (themeKey && themeKey in GALLERY_THEMES ? themeKey : "light") as keyof typeof GALLERY_THEMES;
  const theme = GALLERY_THEMES[key];
  return (
    <I18nProvider>
      <ThemeScope themeId={theme.themeId} mode={theme.mode} customBase={theme.base}>
        <Page page={page} themeKey={key} />
      </ThemeScope>
    </I18nProvider>
  );
}
