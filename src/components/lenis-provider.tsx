"use client";

import "lenis/dist/lenis.css";

import Lenis from "lenis";
import type { ScrollCallback } from "lenis";
import { LenisContext, type LenisContextValue } from "lenis/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { CustomScrollbar } from "./custom-scrollbar";

gsap.registerPlugin(ScrollTrigger);

type CallbackEntry = {
  callback: ScrollCallback;
  priority: number;
};

export function LenisProvider({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef<CallbackEntry[]>([]);
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const [scrollerReady, setScrollerReady] = useState(false);

  // Phase 1: Set ScrollTrigger scroller default BEFORE children mount
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    ScrollTrigger.defaults({ scroller: wrapper });
    setScrollerReady(true);

    return () => {
      ScrollTrigger.defaults({ scroller: undefined });
    };
  }, []);

  // Phase 2: Create Lenis on the wrapper and sync with GSAP ticker
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const lenisInstance = new Lenis({
      wrapper,
      content,
      lerp: 0.12,
      wheelMultiplier: 1.2,
      touchMultiplier: 2,
      infinite: true,
      autoRaf: false,
    });

    lenisInstance.on("scroll", ScrollTrigger.update);

    lenisInstance.on("scroll", () => {
      for (const { callback } of callbacksRef.current) {
        callback(lenisInstance);
      }
    });

    const tickerCallback = (time: number) => {
      lenisInstance.raf(time * 1000);
    };
    gsap.ticker.add(tickerCallback);
    gsap.ticker.lagSmoothing(0);

    setLenis(lenisInstance);
    ScrollTrigger.refresh();

    return () => {
      lenisInstance.off("scroll", ScrollTrigger.update);
      gsap.ticker.remove(tickerCallback);
      lenisInstance.destroy();
      setLenis(null);
    };
  }, []);

  // Mouse drag to scroll with momentum throw
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !lenis) return;

    let isDragging = false;
    let lastY = 0;
    let lastTime = 0;
    let velocityY = 0;
    let throwTween: gsap.core.Tween | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (throwTween) throwTween.kill();
      isDragging = true;
      lastY = e.clientY;
      lastTime = performance.now();
      velocityY = 0;
      wrapper.style.cursor = "grabbing";
      wrapper.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const now = performance.now();
      const dt = now - lastTime;
      const dy = e.clientY - lastY;

      if (dt > 0) {
        velocityY = dy / dt; // px per ms
      }

      lenis.scrollTo(lenis.scroll - dy, { immediate: true });
      lastY = e.clientY;
      lastTime = now;
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      wrapper.style.cursor = "";

      // Momentum throw — flick velocity into a decaying scroll
      const throwDistance = -velocityY * 600;
      if (Math.abs(throwDistance) > 10) {
        const state = { value: 0, prev: 0 };
        throwTween = gsap.to(state, {
          value: throwDistance,
          duration: 0.8,
          ease: "power3.out",
          onUpdate() {
            const delta = state.value - state.prev;
            lenis.scrollTo(lenis.scroll + delta, { immediate: true });
            state.prev = state.value;
          },
        });
      }
    };

    wrapper.addEventListener("pointerdown", onPointerDown);
    wrapper.addEventListener("pointermove", onPointerMove);
    wrapper.addEventListener("pointerup", onPointerUp);
    wrapper.addEventListener("pointercancel", onPointerUp);

    return () => {
      if (throwTween) throwTween.kill();
      wrapper.removeEventListener("pointerdown", onPointerDown);
      wrapper.removeEventListener("pointermove", onPointerMove);
      wrapper.removeEventListener("pointerup", onPointerUp);
      wrapper.removeEventListener("pointercancel", onPointerUp);
    };
  }, [lenis]);

  const addCallback = useCallback(
    (callback: ScrollCallback, priority: number) => {
      callbacksRef.current.push({ callback, priority });
      callbacksRef.current.sort((a, b) => a.priority - b.priority);
    },
    [],
  );

  const removeCallback = useCallback((callback: ScrollCallback) => {
    callbacksRef.current = callbacksRef.current.filter(
      (entry) => entry.callback !== callback,
    );
  }, []);

  const contextValue = useMemo<LenisContextValue | null>(
    () =>
      lenis ? { lenis, addCallback, removeCallback } : null,
    [lenis, addCallback, removeCallback],
  );

  return (
    <LenisContext value={contextValue}>
      <div
        ref={wrapperRef}
        className="relative h-dvh cursor-grab overflow-y-auto overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={contentRef}>{scrollerReady ? children : null}</div>
      </div>
      <CustomScrollbar wrapperRef={wrapperRef} />
    </LenisContext>
  );
}
