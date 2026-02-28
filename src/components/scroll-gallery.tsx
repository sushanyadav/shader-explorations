"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { useLenis } from "lenis/react";
import * as THREE from "three";
import { GalleryScene, type ScrollData } from "./gallery-scene";

const IMAGE_COUNT = 5;

export function ScrollGallery() {
  const scrollRef = useRef<ScrollData>({ progress: 0, velocity: 0 });

  useLenis((lenis) => {
    scrollRef.current.progress = lenis.progress;
    scrollRef.current.velocity = lenis.velocity;
  });

  return (
    <>
      <div className="fixed inset-0 z-50 pointer-events-none">
        <Canvas
          camera={{ position: [0, 0, 8], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
          }}
        >
          <color attach="background" args={["#f5f5f5"]} />
          <Suspense fallback={null}>
            <GalleryScene scrollRef={scrollRef} />
          </Suspense>
        </Canvas>
      </div>
      {/* Spacer — gives the scroll wrapper its scrollable height */}
      <div style={{ height: `${IMAGE_COUNT * 100}vh` }} />
    </>
  );
}
