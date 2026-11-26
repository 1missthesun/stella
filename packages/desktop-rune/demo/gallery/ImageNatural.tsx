import { useEffect, useState } from "react";

const SRC = process.env.IMG_SRC ?? "";
const FIXED = process.env.IMG_FIXED !== "0";
const LATE = process.env.IMG_LATE === "1";

export function Root() {
  const [shown, setShown] = useState(!LATE);
  useEffect(() => {
    if (!LATE) return;
    const t = setTimeout(() => setShown(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const frame = (
    <box id="frame" maxW="100%" maxH="100%">
      {shown ? <image id="pic" src={SRC} {...(process.env.IMG_W ? { w: Number(process.env.IMG_W), h: Number(process.env.IMG_W) / 2 } : {})} fit="contain" radius={16} border="#ffffff" /> : <image src={SRC} w={1} h={1} />}
    </box>
  );
  if (process.env.IMG_MD === "1") {
    return (
      <window id="main" title="markdown image" bg="#202020" w={900} h={600}>
        <col pad={20} w={600}>
          <markdown id="md" src={"Before\n\n![pic](pic)\n\nAfter"} images={{ pic: SRC }} />
        </col>
      </window>
    );
  }
  return (
    <window id="main" title="image natural size" bg="#202020" w={900} h={600}>
      {FIXED ? (
        <col id="layer" fixed inset={0} center pad={40}>
          {frame}
        </col>
      ) : (
        <col id="layer" grow={1} center pad={40}>
          {frame}
        </col>
      )}
    </window>
  );
}
