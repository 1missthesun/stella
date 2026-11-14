import { Composer, WindowBar, WindowFrame } from "../skins";
import s from "../skins.module.css";
import { CHAT } from "./content";

export function DefaultSkin() {
  return (
    <WindowFrame>
      <WindowBar />
      <div className={s.stellaColumn}>
        <p className={s.stamp}>{CHAT.stamp}</p>
        <p className={s.me}>{CHAT.me1}</p>
        <p className={s.her}>{CHAT.her1}</p>
        <p className={s.me}>{CHAT.me2}</p>
        <p className={s.her}>{CHAT.her2}</p>
        <Composer placeholder={CHAT.placeholder} />
      </div>
    </WindowFrame>
  );
}
