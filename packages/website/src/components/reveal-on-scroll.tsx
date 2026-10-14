"use client";

import { useEffect } from "react";

export function RevealOnScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (reduceMotion.matches) return;

    root.classList.add("has-reveal");

    const observed = new WeakSet<Element>();

    // We toggle a non-React attribute (`data-revealed`) rather than a
    // className so we never collide with React's hydration of dynamically
    // imported sections. The CSS selector is `[data-reveal][data-revealed]`.
    const reveal = (el: Element) => el.setAttribute("data-revealed", "");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      },
      {
        rootMargin: "0px 0px -8% 0px",
        threshold: 0.08,
      },
    );

    const observeNode = (node: Element) => {
      const candidates: Element[] = [];
      if (node.matches("[data-reveal]")) candidates.push(node);
      candidates.push(...node.querySelectorAll("[data-reveal]"));

      candidates.forEach((candidate) => {
        const node = candidate as HTMLElement;
        if (observed.has(node)) return;
        observed.add(node);

        const rect = node.getBoundingClientRect();
        const inView = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
        if (inView) {
          reveal(node);
          return;
        }

        observer.observe(node);
      });
    };

    observeNode(document.body);

    const mutation = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added instanceof Element) observeNode(added);
        }
      }
    });
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
      root.classList.remove("has-reveal");
    };
  }, []);

  return null;
}
