"use client";

import { LenisProvider } from "@/components/lenis-provider";
import { ScrollFilmstrip } from "./scroll-filmstrip";

export function FilmstripExperience() {
  return (
    <LenisProvider infinite>
      <ScrollFilmstrip />
    </LenisProvider>
  );
}
