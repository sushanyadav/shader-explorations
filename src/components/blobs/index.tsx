"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { useControls } from "leva";
import { Leva } from "leva";

/* ─── Local video pool ─── */

const VIDEO_URLS = [
  "/shrine-japan.mp4",
  "/shrine-sunny.mp4",
  "/temple-osaka.mp4",
  "/pagoda-greenery.mp4",
];

/* ─── Displacement texture (FBM noise, computed once on CPU) ─── */

function createDisplacementTexture(w = 256, h = 256) {
  const data = new Uint8Array(4 * w * h);

  function hash(x: number, y: number) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  // Tileable value noise — wraps integer coords so edges match
  function vnoise(x: number, y: number, freq: number) {
    const sx = x * freq;
    const sy = y * freq;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = sx - ix;
    const fy = sy - iy;
    const sfx = fx * fx * (3 - 2 * fx);
    const sfy = fy * fy * (3 - 2 * fy);
    const ix0 = ((ix % freq) + freq) % freq;
    const iy0 = ((iy % freq) + freq) % freq;
    const ix1 = (ix0 + 1) % freq;
    const iy1 = (iy0 + 1) % freq;
    return (
      (hash(ix0, iy0) * (1 - sfx) + hash(ix1, iy0) * sfx) * (1 - sfy) +
      (hash(ix0, iy1) * (1 - sfx) + hash(ix1, iy1) * sfx) * sfy
    );
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      const val =
        vnoise(nx, ny, 4) * 0.5 +
        vnoise(nx, ny, 8) * 0.25 +
        vnoise(nx, ny, 16) * 0.125 +
        vnoise(nx, ny, 32) * 0.0625;
      const byte = Math.floor(Math.min(1, Math.max(0, val / 0.9375)) * 255);
      // R: this noise, G: offset noise for decorrelated XY displacement
      const val2 =
        vnoise(nx + 0.37, ny + 0.71, 4) * 0.5 +
        vnoise(nx + 0.37, ny + 0.71, 8) * 0.25 +
        vnoise(nx + 0.37, ny + 0.71, 16) * 0.125 +
        vnoise(nx + 0.37, ny + 0.71, 32) * 0.0625;
      const byte2 = Math.floor(Math.min(1, Math.max(0, val2 / 0.9375)) * 255);
      const i = (y * w + x) * 4;
      data[i] = byte;
      data[i + 1] = byte2;
      data[i + 2] = byte;
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, w, h);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/* ─── Main video + transition shader (Enpower-inspired wipe) ─── */

const mainVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const mainFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uVideo;
  uniform sampler2D uVideoNext;
  uniform sampler2D uDisplacement;
  uniform vec2 uTexelSize;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uGrainIntensity;
  uniform float uTonalLevels;
  uniform float uTransition;
  varying vec2 vUv;

  vec2 mirrored(vec2 v) {
    vec2 m = mod(v, 2.0);
    return mix(m, 2.0 - m, step(1.0, m));
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // Subtle zoom scale (3% max — matches Enpower reference)
  const float ZOOM = 0.03;

  // Blended luminance from both videos at any UV, using the wipe intpl
  float blendedLum(vec2 uv, float intpl) {
    vec3 fromC = texture2D(uVideo, (uv - 0.5) * (1.0 - intpl * ZOOM) + 0.5).rgb;
    vec3 toC   = texture2D(uVideoNext, (uv - 0.5) * (1.0 - (1.0 - intpl) * ZOOM) + 0.5).rgb;
    vec3 c     = mix(fromC, toC, intpl);
    float l    = dot(c, vec3(0.299, 0.587, 0.114));
    return floor(l * uTonalLevels + 0.5) / uTonalLevels;
  }

  float blendedEdge(vec2 uv, float intpl) {
    float c = blendedLum(uv, intpl);
    float r = blendedLum(uv + vec2(uTexelSize.x, 0.0), intpl);
    float d = blendedLum(uv + vec2(0.0, -uTexelSize.y), intpl);
    return step(0.001, max(abs(c - r), abs(c - d)));
  }

  void main() {
    // ── Left-to-right noise-distorted wipe (Enpower-style) ──
    vec4 noise = texture2D(uDisplacement, mirrored(vUv + uTime * 0.04));

    // prog maps uTransition [0,1] so intpl is guaranteed 0 at start, 1 at end
    float prog = uTransition * 0.22 - 0.07 + noise.r * 0.06;

    // Horizontal sweep: tighter edge for a punchier wipe
    float intpl = smoothstep(0.0, 0.18, (prog * 12.0 - vUv.x * 1.5) + 0.02);

    // Transition sketch mask (computed early for displacement/RGB split)
    float transActive = smoothstep(0.0, 0.02, uTransition) * (1.0 - smoothstep(0.75, 0.92, uTransition));
    float transSketch = smoothstep(0.0, 0.05, intpl) * transActive;

    // Covering side: progressive distortion + push — grows with transition squared
    float coverStr = (1.0 - smoothstep(0.7, 1.0, intpl)) * uTransition * uTransition;
    vec2 noiseWarp = (texture2D(uDisplacement, vUv * 2.5 + uTime * 0.06).rg - 0.5);
    vec2 coverDisp = noiseWarp * 0.7 * coverStr + vec2(-0.3, 0.0) * coverStr;

    // Settle displacement — incoming starts displaced, flash fires, then eases into place
    float settleStr = smoothstep(0.0, 0.05, intpl) * smoothstep(1.0, 0.88, uTransition);
    vec2 settleDisp = (texture2D(uDisplacement, vUv * 2.0 + uTime * 0.05).rg - 0.5) * 0.03 * settleStr;

    // Subtle zoom: outgoing zooms in, incoming zooms out
    float fZoom = 1.0 - intpl * ZOOM;
    float tZoom = 1.0 - (1.0 - intpl) * ZOOM;
    vec3 fromVid = texture2D(uVideo, (vUv + coverDisp - 0.5) * fZoom + 0.5).rgb;
    vec3 toVid = texture2D(uVideoNext, (vUv + settleDisp - 0.5) * tZoom + 0.5).rgb;
    vec3 video = mix(fromVid, toVid, intpl);

    // Sketch: pencil on white paper (edges displaced to match video)
    vec2 sketchUv = vUv + settleDisp;
    float edges = blendedEdge(sketchUv, intpl);
    vec2 grainUv = vUv * uResolution * 0.5;
    float grain = vnoise(grainUv + uTime * 0.3) * 0.08;
    float gray = dot(video, vec3(0.299, 0.587, 0.114));
    vec3 paper = vec3(0.95 + grain);
    float pencil = 1.0 - edges * 0.5;
    float shading = smoothstep(0.0, 0.5, gray);
    vec3 sketch = paper * pencil * mix(0.75, 1.0, shading);

    // Sketch mask from transition only
    float sketchMask = transSketch;
    vec3 color = mix(video, sketch, sketchMask);

    // Sharp full-screen flash right before sketch resolves
    float shine = exp(-pow((uTransition - 0.78) * 24.0, 2.0)) * 0.45;
    color += vec3(shine);

    // Film grain (only on sketch areas)
    vec2 grainSeed = vUv * uResolution + uTime * 1000.0;
    float filmGrain = (hash(floor(grainSeed)) - 0.5) * uGrainIntensity * sketchMask;
    color += filmGrain;

    gl_FragColor = vec4(color, 1.0);
  }
`;

/* ─── Video slot helper ─── */

type VideoSlot = { el: HTMLVideoElement; tex: THREE.VideoTexture };

function createVideoSlot(url: string): Promise<VideoSlot> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.src = url;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = "anonymous";

    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    el.addEventListener("canplay", () => resolve({ el, tex }), { once: true });
    el.load();
  });
}

/* ─── VideoPlane component ─── */

function VideoPlane({ slots }: { slots: VideoSlot[] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { viewport, gl, size } = useThree();

  const controls = useControls("Blueprint", {
    tonalLevels: { value: 6, min: 2, max: 24, step: 1 },
    grainIntensity: { value: 0.08, min: 0.0, max: 1.0, step: 0.005 },
  });

  const displacementTex = useMemo(() => createDisplacementTexture(), []);

  // Current "from" index — "to" is always (fromIndex + 1) % length
  const fromIndex = useRef(0);

  // Transition state
  const transitionRef = useRef(0);
  const isTransitioning = useRef(false);
  const swapPending = useRef(false);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const TRANSITION_DURATION = 3.0;

  const startTransition = useCallback(() => {
    transitionRef.current = 0;
    isTransitioning.current = true;

    tweenRef.current = gsap.to(transitionRef, {
      current: 1,
      duration: TRANSITION_DURATION,
      ease: "power2.out",
      onComplete: () => {
        isTransitioning.current = false;
        swapPending.current = true;
        tweenRef.current = null;
      },
    });
  }, []);

  const onPointerDown = useCallback(() => {
    // If mid-transition, force-complete and advance index
    if (isTransitioning.current || swapPending.current) {
      if (tweenRef.current) {
        tweenRef.current.kill();
        tweenRef.current = null;
      }
      transitionRef.current = 0;
      isTransitioning.current = false;
      swapPending.current = false;

      // "to" becomes new "from"
      fromIndex.current = (fromIndex.current + 1) % slots.length;
    }

    startTransition();
  }, [startTransition, slots.length]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, [gl, onPointerDown]);

  // Main uniforms
  const mainUniforms = useMemo(
    () => ({
      uVideo: { value: null as THREE.VideoTexture | null },
      uVideoNext: { value: null as THREE.VideoTexture | null },
      uDisplacement: { value: null as THREE.DataTexture | null },
      uTexelSize: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
      uResolution: { value: new THREE.Vector2(1920, 1080) },
      uTime: { value: 0 },
      uGrainIntensity: { value: 0.06 },
      uTonalLevels: { value: 8 },
      uTransition: { value: 0 },
    }),
    []
  );

  useFrame(() => {
    if (!matRef.current) return;

    // Scale plane to cover viewport
    const refEl = slots[0].el;
    if (!refEl.videoWidth) return;
    const videoAspect = refEl.videoWidth / refEl.videoHeight;
    const viewAspect = viewport.width / viewport.height;
    let w, h;
    if (viewAspect > videoAspect) {
      w = viewport.width;
      h = viewport.width / videoAspect;
    } else {
      h = viewport.height;
      w = viewport.height * videoAspect;
    }
    meshRef.current!.scale.set(w, h, 1);

    const pw = Math.round(size.width * Math.min(window.devicePixelRatio, 2));
    const ph = Math.round(size.height * Math.min(window.devicePixelRatio, 2));

    // ── Deferred swap: runs one frame AFTER GSAP tween completes ──
    if (swapPending.current) {
      swapPending.current = false;
      transitionRef.current = 0;
      fromIndex.current = (fromIndex.current + 1) % slots.length;
    }

    const fromSlot = slots[fromIndex.current];
    const toSlot = slots[(fromIndex.current + 1) % slots.length];
    const videoEl = fromSlot.el;
    if (!videoEl.videoWidth) return;

    // ── Main material uniforms ──
    const u = matRef.current.uniforms;
    u.uVideo.value = fromSlot.tex;
    u.uVideoNext.value = toSlot.tex;
    u.uDisplacement.value = displacementTex;
    u.uTexelSize.value.set(1 / videoEl.videoWidth, 1 / videoEl.videoHeight);
    u.uResolution.value.set(pw, ph);
    u.uTime.value = performance.now() / 1000;
    u.uGrainIntensity.value = controls.grainIntensity;
    u.uTonalLevels.value = controls.tonalLevels;
    u.uTransition.value = transitionRef.current;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={mainVertex}
        fragmentShader={mainFragment}
        uniforms={mainUniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ─── Experience wrapper ─── */

export function BlobsExperience() {
  const [slots, setSlots] = useState<VideoSlot[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function preloadAll() {
      const loaded = await Promise.all(VIDEO_URLS.map(createVideoSlot));
      if (cancelled) return;
      loaded.forEach((s) => s.el.play());
      setSlots(loaded);
    }

    preloadAll();

    return () => {
      cancelled = true;
      slots?.forEach((s) => {
        s.el.pause();
        s.el.src = "";
        s.tex.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Leva />
      <div className="fixed inset-0 cursor-pointer">
        {!slots && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="size-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        )}
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
            gl.setClearColor(0x000000, 1);
          }}
        >
          {slots && (
            <Suspense fallback={null}>
              <VideoPlane slots={slots} />
            </Suspense>
          )}
        </Canvas>
      </div>
    </>
  );
}
