import { Root as StellaRoot } from "./app/Root";
import { Gallery } from "./gallery/Gallery";

export function initialState() {
  return { error: null, swaps: 0, lastSwapMs: null };
}

export function Root() {
  if (process.env.STELLA_RUNE_GALLERY) {
    return (
      <window id="main">
        <Gallery />
      </window>
    );
  }
  return <StellaRoot />;
}
