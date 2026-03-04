"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * Maps overall hold progress (0..1) to individual effect intensities
 * based on staggered start/end thresholds.
 *
 * Each effect ramps from 0→1 within its own [start, end] window,
 * with ease-out-quad smoothing.
 */

export type EffectIntensities = {
  videoSlowdown: number; // 0..1
  desaturation: number;
  contrast: number;
  zoom: number;
  vignette: number;
  grain: number;
  chromaticAberration: number;
  shake: number;
  selectiveRed: number;
  anime: number;
};

type EffectRange = { start: number; end: number };

const RANGES: Record<keyof EffectIntensities, EffectRange> = {
  videoSlowdown:      { start: 0.0, end: 0.08 },
  desaturation:       { start: 0.0, end: 0.25 },
  contrast:           { start: 0.0, end: 0.35 },
  zoom:               { start: 0.0, end: 0.45 },
  vignette:           { start: 0.0, end: 0.40 },
  grain:              { start: 0.0, end: 0.50 },
  chromaticAberration:{ start: 0.0, end: 0.60 },
  shake:              { start: 0.0, end: 0.50 },
  selectiveRed:       { start: 0.0, end: 0.80 },
  anime:              { start: 0.0, end: 0.40 },
};

/** Ease-out quadratic: fast ramp then gentle settle */
function easeOutQuad(t: number): number {
  return t * (2 - t);
}

function computeLocal(progress: number, range: EffectRange): number {
  if (progress <= range.start) return 0;
  if (progress >= range.end) return 1;
  const raw = (progress - range.start) / (range.end - range.start);
  return easeOutQuad(raw);
}

export function useStaggeredEffects(progress: number): EffectIntensities {
  const intensities = useRef<EffectIntensities>({
    videoSlowdown: 0,
    desaturation: 0,
    contrast: 0,
    zoom: 0,
    vignette: 0,
    grain: 0,
    chromaticAberration: 0,
    shake: 0,
    selectiveRed: 0,
    anime: 0,
  });

  useFrame(() => {
    const p = Math.max(0, progress);
    const fx = intensities.current;

    for (const key of Object.keys(RANGES) as (keyof EffectIntensities)[]) {
      fx[key] = computeLocal(p, RANGES[key]);
    }
  });

  return intensities.current;
}
