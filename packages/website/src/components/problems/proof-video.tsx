"use client";

import { useEffect, useRef, useState } from "react";
import type { ProofMoment } from "@/lib/problems/types";
import s from "./problems.module.css";

const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * A real recording of Stella doing the task, with its transcript as a list of
 * moments: clicking one jumps the video there, and the moment playing is marked.
 * Plays muted once it's on screen (unless the reader prefers reduced motion).
 */
export function ProofVideo({
  src,
  poster,
  captions,
  width,
  height,
  label,
  moments,
}: {
  src: string;
  poster: string;
  captions: string;
  width: number;
  height: number;
  label: string;
  moments: ProofMoment[];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    return () => io.disconnect();
  }, []);

  const onTime = () => {
    const t = ref.current?.currentTime ?? 0;
    let index = 0;
    moments.forEach((moment, i) => {
      if (moment.at <= t + 0.05) index = i;
    });
    setCurrent(index);
  };

  const seek = (at: number) => {
    const video = ref.current;
    if (!video) return;
    video.currentTime = at;
    video.play().catch(() => {});
  };

  return (
    <div className={s.proofPlayer}>
      <div className={s.videoFrame} style={{ aspectRatio: `${width} / ${height}` }}>
        <video
          ref={ref}
          className={s.video}
          src={src}
          poster={poster}
          width={width}
          height={height}
          muted
          playsInline
          loop
          controls
          preload="metadata"
          aria-label={label}
          onTimeUpdate={onTime}
        >
          <track kind="captions" src={captions} srcLang="en" label="English" default />
        </video>
      </div>
      <ol className={s.moments} aria-label="What happens in the recording">
        {moments.map((moment, i) => (
          <li key={moment.at}>
            <button
              type="button"
              className={s.moment}
              data-current={i === current ? "" : undefined}
              onClick={() => seek(moment.at)}
            >
              <span className={s.momentAt}>{stamp(moment.at)}</span>
              <span>{moment.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
