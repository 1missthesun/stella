import type { ReactNode } from "react";
import { font, fontSize, look, radius, useTokens } from "../theme";
import { useT } from "../i18n";
import { IconButton } from "./Button";
import { Icon, Icons } from "./icons";
import { DismissLayer } from "./dismiss-layer";

const SIZES = { md: { w: 480, h: 512 }, lg: { w: 720, h: 512 }, xl: { w: 860, h: 640 }, page: { w: 1120, h: 820 } } as const;

export type DialogSize = keyof typeof SIZES;

export type DialogProps = {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: DialogSize;
  fit?: boolean;
  label?: string;
  closeOnBackdrop?: boolean;
  children: ReactNode;
};

/** A window-covering scrim that fades in (desktop-ui's dialog and lightbox overlays). */
export function Scrim({ id, color, onPress }: { id: string; color: string; onPress?: () => void }) {
  return <box id={id} fixed inset={0} raise={50} fill={color} enter={{ opacity: 0, dur: 0.25 }} exit={{ opacity: 0, dur: 0.15 }} onPress={onPress} />;
}

/**
 * desktop-ui's `Dialog` (Radix): scrim plus a centred overlay-surface panel, 480×512 (md), 720 (lg),
 * 860×640 (xl) or 1120×820 (page), shrinking with the window. The panel hangs from the top of its
 * box and grows to its content (`fit` centres it instead); Escape and the scrim close it.
 */
export function Dialog({ id, open, onOpenChange, size = "md", fit = false, label, closeOnBackdrop = true, children }: DialogProps) {
  const t = useTokens();
  if (!open) return null;
  const s = SIZES[size];
  const close = () => onOpenChange(false);
  return (
    <>
      <Scrim id={`${id}-scrim`} color={t.c.scrim} />
      <col id={`${id}-layer`} fixed inset={0} raise={51} center pad={8} onPress={closeOnBackdrop ? close : undefined}>
        <col id={`${id}-container`} w={s.w} maxW="100%" h={fit ? undefined : s.h} maxH="100%" align="center" justify="start">
          <col
            id={id}
            role="dialog"
            label={label}
            modal={{ clickOutside: closeOnBackdrop }}
            onDismiss={close}
            w="full"
            h={size === "page" ? "full" : undefined}
            maxH="100%"
            minH={fit ? undefined : 280}
            align="start"
            radius={radius["2xl"]}
            border={t.c.borderWeak}
            fill={t.c.overlayTop}
            gradient={t.gradient.overlay}
            shadows={t.shadow.xl}
            clip={radius["2xl"]}
            pad={1}
            enter={{ opacity: 0, scale: 0.96, dur: 0.3 }}
            exit={{ opacity: 0, scale: 0.96, dur: 0.15 }}
            onPress={() => {}}
          >
            <DismissLayer.Provider value={close}>{children}</DismissLayer.Provider>
          </col>
        </col>
      </col>
    </>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return (
    <row w="full" pt={20} pr={16} pb={16} pl={24} justify="between" align="center" shrink={false}>
      {children}
    </row>
  );
}

export function DialogTitle({ children }: { children: ReactNode }) {
  const t = useTokens();
  return (
    <text {...look(fontSize["2xl"], 600, { lh: 1.2, em: -0.03, family: font.display })} color={t.c.textStrong} role="heading" grow={1} shrink>
      {children}
    </text>
  );
}

export function DialogDescription({ children }: { children: ReactNode }) {
  const t = useTokens();
  return (
    <text {...look(fontSize.md, font.sansWeight, { lh: 1.43 })} color={t.c.mutedForeground} w="full" pt={0} pr={16} pb={16} pl={24} mt={-8}>
      {children}
    </text>
  );
}

export function DialogBody({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <col id={id} w="full" grow={1} minH={0} scrollY>
      {children}
    </col>
  );
}

export function DialogCloseButton({ id, onPress }: { id?: string; onPress: () => void }) {
  const t = useT();
  return <IconButton id={id} icon={Icons.stella.X} label={t("common.close")} size={24} iconSize={16} onPress={onPress} />;
}

export type ImageLightboxProps = { id: string; open: boolean; onOpenChange: (open: boolean) => void; src: string; alt?: string };

/** desktop-ui's `ImageLightbox`: the image at its size (window minus 80pt at most) over a darker scrim, a round close button on its corner. */
export function ImageLightbox({ id, open, onOpenChange, src, alt }: ImageLightboxProps) {
  const tk = useTokens();
  const t = useT();
  if (!open) return null;
  const close = () => onOpenChange(false);
  return (
    <>
      <Scrim id={`${id}-scrim`} color="#0000008c" />
      <col id={`${id}-layer`} fixed inset={0} raise={61} center pad={40} onPress={close}>
        <box
          id={id}
          role="dialog"
          label={alt || t("ui.imageLightbox.title")}
          modal={{ clickOutside: true }}
          onDismiss={close}
          maxW="100%"
          maxH="100%"
          enter={{ opacity: 0, scale: 0.96, dur: 0.3 }}
          exit={{ opacity: 0, scale: 0.96, dur: 0.15 }}
          onPress={() => {}}
        >
          <image id={`${id}-image`} src={src} fit="contain" radius={radius["2xl"]} border={tk.c.borderWeak} shadows={tk.shadow.xl} />
          <box
            id={`${id}-close`}
            role="button"
            label={t("ui.imageLightbox.close")}
            title={t("ui.imageLightbox.close")}
            focusable
            absolute={{ top: -14, right: -14 }}
            w={32}
            h={32}
            radius={16}
            center
            fill={tk.c.glassTop}
            gradient={tk.gradient.glass}
            border={tk.c.borderWeak}
            shadows={tk.shadow.md}
            hoverColor={tk.c.foreground}
            cursor="pointer"
            onPress={close}
          >
            <Icon icon={Icons.stella.X} size={18} color={tk.c.mutedForeground} />
          </box>
        </box>
      </col>
    </>
  );
}

