"use client";

import { useRef, useEffect, useCallback } from "react";
import { Noto_Sans_JP } from "next/font/google";
import gsap from "gsap";

const notoJP = Noto_Sans_JP({
  weight: "900",
  subsets: ["latin"],
});

const SFX_TEXTS = [
  "ドドドド",
  "バキッ",
  "ドゴォ",
  "ズドン",
  "ガッ",
  "ドカーン",
  "ゴゴゴゴ",
];

export function Onomatopoeia() {
  const textRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const handlePeak = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    const el = textRef.current;
    if (!el) return;

    // Random SFX text
    const text = SFX_TEXTS[Math.floor(Math.random() * SFX_TEXTS.length)];
    el.textContent = text;

    // Position near click point with offset
    const x = detail.x * window.innerWidth;
    const y = (1 - detail.y) * window.innerHeight; // flip Y (UV → screen)
    const offsetX = (Math.random() - 0.5) * 120;
    const offsetY = -60 - Math.random() * 40;

    // Kill previous
    tlRef.current?.kill();

    gsap.set(el, {
      x: x + offsetX,
      y: y + offsetY,
      opacity: 1,
      scale: 3,
      rotation: (Math.random() - 0.5) * 20,
    });

    tlRef.current = gsap.timeline();
    tlRef.current
      .to(el, {
        scale: 1,
        duration: 0.2,
        ease: "back.out(3)",
      })
      .to(el, {
        opacity: 0,
        scale: 0.8,
        duration: 0.4,
        ease: "power2.in",
        delay: 0.3,
      });
  }, []);

  useEffect(() => {
    window.addEventListener("impact-peak", handlePeak);
    return () => {
      window.removeEventListener("impact-peak", handlePeak);
      tlRef.current?.kill();
    };
  }, [handlePeak]);

  return (
    <div
      ref={textRef}
      className={notoJP.className}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        fontSize: "clamp(3rem, 8vw, 6rem)",
        color: "white",
        opacity: 0,
        pointerEvents: "none",
        zIndex: 10,
        WebkitTextStroke: "3px black",
        paintOrder: "stroke fill",
        textShadow: "0 0 20px rgba(0,0,0,0.5)",
        willChange: "transform, opacity",
        whiteSpace: "nowrap",
      }}
    />
  );
}
