"use client";

import { useEffect } from "react";

export function Backdrop() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing-root]");
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-bg]"));
    if (!sections.length) return;
    const hits = new Set<Element>();
    let current = "";

    const apply = (section: HTMLElement) => {
      const color = section.dataset.bg || "#ffffff";
      const tone = section.dataset.tone || "light";
      if (root.dataset.scene !== tone) root.dataset.scene = tone;
      if (color === current) return;
      current = color;
      root.style.backgroundColor = color;
    };

    root.style.transition = "none";
    apply(sections[0]);
    requestAnimationFrame(() => {
      root.style.transition = "background-color 900ms cubic-bezier(0.4, 0, 0.2, 1)";
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) hits.add(entry.target);
          else hits.delete(entry.target);
        }
        const active = sections.findLast((s) => hits.has(s));
        if (active) apply(active);
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return null;
}
