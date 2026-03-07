"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Leva } from "leva";

import { PaperFlapScene } from "./paper-flap-scene";

export function PaperFlapExperience() {
  return (
    <div className="select-none">
      <Leva />
      <div className="fixed inset-0">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
            gl.setClearColor(0x000000, 1);
          }}
        >
          <Suspense fallback={null}>
            <PaperFlapScene />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
