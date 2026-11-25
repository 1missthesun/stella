import { useEffect, useId, useState } from "react";
import { useT } from "@/shared/i18n";
import { showOpenPathError } from "@/features/chat/lib/open-local-path";
import { DropdownMenu, Icon, Icons, MenuItem, MenuSeparator, withStroke } from "../kit";
import { fontSize, useTokens } from "../theme";

type Opener = { id: string; label: string; kind: "app" | "default" | "reveal" };

export const OpenWithMenu = ({ filePath }: { filePath: string }) => {
  const t = useT();
  const tokens = useTokens();
  const id = `open-with:${useId()}`;
  const [open, setOpen] = useState(false);
  const [openerResult, setOpenerResult] = useState<{ filePath: string; openers: Opener[] } | null>(null);
  const openers = openerResult?.filePath === filePath ? openerResult.openers : null;

  useEffect(() => {
    if (!open || openers) return;
    let cancelled = false;
    const api = window.electronAPI?.system;
    if (!api?.listExternalOpeners) {
      setOpenerResult({ filePath, openers: [] });
      return;
    }
    void api
      .listExternalOpeners(filePath)
      .then((result) => {
        if (!cancelled) setOpenerResult({ filePath, openers: result?.openers ?? [] });
      })
      .catch(() => {
        if (!cancelled) setOpenerResult({ filePath, openers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, openers, filePath]);

  const select = (openerId: string) => {
    const api = window.electronAPI?.system;
    if (!api?.openWithExternal) return;
    void api
      .openWithExternal(filePath, openerId)
      .then((result) => {
        if (!result?.ok && result?.error) showOpenPathError(result.error);
      })
      .catch(() => undefined);
  };

  const appOpeners = openers?.filter((entry) => entry.kind === "app") ?? [];
  const builtins = openers?.filter((entry) => entry.kind !== "app") ?? [];
  return (
    <DropdownMenu
      id={id}
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      sideOffset={6}
      trigger={(trigger) => (
        <box
          id={trigger.id}
          role="button"
          focusable
          title={t("app.chat.openWith.otherWaysTitle")}
          label={t("app.chat.openWith.otherWaysLabel")}
          pad={2}
          radius={4}
          center
          hoverGroup
          focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
          onPress={trigger.toggle}
        >
          <box hoverColor={tokens.c.textStrong}>
            <Icon icon={withStroke(Icons.stella.ChevronDown, 2)} size={12} color={trigger.open ? tokens.c.textStrong : tokens.c.textWeak} />
          </box>
        </box>
      )}
    >
      {openers === null ? (
        <text py={6} px={12} size={fontSize.sm} color={tokens.c.textWeak}>
          {t("app.chat.openWith.loading")}
        </text>
      ) : (
        <>
          {appOpeners.map((opener) => (
            <MenuItem key={opener.id} onSelect={() => select(opener.id)}>
              {opener.label}
            </MenuItem>
          ))}
          {appOpeners.length > 0 && builtins.length > 0 ? <MenuSeparator /> : null}
          {builtins.map((opener) => (
            <MenuItem key={opener.id} onSelect={() => select(opener.id)}>
              {opener.label}
            </MenuItem>
          ))}
        </>
      )}
    </DropdownMenu>
  );
};
