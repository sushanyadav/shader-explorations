"use client";

import { useLenis } from "lenis/react";
import { useCallback, useEffect, useRef } from "react";
import { gsap } from "gsap";

const THUMB_MIN_HEIGHT = 32;
const IS_TOUCH =
  typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;

type CustomScrollbarProps = {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
};

export function CustomScrollbar({ wrapperRef }: CustomScrollbarProps) {
  const lenis = useLenis();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const lastScrollRef = useRef(-1);

  const getThumbMetrics = useCallback(() => {
    const track = trackRef.current;
    const wrapper = wrapperRef.current;
    if (!track || !wrapper) return null;

    const viewportHeight = wrapper.clientHeight;
    const contentHeight = wrapper.scrollHeight;
    if (contentHeight <= viewportHeight) return null;

    const trackHeight = track.clientHeight;
    const ratio = viewportHeight / contentHeight;
    const thumbHeight = Math.max(THUMB_MIN_HEIGHT, trackHeight * ratio);
    const scrollRange = trackHeight - thumbHeight;
    return { thumbHeight, scrollRange, limit: contentHeight - viewportHeight };
  }, [wrapperRef]);

  // GSAP ticker — runs every frame, updates thumb position
  useEffect(() => {
    if (IS_TOUCH) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onTick = () => {
      const thumb = thumbRef.current;
      if (!thumb) return;

      const scrollY = wrapper.scrollTop;
      if (scrollY === lastScrollRef.current) return;
      lastScrollRef.current = scrollY;

      const metrics = getThumbMetrics();
      if (!metrics || metrics.limit <= 0) return;

      const progress = scrollY / metrics.limit;
      thumb.style.height = `${metrics.thumbHeight}px`;
      thumb.style.transform = `translate3d(0, ${progress * metrics.scrollRange}px, 0)`;
    };

    gsap.ticker.add(onTick);
    return () => gsap.ticker.remove(onTick);
  }, [wrapperRef, getThumbMetrics]);

  // Drag handling
  useEffect(() => {
    if (IS_TOUCH) return;
    const thumb = thumbRef.current;
    const track = trackRef.current;
    if (!thumb || !track || !lenis) return;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartYRef.current = e.clientY;
      dragStartScrollRef.current = lenis.scroll;
      thumb.setPointerCapture(e.pointerId);
      document.documentElement.style.userSelect = "none";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const metrics = getThumbMetrics();
      if (!metrics) return;

      const deltaY = e.clientY - dragStartYRef.current;
      const scrollDelta = (deltaY / metrics.scrollRange) * metrics.limit;
      lenis.scrollTo(dragStartScrollRef.current + scrollDelta, {
        immediate: true,
      });
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      document.documentElement.style.userSelect = "";
    };

    const onTrackClick = (e: MouseEvent) => {
      if (e.target === thumb) return;
      const metrics = getThumbMetrics();
      if (!metrics) return;
      const rect = track.getBoundingClientRect();
      const clickRatio = (e.clientY - rect.top) / rect.height;
      lenis.scrollTo(clickRatio * metrics.limit, { immediate: false });
    };

    thumb.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    track.addEventListener("click", onTrackClick);

    return () => {
      thumb.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      track.removeEventListener("click", onTrackClick);
    };
  }, [lenis, getThumbMetrics]);

  if (IS_TOUCH) return null;

  return (
    <div
      ref={trackRef}
      className="fixed top-0 right-0 z-[9999] h-full w-3 cursor-pointer"
      style={{ padding: "2px 2px 2px 0" }}
    >
      <div
        ref={thumbRef}
        className="ml-auto w-[5px] rounded-full bg-white/20 transition-[background-color] duration-200 hover:bg-white/50"
        style={{ willChange: "transform" }}
      />
    </div>
  );
}
