"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { useLenis } from "lenis/react";
import * as THREE from "three";
import { Leva } from "leva";
import { LenisProvider } from "@/components/lenis-provider";
import { BookScene, type ScrollData } from "./book-scene";

const SCROLL_PAGES = 5;

function BookInner() {
  const scrollRef = useRef<ScrollData>({ progress: 0 });

  useLenis((lenis) => {
    // Lenis reports progress=1 during init when scroll limit is 0
    scrollRef.current.progress = lenis.limit > 0 ? lenis.progress : 0;
  });

  return (
    <>
      <Leva />
      <div className="fixed inset-0 z-50 pointer-events-none">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.0;
            gl.setClearColor(0x0a0a0a, 1);
          }}
        >
          <ambientLight intensity={3} />
          <directionalLight position={[-20, 2, 3]} intensity={5.5} />
          <Suspense fallback={null}>
            <BookScene scrollRef={scrollRef} />
          </Suspense>
        </Canvas>
      </div>
      <div style={{ height: `${SCROLL_PAGES * 100}vh` }} />
    </>
  );
}

export function BookExperience() {
  return (
    <LenisProvider>
      <BookInner />
    </LenisProvider>
  );
}
