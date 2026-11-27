import { memo, useEffect, useRef } from "react";
import {
  noteProduct,
  noteText,
  releaseDateLabel,
  releaseHeadline,
  releaseKey,
  stellaReleases,
  type StellaRelease,
  type StellaReleaseNote,
  type StellaReleaseProduct,
} from "@stella/contracts/stella-releases";
import { Dialog, DialogCloseButton, DialogContent, DialogTitle, Press, T, tx } from "../../kit/compat";
import { useLocale, useT } from "@/shared/i18n";
import { useWhatsNewOpen, useWhatsNewSelected, whatsNewDialog } from "@/features/whats-new/whats-new-store";
import { useWhatsNew } from "./whats-new.styles";

const PRODUCT_LABEL: Record<StellaReleaseProduct, string> = {
  Mobile: "shell.whatsNew.product.mobile",
  Launcher: "shell.whatsNew.product.launcher",
  Backend: "shell.whatsNew.product.backend",
};

const LIST_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];
const LIST_ID = "whats-new-list";
const PANE_ID = "whats-new-detail";
const itemId = (key: string) => `whats-new-item-${key}`;

const Notes = ({ notes, variant }: { notes: readonly StellaReleaseNote[]; variant: "highlights" | "more" }) => {
  const s = useWhatsNew();
  const t = useT();
  const text = variant === "highlights" ? s.whatsNewNoteHighlightText : s.whatsNewNoteMoreText;
  return (
    <col w="full" {...(variant === "highlights" ? s.whatsNewNotesHighlights : s.whatsNewNotesMore)} role="list">
      {notes.map((note, index) => {
        const product = noteProduct(note);
        return (
          <row key={index} {...s.whatsNewNote} role="listitem">
            <box {...(variant === "highlights" ? s.whatsNewDotHighlight : s.whatsNewDotMore)} />
            <T {...text}>
              {product ? <T {...s.whatsNewProduct}>{`${t(PRODUCT_LABEL[product])} `}</T> : null}
              {noteText(note)}
            </T>
          </row>
        );
      })}
    </col>
  );
};

const ReleaseDetail = ({ release }: { release: StellaRelease }) => {
  const s = useWhatsNew();
  const t = useT();
  const locale = useLocale();
  const highlights = release.highlights ?? [];
  const more = release.more ?? [];
  return (
    <col {...s.whatsNewDetail}>
      <T {...s.whatsNewDetailDate}>{releaseDateLabel(release, locale)}</T>
      <T w="full" {...s.whatsNewDetailTitle}>{releaseHeadline(release)}</T>
      {highlights.length > 0 ? <Notes notes={highlights} variant="highlights" /> : null}
      {more.length > 0 ? (
        <col {...s.whatsNewMore}>
          {highlights.length > 0 ? <T {...s.whatsNewMoreTitle}>{t("shell.whatsNew.moreInRelease")}</T> : null}
          <Notes notes={more} variant="more" />
        </col>
      ) : null}
    </col>
  );
};

const ReleaseHistory = () => {
  const s = useWhatsNew();
  const t = useT();
  const locale = useLocale();
  const chosen = useWhatsNewSelected();
  const selected = stellaReleases.find((release) => releaseKey(release) === chosen) ?? stellaReleases[0];
  const selectedKey = selected ? releaseKey(selected) : null;
  const firstRender = useRef(true);

  useEffect(() => {
    void stella.engine.scroll.to(PANE_ID, 0, { spring: 0 });
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    if (firstRender.current) {
      firstRender.current = false;
      void stella.engine.focus(itemId(selectedKey));
    }
    void stella.engine.scroll.intoView(itemId(selectedKey));
  }, [selectedKey]);

  const move = (key: string) => {
    if (!selected) return;
    const index = stellaReleases.indexOf(selected);
    const target: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: stellaReleases.length - 1,
    };
    const next = stellaReleases[target[key] ?? -1];
    if (!next) return;
    const nextKey = releaseKey(next);
    whatsNewDialog.select(nextKey);
    void stella.engine.focus(itemId(nextKey), true);
  };

  return (
    <row {...s.whatsNew}>
      <col {...s.whatsNewRail} role="navigation" label={t("shell.whatsNew.releases")}>
        <DialogTitle {...s.whatsNewTitle}>{t("shell.whatsNew.title")}</DialogTitle>
        <col id={LIST_ID} w="full" {...s.whatsNewList} role="tablist" keys={LIST_KEYS} onKey={({ key }) => move(key)}>
          {stellaReleases.map((release) => {
            const key = releaseKey(release);
            const active = key === selectedKey;
            const title = releaseHeadline(release);
            return (
              <Press
                key={key}
                id={itemId(key)}
                role="tab"
                selected={active}
                label={title}
                tabIndex={active ? 0 : -1}
                {...s.whatsNewItem}
                {...(active ? s.whatsNewItemActive : null)}
                onPress={() => whatsNewDialog.select(key)}
              >
                <col w="full" gap={2}>
                  <T w="full" {...tx(s.whatsNewItem, active ? s.whatsNewItemActive : null)} {...s.whatsNewItemTitle}>{title}</T>
                  <T {...s.whatsNewItemDate} {...(active ? s.whatsNewItemDateActive : null)}>{releaseDateLabel(release, locale, "short")}</T>
                </col>
              </Press>
            );
          })}
        </col>
      </col>
      <col id={PANE_ID} role="tabpanel" {...s.whatsNewPane}>
        {selected ? <ReleaseDetail release={selected} /> : null}
      </col>
    </row>
  );
};

/** desktop-ui's `WhatsNewDialogHost`: the release history (rail of releases, the chosen release's notes). */
export const WhatsNewDialogHost = memo(function WhatsNewDialogHost() {
  const s = useWhatsNew();
  const open = useWhatsNewOpen();
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(next) => whatsNewDialog.setOpen(next)}>
      <DialogContent size="xl" {...s.whatsNewDialog} aria-describedby={undefined}>
        <DialogCloseButton {...s.whatsNewDialogClose} />
        <ReleaseHistory />
      </DialogContent>
    </Dialog>
  );
});
