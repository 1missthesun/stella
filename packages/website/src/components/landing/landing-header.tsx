"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { SiteHeaderAccount } from "@/components/auth/site-header-account";
import { StellaMark } from "@/components/stella-mark";
import h from "./landing-header.module.css";

export function LandingHeader({ getHref = "#get" }: { getHref?: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let sections: HTMLElement[] = [];
    let bounds: { el: HTMLElement; top: number; bottom: number; follow: boolean }[] = [];
    let frame = 0;
    const root = document.querySelector<HTMLElement>("[data-landing-root]");

    const measure = () => {
      const sy = window.scrollY;
      bounds = sections.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          top: rect.top + sy,
          bottom: rect.bottom + sy,
          follow: el.hasAttribute("data-tone-follow"),
        };
      });
    };

    const collect = () => {
      sections = Array.from(document.querySelectorAll<HTMLElement>("main [data-tone], footer[data-tone]"));
      measure();
    };

    const update = () => {
      frame = 0;
      const sy = window.scrollY;
      const probe = sy + 32;
      let tone = "light";
      for (const s of bounds) {
        if (s.top <= probe && s.bottom > probe) {
          tone = (s.follow ? root?.dataset.scene : null) || s.el.dataset.tone || "light";
          break;
        }
      }
      if (header.dataset.tone !== tone) header.dataset.tone = tone;
      const scrolled = sy > 40 ? "1" : "0";
      if (header.dataset.scrolled !== scrolled) header.dataset.scrolled = scrolled;
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const onResize = () => {
      measure();
      onScroll();
    };

    collect();
    update();
    const ro = new ResizeObserver(onResize);
    if (document.body) ro.observe(document.body);
    const mo = new MutationObserver(onScroll);
    for (const section of sections) {
      mo.observe(section, { attributes: true, attributeFilter: ["data-tone"] });
    }
    if (root) mo.observe(root, { attributes: true, attributeFilter: ["data-scene"] });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header ref={ref} className={h.header} data-tone="light">
      <Link href="/" className={h.brand} aria-label="Stella home">
        <span className={h.mark}>
          <StellaMark size={30} />
        </span>
        <span className={h.word}>Stella</span>
      </Link>
      <nav className={h.nav} aria-label="Primary">
        <Link href="/learn-more">Learn</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/crew">Crew</Link>
        <span className={h.account}>
          <SiteHeaderAccount />
        </span>
        <a href={getHref} className={h.get}>
          Get Stella
        </a>
      </nav>
    </header>
  );
}
