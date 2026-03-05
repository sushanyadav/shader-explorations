"use client";

import { useRef, useMemo, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useControls, folder } from "leva";
import gsap from "gsap";

import { useStackedVideo } from "./hooks/use-stacked-video";
import { useHoldProgress } from "./hooks/use-hold-progress";
import { useStaggeredEffects } from "./hooks/use-staggered-effects";
import { InkParticles } from "./systems/ink-particles";

/* ─── Shared fullscreen vertex ─── */

const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* ─── Buildup + peak fragment shader ─── */

const buildupFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uVideo;
  uniform vec2 uVideoRes;
  uniform vec2 uViewRes;
  uniform float uTime;

  // Hold state
  uniform float uProgress;
  uniform vec2 uOrigin;

  // Effect intensities (0..1 each)
  uniform float uDesaturation;
  uniform float uContrast;
  uniform float uZoom;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uCA;

  // Peak effects
  uniform float uFlash;
  uniform vec2 uShakeOffset;

  // Max values (from Leva)
  uniform float uDesatMax;
  uniform float uContrastMax;
  uniform float uZoomMax;
  uniform float uVignetteMax;
  uniform float uVignetteRadius;
  uniform float uGrainMax;
  uniform float uCAMax;

  // Speed lines
  uniform float uSpeedLines;
  uniform float uSpeedLineCount;
  uniform float uSpeedLineSpread;

  // Screen cracks
  uniform float uCracks;
  uniform float uCrackSpread;
  uniform float uCrackScale;

  // Halftone
  uniform float uHalftone;
  uniform float uHalftoneScale;

  // Selective red
  uniform float uSelectiveRed;

  // Anime stylization
  uniform float uAnime;
  uniform float uAnimeEdge;
  uniform float uAnimeLevels;



  // Cover-fit UV mapping
  vec2 coverUv(vec2 uv, vec2 videoRes, vec2 viewRes) {
    float videoAspect = videoRes.x / videoRes.y;
    float viewAspect  = viewRes.x / viewRes.y;

    vec2 scale = vec2(1.0);
    if (viewAspect > videoAspect) {
      scale.y = videoAspect / viewAspect;
    } else {
      scale.x = viewAspect / videoAspect;
    }

    return (uv - 0.5) * scale + 0.5;
  }

  // Hash-based film grain
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // 2D hash for Voronoi
  vec2 hash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  // Voronoi: returns (dist to nearest, dist to 2nd nearest)
  vec2 voronoi(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
    }
    return vec2(sqrt(d1), sqrt(d2));
  }

  void main() {
    vec2 uv = vUv;

    // ── Screen shake (CPU offset) ──
    uv += uShakeOffset;

    vec2 videoUv = coverUv(uv, uVideoRes, uViewRes);

    vec3 color = texture2D(uVideo, videoUv).rgb;

    // ── Anime stylization (smoothing + cel-shading + ink outlines) ──
    if (uAnime > 0.01) {
      vec2 texel = 1.0 / uViewRes;
      float spread = 4.0; // sample at 4x texel for wider smoothing

      // 1. Area smoothing — average 3x3 neighborhood to kill fine detail
      vec3 smoothed = vec3(0.0);
      smoothed += texture2D(uVideo, videoUv + vec2(-texel.x, texel.y) * spread).rgb;
      smoothed += texture2D(uVideo, videoUv + vec2(0.0, texel.y) * spread).rgb;
      smoothed += texture2D(uVideo, videoUv + vec2(texel.x, texel.y) * spread).rgb;
      smoothed += texture2D(uVideo, videoUv + vec2(-texel.x, 0.0) * spread).rgb;
      smoothed += color; // center
      smoothed += texture2D(uVideo, videoUv + vec2(texel.x, 0.0) * spread).rgb;
      smoothed += texture2D(uVideo, videoUv + vec2(-texel.x, -texel.y) * spread).rgb;
      smoothed += texture2D(uVideo, videoUv + vec2(0.0, -texel.y) * spread).rgb;
      smoothed += texture2D(uVideo, videoUv + vec2(texel.x, -texel.y) * spread).rgb;
      smoothed /= 9.0;
      color = mix(color, smoothed, uAnime);

      // 2. Boost saturation for vibrant anime colors
      float grey = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(grey), color, 1.0 + 0.5 * uAnime);

      // 3. Cel-shading: quantize luminance into discrete bands
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      float levels = uAnimeLevels;
      float quantLum = floor(lum * levels + 0.5) / levels;
      // Remap color to quantized luminance while preserving hue
      float lumSafe = max(lum, 0.001);
      vec3 celColor = color * (quantLum / lumSafe);
      color = mix(color, clamp(celColor, 0.0, 1.0), uAnime);

      // 4. Edge detection with larger kernel for thick ink outlines
      float edgeSpread = 3.0;
      // Sample luminance at wider offsets
      float s00 = dot(texture2D(uVideo, videoUv + vec2(-texel.x, texel.y) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s10 = dot(texture2D(uVideo, videoUv + vec2(0.0, texel.y) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s20 = dot(texture2D(uVideo, videoUv + vec2(texel.x, texel.y) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s01 = dot(texture2D(uVideo, videoUv + vec2(-texel.x, 0.0) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s21 = dot(texture2D(uVideo, videoUv + vec2(texel.x, 0.0) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s02 = dot(texture2D(uVideo, videoUv + vec2(-texel.x, -texel.y) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s12 = dot(texture2D(uVideo, videoUv + vec2(0.0, -texel.y) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));
      float s22 = dot(texture2D(uVideo, videoUv + vec2(texel.x, -texel.y) * edgeSpread).rgb, vec3(0.299, 0.587, 0.114));

      float gx = -s00 - 2.0*s01 - s02 + s20 + 2.0*s21 + s22;
      float gy = -s00 - 2.0*s10 - s20 + s02 + 2.0*s12 + s22;
      float edge = sqrt(gx * gx + gy * gy);

      // Hard threshold — only strong silhouette edges, not subtle gradients
      float inkLine = smoothstep(0.08, 0.15, edge * uAnimeEdge);
      color = mix(color, vec3(0.0), inkLine * uAnime);
    }

    // ── Desaturation (posterized B&W, same style as red frame) ──
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

    // ── Contrast (shadow crush + highlight blow) ──
    float contrastAmt = 1.0 + uContrast * uContrastMax;
    color = (color - 0.5) * contrastAmt + 0.5;
    color = clamp(color, 0.0, 1.0);

    // ── Vignette ──
    float dist = distance(uv, vec2(0.5));
    float vig = smoothstep(uVignetteRadius, uVignetteRadius + 0.4, dist);
    color *= 1.0 - vig * uVignette * uVignetteMax;

    // ── Film grain ──
    float noise = hash(uv * uViewRes + uTime * 100.0) * 2.0 - 1.0;
    color += noise * uGrain * uGrainMax;

    // ── Charge pulse (screen breathes during hold) ──
    if (uProgress > 0.001) {
      float pulseFreq = 8.0 + uProgress * 20.0;
      float pulseAmp = uProgress * 0.05;
      float pulse = sin(uTime * pulseFreq) * pulseAmp;
      color *= 1.0 + pulse;
    }

    // ── Screen cracks (Voronoi, subtle) ──
    if (uCracks > 0.01) {
      float crAspect = uViewRes.x / uViewRes.y;
      vec2 crUv = uv * uCrackScale;
      crUv.x *= crAspect;

      vec2 v = voronoi(crUv);
      float edge = v.y - v.x;
      float crack = 1.0 - smoothstep(0.0, 0.015, edge);

      vec2 toOriginCr = (uv - uOrigin) * vec2(crAspect, 1.0);
      float crDist = length(toOriginCr);
      float crSpread = 1.0 - smoothstep(uCrackSpread * 0.6, uCrackSpread, crDist);

      color += vec3(crack * crSpread * uCracks * 0.06);
    }

    // ── Halftone dots (spread from click origin) ──
    if (uHalftone > 0.01) {
      float htLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));

      // Rotated 45° grid
      float htA = 0.785;
      float htC = cos(htA);
      float htS = sin(htA);
      vec2 htUv = vec2(htC * uv.x - htS * uv.y, htS * uv.x + htC * uv.y);
      htUv *= uViewRes / uHalftoneScale;

      vec2 htCell = fract(htUv) - 0.5;
      float dotDist = length(htCell);
      // Bigger dots in darker areas
      float dotRadius = (1.0 - htLuma) * 0.45;
      float htDot = smoothstep(dotRadius, dotRadius - 0.08, dotDist);

      // Apply in mid-dark areas
      float htMask = smoothstep(0.7, 0.2, htLuma);
      color = mix(color, vec3(0.0), htDot * htMask * uHalftone);
    }

    // ── Impact frame (B&W → red, same posterized silhouette style) ──
    if (uDesaturation > 0.01 || uSelectiveRed > 0.01) {
      float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float lit = smoothstep(0.22, 0.55, l);
      vec3 bwFrame = mix(vec3(0.0), vec3(1.0), lit);
      vec3 redFrame = mix(vec3(0.0), vec3(0.9, 0.05, 0.02), lit);
      // Blend between B&W and red based on selectiveRed progress
      vec3 impactColor = mix(bwFrame, redFrame, uSelectiveRed);
      float impactAmt = max(uDesaturation, uSelectiveRed);
      color = mix(color, impactColor, impactAmt);
    }

    // ── Speed lines (drawn AFTER impact frame so they stay pure white) ──
    if (uSpeedLines > 0.01) {
      vec2 slDelta = uv - uOrigin;
      float slAspect = uViewRes.x / uViewRes.y;
      slDelta.x *= slAspect;

      float slDist = length(slDelta);
      float slAngle = atan(slDelta.y, slDelta.x);

      float aNorm = slAngle / 6.28318 + 0.5;
      float count = uSpeedLineCount;
      float cell = floor(aNorm * count);
      float cellFrac = fract(aNorm * count);

      float lr = hash(vec2(cell, 7.0));
      float isActive = step(0.4, lr);

      float tr = hash(vec2(cell, floor(uTime * 12.0)));
      float lineLen = 0.10 + tr * 0.25;
      float tipStart = max(0.3, 0.7 - lineLen);

      // Taper: pointed at tip (tipStart), thick toward edges
      float lineT = clamp((slDist - tipStart) / max(lineLen, 0.001), 0.0, 1.0);
      float baseThick = 0.10 + lr * 0.10;
      float thick = baseThick * lineT * lineT;
      float lineMask = 1.0 - smoothstep(0.0, thick + 0.005, abs(cellFrac - 0.5) * 2.0);

      float innerMask = smoothstep(tipStart, tipStart + 0.02, slDist);

      float bright = 0.4 + tr * 0.6;
      float sl = lineMask * innerMask * isActive * bright * uSpeedLines;
      // White on B&W, red on red scene
      vec3 lineColor = mix(vec3(1.0), vec3(0.9, 0.05, 0.02), uSelectiveRed);
      color = mix(color, lineColor, sl);
    }

    // ── White flash (additive) ──
    color += uFlash * 1.5;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

/* ─── ImpactScene ─── */

type ImpactSceneProps = { onReady?: () => void };

export function ImpactScene({ onReady }: ImpactSceneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { viewport, size } = useThree();

  const video = useStackedVideo("/videos/kung-fu-panda.mp4");
  const holdState = useHoldProgress();
  const fx = useStaggeredEffects(holdState.progress);

  useEffect(() => {
    if (video) onReady?.();
  }, [video, onReady]);

  // Track peak to fire one-shot tweens
  const peakFiredRef = useRef(false);
  const flashTweenRef = useRef<gsap.core.Tween | null>(null);
  const shakeTweenRef = useRef<gsap.core.Tween | null>(null);
  const speedLineTweenRef = useRef<gsap.core.Tween | null>(null);
  const crackTweenRef = useRef<gsap.core.Tween | null>(null);

  // Animated values driven by GSAP (not uniforms directly)
  const peakAnimRef = useRef({
    flash: 0,
    shakeX: 0,
    shakeY: 0,
    speedLineSpread: 0,
    crackSpread: 0,
  });

  /* ─── Leva: effect max values ─── */

  const effectControls = useControls("Impact Frame", {
    desaturation: folder({
      desatMax: { value: 0.9, min: 0, max: 1, step: 0.05 },
    }),
    contrast: folder({
      contrastMax: { value: 2.0, min: 0, max: 4, step: 0.1 },
    }),
    zoom: folder({
      zoomMax: { value: 0.15, min: 0, max: 0.5, step: 0.01 },
    }),
    vignette: folder({
      vignetteMax: { value: 0.8, min: 0, max: 1, step: 0.05 },
      vignetteRadius: { value: 0.3, min: 0.1, max: 0.8, step: 0.05 },
    }),
    grain: folder({
      grainMax: { value: 0.12, min: 0, max: 0.5, step: 0.01 },
    }),
    chromatic: folder({
      caMax: { value: 0.008, min: 0, max: 0.05, step: 0.001 },
    }),
    anime: folder({
      animeEdge: { value: 3.0, min: 0.5, max: 8, step: 0.5 },
      animeLevels: { value: 4.0, min: 2, max: 8, step: 1 },
    }),
    shake: folder({
      shakeMax: { value: 0.04, min: 0, max: 0.1, step: 0.005 },
      shakeFreq: { value: 40, min: 5, max: 60, step: 5 },
    }),
    speedLines: folder({
      speedLineCount: { value: 150, min: 20, max: 300, step: 10 },
      speedLineSpreadDur: { value: 0.25, min: 0.05, max: 1, step: 0.05 },
    }),
    cracks: folder({
      crackScale: { value: 6.0, min: 2, max: 15, step: 0.5 },
      crackSpreadDur: { value: 0.15, min: 0.05, max: 0.5, step: 0.05 },
    }),
    halftone: folder({
      halftoneScale: { value: 8.0, min: 3, max: 20, step: 1 },
    }),
    peak: folder({
      flashDuration: { value: 0.12, min: 0.05, max: 0.5, step: 0.01 },
      flashIntensity: { value: 1.0, min: 0, max: 2, step: 0.1 },
      peakShakeAmp: { value: 0.06, min: 0, max: 0.15, step: 0.005 },
      peakShakeDuration: { value: 0.5, min: 0.1, max: 1, step: 0.05 },
    }),
  });

  // Cleanup GSAP on unmount
  useEffect(() => {
    return () => {
      flashTweenRef.current?.kill();
      shakeTweenRef.current?.kill();
      speedLineTweenRef.current?.kill();
      crackTweenRef.current?.kill();
    };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uVideo: { value: null as THREE.VideoTexture | null },
      uVideoRes: { value: new THREE.Vector2(1920, 1080) },
      uViewRes: { value: new THREE.Vector2(1, 1) },
      uProgress: { value: 0 },
      uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
      // Effect intensities
      uDesaturation: { value: 0 },
      uContrast: { value: 0 },
      uZoom: { value: 0 },
      uVignette: { value: 0 },
      uGrain: { value: 0 },
      uCA: { value: 0 },
      // Peak
      uFlash: { value: 0 },
      uShakeOffset: { value: new THREE.Vector2(0, 0) },
      // Max values
      uDesatMax: { value: 0.9 },
      uContrastMax: { value: 2.0 },
      uZoomMax: { value: 0.15 },
      uVignetteMax: { value: 0.8 },
      uVignetteRadius: { value: 0.3 },
      uGrainMax: { value: 0.12 },
      uCAMax: { value: 0.008 },
      // Speed lines
      uSpeedLines: { value: 0 },
      uSpeedLineCount: { value: 150 },
      uSpeedLineSpread: { value: 0 },
      // Screen cracks
      uCracks: { value: 0 },
      uCrackSpread: { value: 0 },
      uCrackScale: { value: 6.0 },
      // Halftone
      uHalftone: { value: 0 },
      uHalftoneScale: { value: 8.0 },
      // Selective red
      uSelectiveRed: { value: 0 },
      // Anime stylization
      uAnime: { value: 0 },
      uAnimeEdge: { value: 3.0 },
      uAnimeLevels: { value: 4.0 },
    }),
    []
  );

  useFrame(() => {
    if (!matRef.current) return;
    const mat = matRef.current;
    const u = mat.uniforms;

    u.uTime.value = performance.now() / 1000;

    // Video texture + playback rate
    if (video) {
      u.uVideo.value = video.texture;
      u.uVideoRes.value.set(
        video.el.videoWidth || 1920,
        video.el.videoHeight || 1080
      );

      // Video: slow on hold, pause at peak
      if (holdState.phase === "peak") {
        video.el.pause();
      } else if (holdState.phase === "building") {
        // Slight dip then quick ramp (uses sqrt to counter slow exponential progress)
        const p = Math.sqrt(holdState.progress);
        const rate = 0.7 + p * 0.8; // 0.7x → 1.5x, linear on sqrt(progress)
        video.setPlaybackRate(Math.max(0.0625, rate));
      } else {
        if (video.el.paused) video.el.play();
        video.setPlaybackRate(1.0);
      }
    }

    // Viewport
    u.uViewRes.value.set(size.width, size.height);

    // Hold state
    u.uProgress.value = holdState.progress;
    u.uOrigin.value.set(holdState.origin[0], holdState.origin[1]);

    // Effect intensities
    // B&W snaps instantly on click, color snaps back on release
    u.uDesaturation.value =
      holdState.phase === "building" || holdState.phase === "peak" ? 1.0 : 0;
    u.uContrast.value = fx.contrast;
    u.uZoom.value = fx.zoom;
    u.uVignette.value = fx.vignette;
    u.uGrain.value = fx.grain;
    u.uCA.value = fx.chromaticAberration;
    u.uAnime.value = fx.anime;
    u.uAnimeEdge.value = effectControls.animeEdge;
    u.uAnimeLevels.value = effectControls.animeLevels;

    // Max values from Leva
    u.uDesatMax.value = effectControls.desatMax;
    u.uContrastMax.value = effectControls.contrastMax;
    u.uZoomMax.value = effectControls.zoomMax;
    u.uVignetteMax.value = effectControls.vignetteMax;
    u.uVignetteRadius.value = effectControls.vignetteRadius;
    u.uGrainMax.value = effectControls.grainMax;
    u.uCAMax.value = effectControls.caMax;
    u.uSpeedLineCount.value = effectControls.speedLineCount;
    u.uCrackScale.value = effectControls.crackScale;
    u.uHalftoneScale.value = effectControls.halftoneScale;

    // ── Reset shake each frame, then accumulate ──
    u.uShakeOffset.value.set(0, 0);

    // Buildup: sinusoidal trembling
    if (fx.shake > 0.01) {
      const t = performance.now() / 1000;
      const freq = effectControls.shakeFreq;
      const amp = fx.shake * effectControls.shakeMax;
      u.uShakeOffset.value.set(
        Math.sin(t * freq) * amp,
        Math.cos(t * freq * 1.3) * amp
      );
    }

    // ── Peak: fire one-shot flash + directional shake ──
    if (holdState.peakTriggered && !peakFiredRef.current) {
      peakFiredRef.current = true;
      const anim = peakAnimRef.current;

      // Kill previous tweens
      flashTweenRef.current?.kill();
      shakeTweenRef.current?.kill();
      speedLineTweenRef.current?.kill();
      crackTweenRef.current?.kill();

      // White flash: spike to intensity, then fade
      anim.flash = effectControls.flashIntensity;
      flashTweenRef.current = gsap.to(anim, {
        flash: 0,
        duration: effectControls.flashDuration,
        ease: "power2.out",
      });

      // Directional screen shake: sharp hit then dampen
      const angle = Math.random() * Math.PI * 2;
      const amp = effectControls.peakShakeAmp;
      anim.shakeX = Math.cos(angle) * amp;
      anim.shakeY = Math.sin(angle) * amp;
      shakeTweenRef.current = gsap.to(anim, {
        shakeX: 0,
        shakeY: 0,
        duration: effectControls.peakShakeDuration,
        ease: "elastic.out(1, 0.3)",
      });

      // Speed lines: burst outward from origin
      anim.speedLineSpread = 0;
      speedLineTweenRef.current = gsap.to(anim, {
        speedLineSpread: 1.0,
        duration: effectControls.speedLineSpreadDur,
        ease: "power2.out",
      });

      // Notify HTML overlay (onomatopoeia)
      window.dispatchEvent(
        new CustomEvent("impact-peak", {
          detail: { x: holdState.origin[0], y: holdState.origin[1] },
        })
      );

      // Screen cracks: propagate from origin
      anim.crackSpread = 0;
      crackTweenRef.current = gsap.to(anim, {
        crackSpread: 1.0,
        duration: effectControls.crackSpreadDur,
        ease: "power3.out",
      });
    }

    // Reset peak fired when no longer at peak
    if (holdState.phase !== "peak" && holdState.phase !== "building") {
      peakFiredRef.current = false;
    }

    // Add GSAP-driven peak shake on top of buildup shake
    const anim = peakAnimRef.current;
    u.uFlash.value = anim.flash;
    u.uShakeOffset.value.x += anim.shakeX;
    u.uShakeOffset.value.y += anim.shakeY;

    // Speed lines: build during hold, full at peak, snap off on release
    if (holdState.phase === "peak") {
      u.uSpeedLines.value = 1.0;
    } else if (holdState.phase === "building") {
      u.uSpeedLines.value = holdState.progress;
    } else {
      u.uSpeedLines.value = 0;
    }
    u.uSpeedLineSpread.value = anim.speedLineSpread;

    // Screen cracks: same lifecycle as speed lines
    if (holdState.phase === "peak") {
      u.uCracks.value = 1.0;
    } else if (holdState.phase === "reverting") {
      u.uCracks.value = Math.max(0, holdState.progress);
    } else {
      u.uCracks.value = 0;
    }
    u.uCrackSpread.value = anim.crackSpread;

    // Halftone: build during hold, full at peak, snap off on release
    if (holdState.phase === "peak") {
      u.uHalftone.value = 1.0;
    } else if (holdState.phase === "building") {
      u.uHalftone.value = holdState.progress;
    } else {
      u.uHalftone.value = 0;
    }

    // Selective red: ramps during hold, full at peak, snaps off on release
    if (holdState.phase === "peak") {
      u.uSelectiveRed.value = 1.0;
    } else if (holdState.phase === "building") {
      u.uSelectiveRed.value = fx.selectiveRed;
    } else {
      u.uSelectiveRed.value = 0;
    }

    // Fill viewport
    if (meshRef.current) {
      meshRef.current.scale.set(viewport.width, viewport.height, 1);
    }
  });

  return (
    <>
      <mesh ref={meshRef} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={fullscreenVert}
          fragmentShader={buildupFrag}
          uniforms={uniforms}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <InkParticles
        peakTriggered={holdState.peakTriggered}
        origin={holdState.origin}
        phase={holdState.phase}
        viewportWidth={viewport.width}
        viewportHeight={viewport.height}
      />
    </>
  );
}
