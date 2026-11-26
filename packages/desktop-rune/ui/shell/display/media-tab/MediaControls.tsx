import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/shared/i18n";
import { Icon, Icons } from "../../../kit";
import { alpha, look, radius, useTokens } from "../../../theme";
import { systemFontFamily } from "../../../theme/system-font";

const PLAYING_POLL_MS = 33;
const IDLE_POLL_MS = 250;
const VIDEO_CONTROLS_IDLE_MS = 2500;
const EASE = { dur: 0.18, bounce: 0 };

const PLAY_FILLED = `<path d="M8.25 5.6v12.8c0 .87.96 1.4 1.7.93l10.06-6.4a1.1 1.1 0 0 0 0-1.86L9.95 4.67c-.74-.47-1.7.06-1.7.93Z" fill="currentColor"/>`;
const CHROME_PLAY = `<path d="M8 5v14l11-7z" fill="currentColor"/>`;
const CHROME_PAUSE = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor"/>`;
const CHROME_VOLUME = `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/>`;
const CHROME_MUTED = `<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" fill="currentColor"/>`;
const CHROME_FULLSCREEN = `<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" fill="currentColor"/>`;
const CHROME_MORE = `<path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/>`;

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

type Clock = { playing: boolean; current: number; duration: number };

/** The engine player's position, read often while it plays and rarely while it rests. */
function useMediaClock(id: string): [Clock, (next: Partial<Clock>) => void] {
  const [clock, setClock] = useState<Clock>({ playing: false, current: 0, duration: 0 });
  const playingRef = useRef(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      void stella.engine.media
        .state(id)
        .then((state) => {
          if (!live) return;
          playingRef.current = state.playing;
          setClock((prev) => {
            const duration = state.duration ?? prev.duration;
            const next = { playing: state.playing, current: state.time, duration };
            return prev.playing === next.playing && prev.current === next.current && prev.duration === next.duration ? prev : next;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (live) timer = setTimeout(read, playingRef.current ? PLAYING_POLL_MS : IDLE_POLL_MS);
        });
    };
    read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  const patch = useCallback((next: Partial<Clock>) => {
    if (next.playing !== undefined) playingRef.current = next.playing;
    setClock((prev) => ({ ...prev, ...next }));
  }, []);
  return [clock, patch];
}

function useTransport(id: string) {
  const [clock, patch] = useMediaClock(id);
  const toggle = useCallback(() => {
    if (clock.playing) {
      patch({ playing: false });
      void stella.engine.media.pause(id).catch(() => undefined);
    } else {
      const restart = clock.duration > 0 && clock.current >= clock.duration - 0.05;
      patch({ playing: true, ...(restart ? { current: 0 } : {}) });
      void (restart ? stella.engine.media.seek(id, 0) : Promise.resolve())
        .then(() => stella.engine.media.play(id))
        .catch(() => patch({ playing: false }));
    }
  }, [clock, id, patch]);
  const seekRatio = useCallback(
    (ratio: number) => {
      if (clock.duration <= 0) return;
      const time = Math.min(1, Math.max(0, ratio)) * clock.duration;
      patch({ current: time });
      void stella.engine.media.seek(id, time).catch(() => undefined);
    },
    [clock.duration, id, patch],
  );
  return { clock, toggle, seekRatio };
}

/** desktop-ui's `AudioPlayer`: round play button, scrubber with a knob on hover, elapsed and remaining time. */
export function AudioPlayer({ id, src }: { id: string; src: string }) {
  const t = useT();
  const tk = useTokens();
  const { clock, toggle, seekRatio } = useTransport(id);
  const [hover, setHover] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const trackW = useRef(0);
  const progress = clock.duration > 0 ? Math.min(1, clock.current / clock.duration) : 0;
  const remaining = Math.max(0, clock.duration - clock.current);
  const lifted = hover || scrubbing;
  return (
    <row w="full" align="center" gap={16} px={18} py={16} radius={16} fill={alpha(tk.c.foreground, 0.04)}>
      <audio id={id} src={src} absolute={{ left: 0, top: 0 }} w={1} h={1} inert />
      <box
        role="button"
        focusable
        label={clock.playing ? t("shell.audioPlayer.pause") : t("shell.audioPlayer.play")}
        shrink={false}
        w={42}
        h={42}
        radius={radius.full}
        center
        fill={alpha(tk.c.foreground, 0.09)}
        hoverFill={alpha(tk.c.foreground, 0.14)}
        pressScale={0.93}
        motion={EASE}
        onPress={toggle}
      >
        {clock.playing ? <Icon icon={Icons.stella.Pause} size={17} color={tk.c.textStrong} /> : <icon svg={PLAY_FILLED} view={24} size={17} color={tk.c.textStrong} />}
      </box>
      <col grow={1} minW={0} gap={9}>
        <box
          role="slider"
          label={t("shell.audioPlayer.seek")}
          focusable
          w="full"
          h={4}
          center
          onHover={setHover}
          onLayout={(r) => (trackW.current = r.w)}
          keys={["ArrowRight", "ArrowLeft", " ", "Enter"]}
          onKey={({ key }) => {
            if (clock.duration <= 0) return;
            if (key === "ArrowRight") seekRatio((clock.current + 5) / clock.duration);
            else if (key === "ArrowLeft") seekRatio((clock.current - 5) / clock.duration);
            else toggle();
          }}
          onDrag={(d) => {
            setScrubbing(d.phase !== "end");
            seekRatio(d.x / (trackW.current || 1));
          }}
        >
          <box absolute={{ left: 0, right: 0, top: -7, bottom: -7 }} />
          <box w="full" h={lifted ? 6 : 4} radius={radius.full} fill={alpha(tk.c.foreground, 0.14)} motion={EASE}>
            <box absolute={{ left: 0, top: 0, bottom: 0 }} w={`${progress * 100}%`} radius={radius.full} fill={tk.c.textStrong} instant />
            <box
              absolute={{ left: 0, top: -3 }}
              x={progress * trackW.current - 6}
              y={lifted ? 0 : -1}
              w={12}
              h={12}
              radius={radius.full}
              fill={tk.c.textStrong}
              shadow={[1, 4, alpha(tk.c.background, 0.55)]}
              scale={lifted ? 1 : 0}
              motion={EASE}
            />
          </box>
        </box>
        <row justify="between">
          <text {...look(11, 400, { em: 0.01 })} features="'tnum' 1" color={tk.c.textWeak}>
            {formatTime(clock.current)}
          </text>
          <text {...look(11, 400, { em: 0.01 })} features="'tnum' 1" color={tk.c.textWeak}>
            -{formatTime(remaining)}
          </text>
        </row>
      </col>
    </row>
  );
}

const CHROME_LABEL = look(13.2, 400, { family: systemFontFamily() });

function ChromeButton({ svg, size, label, onPress }: { svg: string; size: number; label: string; onPress: () => void }) {
  return (
    <box role="button" label={label} focusable shrink={false} w={40} h={40} center radius={radius.full} onPress={onPress}>
      <icon svg={svg} view={24} size={size} color="#ffffff" />
    </box>
  );
}

/** A `<video controls>` element: the engine player under Chromium's bottom bar (play, time, seek, mute, full size, more), shown while paused or the pointer is over it. */
export function VideoPlayer({ id, src, onFullSize, onMore }: { id: string; src: string; onFullSize: () => void; onMore?: () => void }) {
  const t = useT();
  const { clock, toggle, seekRatio } = useTransport(id);
  const [muted, setMuted] = useState(false);
  const [awake, setAwake] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barW = useRef(0);
  const wake = useCallback(() => {
    setAwake(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAwake(false), VIDEO_CONTROLS_IDLE_MS);
  }, []);
  useEffect(() => () => void (idleTimer.current && clearTimeout(idleTimer.current)), []);
  const shown = !clock.playing || awake;
  const progress = clock.duration > 0 ? Math.min(1, clock.current / clock.duration) : 0;
  return (
    <box
      grow={1}
      minH={0}
      w="full"
      radius={8}
      clip={8}
      onHover={(inside) => (inside ? wake() : setAwake(false))}
    >
      <video
        id={id}
        src={src}
        fit="contain"
        loopMedia
        muted={muted}
        w="full"
        h="full"
        onPress={() => {
          wake();
          toggle();
        }}
      />
      <col absolute={{ left: 0, right: 0, bottom: 0 }} h={105} opacity={shown ? 1 : 0} motion={EASE} inert={!shown}>
        <box
          absolute={{ left: 0, right: 0, top: 0, bottom: 0 }}
          inert
          gradient={{ angle: 180, stops: [[0, "rgba(0,0,0,0)"], [0.43, "rgba(0,0,0,0.45)"], [0.62, "rgba(0,0,0,0.74)"], [0.81, "rgba(0,0,0,0.94)"], [1, "rgba(0,0,0,0.99)"]] }}
        />
        <box grow={1} />
        <row h={40} align="center" pl={5} pr={4}>
          <ChromeButton svg={clock.playing ? CHROME_PAUSE : CHROME_PLAY} size={22} label={clock.playing ? t("shell.audioPlayer.pause") : t("shell.audioPlayer.play")} onPress={toggle} />
          <text {...CHROME_LABEL} color="#ffffff" features="'tnum' 1" ml={3}>
            {`${formatTime(clock.current)} / ${formatTime(clock.duration)}`}
          </text>
          <box grow={1} />
          <ChromeButton svg={muted ? CHROME_MUTED : CHROME_VOLUME} size={21} label={muted ? "Unmute" : "Mute"} onPress={() => setMuted((m) => !m)} />
          <box w={8} />
          <ChromeButton svg={CHROME_FULLSCREEN} size={19} label={t("shell.display.media.expand")} onPress={onFullSize} />
          <box w={8} />
          {onMore ? <ChromeButton svg={CHROME_MORE} size={21} label="More options" onPress={onMore} /> : null}
        </row>
        <box
          role="slider"
          label={t("shell.audioPlayer.seek")}
          mx={16}
          mt={4}
          mb={20}
          h={4}
          radius={radius.full}
          fill="rgba(255,255,255,0.3)"
          onLayout={(r) => (barW.current = r.w)}
          onDrag={(d) => {
            wake();
            seekRatio(d.x / (barW.current || 1));
          }}
        >
          <box absolute={{ left: 0, right: 0, top: -8, bottom: -8 }} />
          <box absolute={{ left: 0, top: 0, bottom: 0 }} w={`${progress * 100}%`} radius={radius.full} fill="#ffffff" instant />
        </box>
      </col>
    </box>
  );
}
