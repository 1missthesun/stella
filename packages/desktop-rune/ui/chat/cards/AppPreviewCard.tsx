import { memo, useEffect, useId, useState } from "react";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import { loadCloudAppPreview, useLinkedCloudApp } from "@/features/cloud/workspace-app-links";
import { DropdownMenu, Icon, Icons, MenuItem, withStroke } from "../../kit";
import { derive, fontSize, mix, radius, useTokens } from "../../theme";

export const AppPreviewCard = memo(function AppPreviewCard({ slug }: { slug: string }) {
  const tokens = useTokens();
  const id = `app-preview:${useId()}`;
  const app = useLinkedCloudApp(slug);
  const [preview, setPreview] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const appSlug = app?.slug;
  const revision = app?.revision;
  useEffect(() => {
    setPreview(null);
    if (appSlug === undefined || revision === undefined) return;
    let cancelled = false;
    void loadCloudAppPreview(appSlug, revision).then((url) => {
      if (!cancelled) setPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [appSlug, revision]);
  if (app === null) return null;
  const look = derive(tokens, "app-preview-card", (k) => ({ moreHover: mix(k.c.textStrong, 8, "transparent") }));
  const open = () => openCloudAppPanel({ appId: slug });
  const icon = (emojiSize: number) =>
    app?.icon ? (
      <text size={emojiSize} lineHeight={emojiSize * 1.2}>
        {app.icon}
      </text>
    ) : (
      <Icon icon={withStroke(Icons.stella.AppWindowMac, 1.7)} size={18} color={tokens.c.textMuted} />
    );
  return (
    <box w="full" maxW={440} radius={20} clip={20} fill={tokens.c.chatAssistantBubbleFillTop} gradient={tokens.gradient.assistantBubble} border={tokens.c.border}>
      <col
        role="button"
        focusable={Boolean(app)}
        disabled={!app}
        label={app ? `Open ${app.title}` : "Loading app"}
        w="full"
        pad={5 + 1}
        cursor={app ? "pointer" : "default"}
        onPress={app ? open : undefined}
      >
        <box w="full" aspect={16 / 10} radius={16} clip={16} fill={tokens.c.surfaceInset}>
          <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} center>
            {icon(40)}
          </box>
          {preview ? <image key={preview} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} src={preview} fit="cover" enter={{ opacity: 0, dur: 0.25, bounce: 0 }} /> : null}
        </box>
        <row align="center" gap={10} pt={9} pr={44} pb={5} pl={6}>
          <box shrink={false} w={38} h={38} center radius={radius.lg} border={tokens.c.border} fill={tokens.c.surfaceInset}>
            {icon(21)}
          </box>
          <col minW={0}>
            <text size={15} weight={500} lineHeight={21.75} color={tokens.c.textStrong} nowrap truncate>
              {app?.title ?? ""}
            </text>
            <text size={fontSize.sm} color={tokens.c.textMuted}>
              App
            </text>
          </col>
        </row>
      </col>
      {app ? (
        <box absolute={{ right: 12, bottom: 12 }}>
          <DropdownMenu
            id={id}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align="end"
            sideOffset={6}
            trigger={(trigger) => (
              <box id={trigger.id} role="button" focusable label={`More for ${app.title}`} w={30} h={30} center radius={radius.full} hoverFill={look.moreHover} cursor="pointer" onPress={trigger.toggle}>
                <Icon icon={Icons.stella.MoreHorizontal} size={16} color={tokens.c.textMuted} />
              </box>
            )}
          >
            <MenuItem onSelect={open}>Open</MenuItem>
          </DropdownMenu>
        </box>
      ) : null}
    </box>
  );
});
