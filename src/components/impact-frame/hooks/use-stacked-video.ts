"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";

export type VideoSlot = {
  el: HTMLVideoElement;
  texture: THREE.VideoTexture;
  setPlaybackRate: (rate: number) => void;
};

/**
 * Loads a video and wraps it in a THREE.VideoTexture.
 * Returns null until the video is ready to play.
 *
 * For now this loads a plain video. Later it will handle
 * the stacked 4-quadrant format (color/depth/mask/lineart).
 */
export function useStackedVideo(src: string): VideoSlot | null {
  const elRef = useRef<HTMLVideoElement | null>(null);
  const [slot, setSlot] = useState<VideoSlot | null>(null);

  const setPlaybackRate = useCallback((rate: number) => {
    const el = elRef.current;
    if (!el) return;

    // Browser minimum is ~0.0625; clamp to that for ultra slow-mo
    el.playbackRate = Math.max(0.0625, rate);
    if (el.paused) el.play();
  }, []);

  useEffect(() => {
    const el = document.createElement("video");
    elRef.current = el;
    el.src = src;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = "anonymous";
    el.preload = "auto";

    const texture = new THREE.VideoTexture(el);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    el.addEventListener(
      "canplay",
      () => {
        el.play();
        setSlot({ el, texture, setPlaybackRate });
      },
      { once: true }
    );

    el.load();

    return () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
      texture.dispose();
      elRef.current = null;
    };
  }, [src, setPlaybackRate]);

  return slot;
}
