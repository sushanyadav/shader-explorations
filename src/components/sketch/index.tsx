"use client";

import { Suspense, useEffect, useRef, useState, useMemo } from "react";
import { Canvas, useThree, useFrame, createPortal } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import { useControls } from "leva";
import { Leva } from "leva";

/* ─── Shared vertex ─── */

const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* ─── Mask accumulation shader (ping-pong FBO) ─── */

const maskFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrevMask;
  uniform vec2 uMouse;
  uniform float uBrushRadius;
  uniform float uDecayRate;
  uniform float uAspect;
  varying vec2 vUv;

  void main() {
    float prev = texture2D(uPrevMask, vUv).r;

    // Decay previous mask
    float mask = prev * uDecayRate;

    // Paint new brush stroke at cursor position
    if (uMouse.x >= 0.0) {
      vec2 diff = vUv - uMouse;
      diff.x *= uAspect;
      float dist = length(diff);
      float brush = smoothstep(uBrushRadius, 0.0, dist);
      mask = max(mask, brush);
    }

    gl_FragColor = vec4(mask, 0.0, 0.0, 1.0);
  }
`;

/* ─── Main composite shader ─── */

const compositeFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D uVideo;
  uniform sampler2D uMask;
  uniform vec2 uTexelSize;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uEdgeThreshold;
  uniform float uHover;
  uniform vec2 uMousePos;
  uniform float uAspect;
  varying vec2 vUv;

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

  uniform float uTonalLevels;

  float getLum(vec2 uv) {
    vec3 c = texture2D(uVideo, uv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return floor(l * uTonalLevels + 0.5) / uTonalLevels;
  }

  float getEdge(vec2 uv) {
    float c = getLum(uv);
    float r = getLum(uv + vec2(uTexelSize.x, 0.0));
    float u = getLum(uv + vec2(0.0, uTexelSize.y));
    float l = getLum(uv - vec2(uTexelSize.x, 0.0));
    float d = getLum(uv - vec2(0.0, uTexelSize.y));
    float dx = abs(r - l);
    float dy = abs(u - d);
    return step(uEdgeThreshold, max(dx, dy));
  }

  void main() {
    vec3 video = texture2D(uVideo, vUv).rgb;
    float sketchMask = texture2D(uMask, vUv).r;

    float gray = dot(video, vec3(0.299, 0.587, 0.114));

    // Edge detection — dark strokes
    float edges = getEdge(vUv);

    // Desaturate and gently fade — keep video's natural tones, don't blow out to white
    vec3 faded = mix(video, vec3(gray), 0.7);
    vec3 sketch = mix(faded, vec3(gray * 0.3 + 0.55), 0.5);

    // Edge strokes — intense near cursor, fade to nearly invisible far away
    vec2 toCursor = vUv - uMousePos;
    toCursor.x *= uAspect;
    float cursorDist = length(toCursor);
    float edgeFade = 1.0 - smoothstep(0.0, 0.6, cursorDist);
    float edgeStrength = mix(0.08, 0.9, edgeFade);
    sketch *= 1.0 - edges * edgeStrength;

    // Subtle grain (sketch areas + hover)
    vec2 grainSeed = vUv * uResolution + uTime * 1000.0;
    float grainMask = max(sketchMask, uHover);
    float filmGrain = (hash(floor(grainSeed)) - 0.5) * 0.04 * grainMask;
    sketch += filmGrain;

    // Base = video, painted areas = sketch
    vec3 color = mix(video, sketch, sketchMask);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/* ─── Video helper ─── */

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

/* ─── SketchPlane component ─── */

function SketchPlane({ slot }: { slot: VideoSlot }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const compositeMatRef = useRef<THREE.ShaderMaterial>(null);
  const maskMatRef = useRef<THREE.ShaderMaterial>(null);
  const { viewport, size, gl } = useThree();

  const mouseUv = useRef(new THREE.Vector2(-1, -1));

  const controls = useControls("Blueprint", {
    decayRate: { value: 0.95, min: 0.8, max: 1.0, step: 0.005 },
    brushRadius: { value: 0.25, min: 0.05, max: 1.0, step: 0.01 },
    edgeThreshold: { value: 0.001, min: 0, max: 0.1, step: 0.0005 },
    tonalLevels: { value: 150, min: 2, max: 300, step: 1 },
    hoverGrain: { value: 0.5, min: 0.0, max: 1.0, step: 0.01 },
  });

  // Hover state
  const hoverRef = useRef(0);
  const hoverTweenRef = useRef<gsap.core.Tween | null>(null);

  // Ping-pong FBOs for mask accumulation
  const fboA = useFBO(size.width, size.height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.FloatType,
  });
  const fboB = useFBO(size.width, size.height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.FloatType,
  });
  const pingPong = useRef(0);

  // Offscreen scene + camera for mask pass
  const maskScene = useMemo(() => new THREE.Scene(), []);
  const maskCamera = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    cam.position.z = 1;
    return cam;
  }, []);

  const maskUniforms = useMemo(
    () => ({
      uPrevMask: { value: null as THREE.Texture | null },
      uMouse: { value: new THREE.Vector2(-1, -1) },
      uBrushRadius: { value: 0.25 },
      uDecayRate: { value: 0.95 },
      uAspect: { value: 1 },
    }),
    []
  );

  const compositeUniforms = useMemo(
    () => ({
      uVideo: { value: null as THREE.VideoTexture | null },
      uMask: { value: null as THREE.Texture | null },
      uTexelSize: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
      uResolution: { value: new THREE.Vector2(1920, 1080) },
      uTime: { value: 0 },
      uEdgeThreshold: { value: 0.001 },
      uTonalLevels: { value: 6 },
      uHover: { value: 0 },
      uMousePos: { value: new THREE.Vector2(-1, -1) },
      uAspect: { value: 1 },
    }),
    []
  );

  // Track mouse in UV space + hover grain
  useEffect(() => {
    const canvas = gl.domElement;

    function onMove(e: PointerEvent) {
      mouseUv.current.set(
        e.clientX / size.width,
        1.0 - e.clientY / size.height
      );
    }
    function onLeave() {
      mouseUv.current.set(-1, -1);
    }
    function onEnter() {
      hoverTweenRef.current?.kill();
      hoverTweenRef.current = gsap.to(hoverRef, {
        current: 1,
        duration: 0.4,
        ease: "power2.out",
      });
    }
    function onCanvasLeave() {
      hoverTweenRef.current?.kill();
      hoverTweenRef.current = gsap.to(hoverRef, {
        current: 0,
        duration: 0.6,
        ease: "power2.inOut",
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onCanvasLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onCanvasLeave);
    };
  }, [size, gl]);

  useFrame(() => {
    if (!compositeMatRef.current || !maskMatRef.current) return;

    const el = slot.el;
    if (!el.videoWidth) return;

    // Scale plane to cover viewport
    const videoAspect = el.videoWidth / el.videoHeight;
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
    const aspect = size.width / size.height;

    // ── Mask pass: ping-pong accumulation ──
    const readFbo = pingPong.current === 0 ? fboA : fboB;
    const writeFbo = pingPong.current === 0 ? fboB : fboA;

    const mu = maskMatRef.current.uniforms;
    mu.uPrevMask.value = readFbo.texture;
    mu.uMouse.value.copy(mouseUv.current);
    mu.uBrushRadius.value = controls.brushRadius;
    mu.uDecayRate.value = controls.decayRate;
    mu.uAspect.value = aspect;

    gl.setRenderTarget(writeFbo);
    gl.render(maskScene, maskCamera);
    gl.setRenderTarget(null);

    pingPong.current = 1 - pingPong.current;

    // ── Composite pass ──
    const cu = compositeMatRef.current.uniforms;
    cu.uVideo.value = slot.tex;
    cu.uMask.value = writeFbo.texture;
    cu.uTexelSize.value.set(1 / el.videoWidth, 1 / el.videoHeight);
    cu.uResolution.value.set(pw, ph);
    cu.uTime.value = performance.now() / 1000;
    cu.uEdgeThreshold.value = controls.edgeThreshold;
    cu.uTonalLevels.value = controls.tonalLevels;
    cu.uHover.value = hoverRef.current * controls.hoverGrain;
    cu.uMousePos.value.copy(mouseUv.current);
    cu.uAspect.value = size.width / size.height;
  });

  return (
    <>
      {/* Offscreen mask quad */}
      {createPortal(
        <mesh>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            ref={maskMatRef}
            vertexShader={fullscreenVert}
            fragmentShader={maskFrag}
            uniforms={maskUniforms}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>,
        maskScene
      )}

      {/* Main visible quad */}
      <mesh ref={meshRef} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={compositeMatRef}
          vertexShader={fullscreenVert}
          fragmentShader={compositeFrag}
          uniforms={compositeUniforms}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/* ─── Experience wrapper ─── */

export function SketchExperience() {
  const [slot, setSlot] = useState<VideoSlot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const loaded = await createVideoSlot("/iphone-flip.mp4");
      if (cancelled) return;
      loaded.el.play();
      setSlot(loaded);
    }

    load();

    return () => {
      cancelled = true;
      if (slot) {
        slot.el.pause();
        slot.el.src = "";
        slot.tex.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Leva />
      <div className="fixed inset-0">
        {!slot && (
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
          {slot && (
            <Suspense fallback={null}>
              <SketchPlane slot={slot} />
            </Suspense>
          )}
        </Canvas>
      </div>
    </>
  );
}
