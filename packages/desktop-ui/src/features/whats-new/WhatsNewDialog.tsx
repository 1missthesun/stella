import { memo, useEffect, useRef, type KeyboardEvent } from "react";
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
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from "@/ui/dialog";
import { useLocale, useT } from "@/shared/i18n";
import { useWhatsNewOpen, useWhatsNewSelected, whatsNewDialog } from "./whats-new-store";
import "./whats-new.css";

const PRODUCT_LABEL: Record<StellaReleaseProduct, string> = {
  Mobile: "shell.whatsNew.product.mobile",
  Launcher: "shell.whatsNew.product.launcher",
  Backend: "shell.whatsNew.product.backend",
};

const Notes = ({ notes, variant }: { notes: readonly StellaReleaseNote[]; variant: "highlights" | "more" }) => {
  const t = useT();
  return (
    <ul className={`whats-new__notes whats-new__notes--${variant}`}>
      {notes.map((note, index) => {
        const product = noteProduct(note);
        return (
          <li key={index}>
            {product ? <span className="whats-new__product">{t(PRODUCT_LABEL[product])}</span> : null}
            {noteText(note)}
          </li>
        );
      })}
    </ul>
  );
};

const ReleaseDetail = ({ release }: { release: StellaRelease }) => {
  const t = useT();
  const locale = useLocale();
  const highlights = release.highlights ?? [];
  const more = release.more ?? [];
  return (
    <article className="whats-new__detail" aria-labelledby="whats-new-detail-title">
      <p className="whats-new__detail-date">{releaseDateLabel(release, locale)}</p>
      <h3 id="whats-new-detail-title" className="whats-new__detail-title">
        {releaseHeadline(release)}
      </h3>
      {highlights.length > 0 ? <Notes notes={highlights} variant="highlights" /> : null}
      {more.length > 0 ? (
        <section className="whats-new__more">
          {highlights.length > 0 ? <h4 className="whats-new__more-title">{t("shell.whatsNew.moreInRelease")}</h4> : null}
          <Notes notes={more} variant="more" />
        </section>
      ) : null}
    </article>
  );
};

const ReleaseHistory = () => {
  const t = useT();
  const locale = useLocale();
  const chosen = useWhatsNewSelected();
  const selected = stellaReleases.find((release) => releaseKey(release) === chosen) ?? stellaReleases[0];
  const selectedKey = selected ? releaseKey(selected) : null;
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    detail.current?.scrollTo({ top: 0 });
  }, [selectedKey]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selected) return;
    const index = stellaReleases.indexOf(selected);
    const target: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: stellaReleases.length - 1,
    };
    const next = stellaReleases[target[event.key] ?? -1];
    if (!next) return;
    event.preventDefault();
    const key = releaseKey(next);
    whatsNewDialog.select(key);
    list.current?.querySelector<HTMLElement>(`[data-release="${CSS.escape(key)}"]`)?.focus();
  };

  return (
    <div className="whats-new">
      <nav className="whats-new__rail" aria-label={t("shell.whatsNew.releases")}>
        <DialogTitle className="whats-new__title">{t("shell.whatsNew.title")}</DialogTitle>
        <div
          ref={list}
          className="whats-new__list"
          role="tablist"
          aria-orientation="vertical"
          onKeyDown={move}
          data-testid="whats-new-list"
        >
          {stellaReleases.map((release) => {
            const key = releaseKey(release);
            const active = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="whats-new-detail"
                tabIndex={active ? 0 : -1}
                className="whats-new__item"
                data-active={active || undefined}
                data-release={key}
                onClick={() => whatsNewDialog.select(key)}
                data-testid="whats-new-item"
              >
                <span className="whats-new__item-title">{releaseHeadline(release)}</span>
                <span className="whats-new__item-date">{releaseDateLabel(release, locale, "short")}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <div
        ref={detail}
        id="whats-new-detail"
        role="tabpanel"
        className="whats-new__pane"
        data-testid="whats-new-detail"
      >
        {selected ? <ReleaseDetail release={selected} /> : null}
      </div>
    </div>
  );
};

export const WhatsNewDialogHost = memo(function WhatsNewDialogHost() {
  const open = useWhatsNewOpen();
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(next) => whatsNewDialog.setOpen(next)}>
      <DialogContent
        size="xl"
        className="whats-new-dialog"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (!(event.currentTarget instanceof HTMLElement)) return;
          event.currentTarget
            .querySelector<HTMLElement>('.whats-new__item[aria-selected="true"]')
            ?.focus({ preventScroll: true });
        }}
        data-testid="whats-new-dialog"
      >
        <DialogCloseButton className="whats-new-dialog__close" />
        <ReleaseHistory />
      </DialogContent>
    </Dialog>
  );
});
