/**
 * Page-side source for `aimPoint(el, rect, hitSource, viewportWidth,
 * viewportHeight)`: where a person would click `el`. Points spread over the
 * element like real clicks (roughly normal around the middle, wider along
 * the longer side), stay a few pixels inside its edges, avoid the exact
 * centre that bot checks look for, and must hit `el` itself. Falls back to
 * the centre, and returns null when even that is covered.
 */
export const AIM_POINT_SOURCE = `
  const aimPoint = (el, rect, hitSource, viewportWidth, viewportHeight) => {
    const gauss = () => {
      let u = 0;
      let v = 0;
      while (!u) u = Math.random();
      while (!v) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const hits = (x, y) => {
      const hit = hitSource.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    };
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, viewportWidth - 1);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, viewportHeight - 1);
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const roomX = Math.max(0, (right - left) / 2 - 3);
    const roomY = Math.max(0, (bottom - top) / 2 - 3);
    const middleX = (left + right) / 2;
    const middleY = (top + bottom) / 2;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const x = middleX + Math.max(-roomX, Math.min(roomX, gauss() * (right - left) * 0.18));
      const y = middleY + Math.max(-roomY, Math.min(roomY, gauss() * (bottom - top) * 0.2));
      const nearCentre = Math.abs(x - centreX) <= 4 && Math.abs(y - centreY) <= 4;
      if (nearCentre && (roomX > 6 || roomY > 6)) continue;
      if (hits(x, y)) return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }
    const x = Math.max(0, Math.min(viewportWidth - 1, centreX));
    const y = Math.max(0, Math.min(viewportHeight - 1, centreY));
    return hits(x, y) ? { x, y } : null;
  };
`;
