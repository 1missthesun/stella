/** One continuous aurora strip runs behind the whole set; each slide shows its own segment. */
export function SetAura({ index, count }: { index: number; count: number }) {
  return (
    <span className="slide-aura" aria-hidden="true">
      <img src="/brand/store-aura-set.webp" alt="" draggable={false} data-art
        style={{ width: `${count * 100}%`, left: `${-index * 100}%` }} />
    </span>
  );
}
