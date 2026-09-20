"use client";

import { EffectComposer } from "@react-three/postprocessing";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";

import { Particles } from "./particles";
import { VignetteEffect } from "./shaders/vignetteEffect";

/**
 * ArcPay WebGL background — ported from the Skal Ventures template
 * (`components/gl/index.tsx`).
 *
 * The particle system and shaders are the template's. Changes are limited to:
 * - controls are fixed to the template's default values (the dev-only Leva GUI
 *   and r3f-perf overlay are not shipped);
 * - DPR is capped at 2, density drops on small screens, the loop pauses when
 *   the tab is hidden, and `prefers-reduced-motion` renders a static field.
 */
export function GL({ hovering }: { hovering: boolean }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compact, setCompact] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sizeQuery = window.matchMedia("(max-width: 768px)");

    const sync = () => {
      setReducedMotion(motionQuery.matches);
      setCompact(sizeQuery.matches);
    };
    sync();

    const onVisibility = () => setVisible(!document.hidden);

    motionQuery.addEventListener("change", sync);
    sizeQuery.addEventListener("change", sync);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      motionQuery.removeEventListener("change", sync);
      sizeQuery.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // `size` is the template's own quality knob (256/512/1024). 256 keeps the
  // field dense (65k points) at a quarter of the texture work; smaller screens
  // and reduced-motion drop to 192.
  const size = reducedMotion ? 128 : compact ? 192 : 256;
  const frameloop = reducedMotion ? "demand" : visible ? "always" : "never";

  return (
    <div id="webgl" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        frameloop={frameloop}
        camera={{
          position: [
            1.2629783123314589, 2.664606471394044, -1.8178993743288914,
          ],
          fov: 50,
          near: 0.01,
          far: 300,
        }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#000"]} />
        <Particles
          speed={1.0}
          aperture={1.79}
          focus={3.8}
          size={size}
          noiseScale={0.6}
          noiseIntensity={0.52}
          timeScale={1}
          pointSize={10.0}
          opacity={0.8}
          planeScale={10.0}
          introspect={hovering}
          reducedMotion={reducedMotion}
        />
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <VignetteEffect />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
