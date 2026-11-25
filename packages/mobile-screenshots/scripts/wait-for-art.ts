import type { Page } from "playwright";

/** Fonts loaded, every image decoded, every Stella mark drawn. A missing image fails the export. */
export async function waitForArt(page: Page) {
  await page.waitForFunction(() => {
    const marks = [...document.querySelectorAll("[data-brand-ready]")];
    return marks.length > 0 && marks.every((mark) => mark.getAttribute("data-brand-ready") === "true");
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.waitForTimeout(400); // CSS background images
}

/** Text that its own box cuts, or that leaves the canvas. Returns one line per problem. */
export function findClippedText(page: Page, slide: string) {
  return page.locator(`[data-export-slide="${slide}"]`).evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const problems: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        for (let box = walker.currentNode.parentElement; box && box !== root.parentElement; box = box.parentElement) {
          if (box !== root && getComputedStyle(box).overflow !== "hidden") continue;
          const limit = box === root ? bounds : box.getBoundingClientRect();
          if (rect.left < limit.left - 1 || rect.right > limit.right + 1 || rect.top < limit.top - 1 || rect.bottom > limit.bottom + 1)
            problems.push(`"${text}" is cut by .${box.className || box.tagName}`);
        }
      }
    }
    return [...new Set(problems)];
  });
}
