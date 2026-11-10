"use client";

import { useEffect, useRef, useState } from "react";
import type { ProofMoment, VideoCut } from "@/lib/problems/types";
import h from "./how.module.css";

const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const SEEK = "how:seek";
const TIME = "how:time";

const PHONE = "(max-width: 700px)";

/** Which cut fits this screen: null until mounted, so the server never guesses. */
function usePhone() {
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

const momentAt = (moments: ProofMoment[], t: number) => {
  let index = 0;
  moments.forEach((moment, i) => {
    if (moment.at <= t + 0.05) index = i;
  });
  return index;
};

/**
 * The real recording, framed as a window on a wallpaper like the home page's
 * product visuals. No browser video chrome: a play/pause button, a thin
 * progress line, and the moment playing written out underneath, so the story
 * reads on a phone where the app's own text is too small to read.
 */
export function RecordingStage({
  src,
  poster,
  captions,
  width,
  height,
  label,
  moments,
  made,
  cuts,
}: {
  src: string;
  poster: string;
  captions: string;
  width: number;
  height: number;
  label: string;
  moments: ProofMoment[];
  made: string;
  /** Cropped cuts of the same footage; without them the full window plays everywhere. */
  cuts?: { wide: VideoCut; square: VideoCut };
}) {
  const phone = usePhone();
  const file = cuts ? (phone === null ? null : phone ? cuts.square : cuts.wide) : { src, poster, width, height };
  const fileSrc = file?.src;
  const wideShape = cuts ? cuts.wide : { width, height };
  const ref = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || !fileSrc) return;
    const onSeek = (event: Event) => {
      const at = (event as CustomEvent<number>).detail;
      video.currentTime = at;
      video.play().catch(() => {});
      video.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener(SEEK, onSeek);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => window.removeEventListener(SEEK, onSeek);
    }
    let started = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          started = true;
          video.play().catch(() => {});
        } else if (!entry.isIntersecting && !video.paused) {
          video.pause();
          started = false;
        }
      },
      { threshold: 0.5 },
    );
    io.observe(video);
    return () => {
      io.disconnect();
      window.removeEventListener(SEEK, onSeek);
    };
  }, [fileSrc]);

  const onTime = () => {
    const video = ref.current;
    if (!video) return;
    const t = video.currentTime;
    barRef.current?.style.setProperty("--p", String(video.duration ? t / video.duration : 0));
    const index = momentAt(moments, t);
    setCurrent(index);
    window.dispatchEvent(new CustomEvent(TIME, { detail: index }));
  };

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const moment = moments[current];

  return (
    <>
      <div className={h.wall}>
        <div
          className={h.window}
          data-square={cuts ? "" : undefined}
          style={{ aspectRatio: `${wideShape.width} / ${wideShape.height}` }}
        >
          <video
            ref={ref}
            className={h.video}
            src={file?.src}
            poster={file?.poster}
            width={file?.width ?? wideShape.width}
            height={file?.height ?? wideShape.height}
            muted
            playsInline
            loop
            preload="metadata"
            aria-label={label}
            onClick={toggle}
            onTimeUpdate={onTime}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          >
            <track kind="captions" src={captions} srcLang="en" label="English" default />
          </video>
          <button type="button" className={h.play} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1.2" />
                <rect x="14" y="5" width="4" height="14" rx="1.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.6v14.8c0 .8.9 1.3 1.6.9l11.6-7.4c.6-.4.6-1.3 0-1.7L8.6 3.8C7.9 3.3 7 3.8 7 4.6z" />
              </svg>
            )}
          </button>
          <span className={h.progress} aria-hidden="true">
            <i ref={barRef} />
          </span>
        </div>
      </div>
      <p className={h.caption} aria-hidden="true">
        <time>{stamp(moment.at)}</time>
        <span>{moment.text}</span>
      </p>
      <p className={h.made}>{made}</p>
    </>
  );
}

/** The recording's moments as a list; each one jumps the video there. */
export function MomentList({ moments }: { moments: ProofMoment[] }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const onTime = (event: Event) => setCurrent((event as CustomEvent<number>).detail);
    window.addEventListener(TIME, onTime);
    return () => window.removeEventListener(TIME, onTime);
  }, []);
  return (
    <ol className={h.timeline} aria-label="What happens in the recording">
      {moments.map((moment, i) => (
        <li key={moment.at}>
          <button
            type="button"
            data-current={i === current ? "" : undefined}
            onClick={() => window.dispatchEvent(new CustomEvent(SEEK, { detail: moment.at }))}
          >
            <time>{stamp(moment.at)}</time>
            <span>{moment.text}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A file Stella made (e.g. the captioned video), framed, with the same quiet play button. */
export function OutputVideo({ src, poster, width, height }: { src: string; poster: string; width: number; height: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };
  return (
    <div className={h.frame} style={{ position: "relative" }}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        width={width}
        height={height}
        playsInline
        preload="none"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        style={{ cursor: "pointer" }}
      />
      <button type="button" className={h.play} onClick={toggle} aria-label={playing ? "Pause" : "Play the video Stella made"}>
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4.6v14.8c0 .8.9 1.3 1.6.9l11.6-7.4c.6-.4.6-1.3 0-1.7L8.6 3.8C7.9 3.3 7 3.8 7 4.6z" />
          </svg>
        )}
      </button>
    </div>
  );
}
