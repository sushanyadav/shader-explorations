"use client";

import { useRef, useCallback, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";

import {
  type SpringState,
  type SpringConfig,
  stepSpring,
} from "../utils/spring";

/* ─── State machine ─── */

type Phase = "idle" | "building" | "peak" | "reverting";

export type HoldState = {
  phase: Phase;
  /** 0..1 (can briefly go slightly negative during spring overshoot) */
  progress: number;
  /** UV coordinate of the click point (0..1 range) */
  origin: [number, number];
  /** Whether peak was just triggered this frame */
  peakTriggered: boolean;
};

/**
 * Manages the hold-to-impact interaction.
 *
 * - Mousedown starts building progress with cubic ease-in
 * - At progress >= 1.0, peak fires (one-shot)
 * - Mouseup triggers damped spring revert to 0
 * - Re-clicking during revert resumes building from current progress
 *
 * All state is in refs (no React re-renders) — read in useFrame.
 */
export function useHoldProgress(): HoldState {
  const { gl } = useThree();

  /* ─── Leva controls ─── */

  const controls = useControls("Impact Frame", {
    buildup: folder({
      holdDuration: { value: 0.5, min: 0.5, max: 5.0, step: 0.1 },
      acceleration: { value: 3.5, min: 1, max: 12, step: 0.5 },
    }),
    spring: folder({
      stiffness: { value: 180, min: 50, max: 400, step: 10 },
      damping: { value: 12, min: 4, max: 30, step: 1 },
    }),
  });

  /* ─── Refs (all mutable, no re-renders) ─── */

  const phaseRef = useRef<Phase>("idle");
  const holdStartRef = useRef(0); // timestamp when hold began
  const progressAtHoldStart = useRef(0); // progress when hold began (for resume)
  const progressRef = useRef(0);
  const originRef = useRef<[number, number]>([0.5, 0.5]);
  const peakTriggeredRef = useRef(false);
  const isDownRef = useRef(false);

  const springState = useRef<SpringState>({ value: 0, velocity: 0 });

  // Exposed state object (mutated in place each frame)
  const stateRef = useRef<HoldState>({
    phase: "idle",
    progress: 0,
    origin: [0.5, 0.5],
    peakTriggered: false,
  });

  /* ─── Pointer handlers ─── */

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      isDownRef.current = true;

      // Store click position as UV (0..1)
      const rect = gl.domElement.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height; // flip Y for UV
      originRef.current = [x, y];

      // Start or resume building
      holdStartRef.current = performance.now() / 1000;
      progressAtHoldStart.current = Math.max(0, progressRef.current);
      phaseRef.current = "building";
    },
    [gl]
  );

  const onPointerUp = useCallback(() => {
    isDownRef.current = false;

    if (
      phaseRef.current === "building" ||
      phaseRef.current === "peak"
    ) {
      // Start spring revert
      phaseRef.current = "reverting";
      springState.current = {
        value: progressRef.current,
        velocity: 0,
      };
    }
  }, []);

  /* ─── Attach/detach listeners ─── */

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [gl, onPointerDown, onPointerUp]);

  /* ─── Per-frame update ─── */

  useFrame((_, delta) => {
    // Cap delta to prevent huge jumps on tab switch
    const dt = Math.min(delta, 0.1);
    const phase = phaseRef.current;

    peakTriggeredRef.current = false;

    if (phase === "building") {
      const now = performance.now() / 1000;
      const elapsed = now - holdStartRef.current;
      const rawT = elapsed / controls.holdDuration;

      // Exponential ease-in with instant kick:
      // progress jumps to ~15% immediately, then ramps to 100%
      const t = Math.min(rawT, 1);
      const k = controls.acceleration;
      const easedT = (Math.exp(k * t) - 1) / (Math.exp(k) - 1);
      const kick = 0.15; // instant visible feedback
      const withKick = kick + (1.0 - kick) * easedT;

      // Add to whatever progress we had when hold started
      progressRef.current = Math.min(
        progressAtHoldStart.current + withKick,
        1.0
      );

      // Check for peak
      if (progressRef.current >= 1.0) {
        progressRef.current = 1.0;
        phaseRef.current = "peak";
        peakTriggeredRef.current = true;
      }
    } else if (phase === "peak") {
      // Stay at peak until mouse release
      progressRef.current = 1.0;
    } else if (phase === "reverting") {
      const config: SpringConfig = {
        stiffness: controls.stiffness,
        damping: controls.damping,
        mass: 1,
      };

      const settled = stepSpring(springState.current, config, dt);
      progressRef.current = springState.current.value;

      if (settled) {
        phaseRef.current = "idle";
        progressRef.current = 0;
      }
    }

    // Update exposed state
    const state = stateRef.current;
    state.phase = phaseRef.current;
    state.progress = progressRef.current;
    state.origin = originRef.current;
    state.peakTriggered = peakTriggeredRef.current;
  });

  return stateRef.current;
}
