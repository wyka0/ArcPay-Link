/* eslint-disable react-hooks/immutability -- R3F materials are mutated
   imperatively inside useFrame; this is the standard react-three-fiber pattern
   and is how the ported Skal template drives its shader uniforms. */
"use client";

import { createPortal, useFrame } from "@react-three/fiber";
import * as easing from "maath/easing";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FloatType,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  WebGLRenderTarget,
} from "three";

import { DofPointsMaterial } from "./shaders/pointMaterial";
import { SimulationMaterial } from "./shaders/simulationMaterial";

/**
 * Local replacement for drei's `useFBO` — the template's only drei usage — so
 * the large drei bundle is not shipped for a single render-target helper.
 * Identical behaviour: a nearest-filtered float RGBA render target at `size`.
 */
function useRenderTarget(size: number) {
  const target = useMemo(
    () =>
      new WebGLRenderTarget(size, size, {
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        format: RGBAFormat,
        type: FloatType,
      }),
    [size],
  );
  useEffect(() => () => target.dispose(), [target]);
  return target;
}

/**
 * Ported from the Skal Ventures template (`components/gl/particles.tsx`).
 *
 * Compatibility changes only:
 * - `reducedMotion` freezes the field on a fully-revealed frame.
 * - the trailing prop spread was dropped (no callers forward extra props).
 */
export function Particles({
  speed,
  aperture,
  focus,
  size = 512,
  noiseScale = 1.0,
  noiseIntensity = 0.5,
  timeScale = 0.5,
  pointSize = 2.0,
  opacity = 1.0,
  planeScale = 1.0,
  introspect = false,
  reducedMotion = false,
}: {
  speed: number;
  aperture: number;
  focus: number;
  size: number;
  noiseScale?: number;
  noiseIntensity?: number;
  timeScale?: number;
  pointSize?: number;
  opacity?: number;
  planeScale?: number;
  introspect?: boolean;
  reducedMotion?: boolean;
}) {
  const revealStartTime = useRef<number | null>(null);
  const revealDuration = 3.5; // seconds

  const simulationMaterial = useMemo(() => {
    return new SimulationMaterial(planeScale, size);
  }, [planeScale, size]);

  const target = useRenderTarget(size);

  const dofPointsMaterial = useMemo(() => {
    const m = new DofPointsMaterial();
    m.uniforms.positions.value = target.texture;
    m.uniforms.initialPositions.value =
      simulationMaterial.uniforms.positions.value;
    return m;
  }, [simulationMaterial, target]);

  const [scene] = useState(() => new Scene());
  const [camera] = useState(
    () => new OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1),
  );
  const [positions] = useState(
    () =>
      new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
      ]),
  );
  const [uvs] = useState(
    () => new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]),
  );

  const particles = useMemo(() => {
    const length = size * size;
    const positionsArray = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) {
      const i3 = i * 3;
      positionsArray[i3 + 0] = (i % size) / size;
      positionsArray[i3 + 1] = i / size / size;
    }
    return positionsArray;
  }, [size]);

  useFrame((state, delta) => {
    if (!dofPointsMaterial || !simulationMaterial) return;

    state.gl.setRenderTarget(target);
    state.gl.clear();
    state.gl.render(scene, camera);
    state.gl.setRenderTarget(null);

    const currentTime = reducedMotion ? 6.0 : state.clock.elapsedTime;

    if (revealStartTime.current === null) {
      revealStartTime.current = currentTime;
    }

    const revealElapsed = currentTime - revealStartTime.current;
    const revealProgress = reducedMotion
      ? 1.0
      : Math.min(revealElapsed / revealDuration, 1.0);

    const easedProgress = 1 - Math.pow(1 - revealProgress, 3);
    const revealFactor = easedProgress * 4.0;

    dofPointsMaterial.uniforms.uTime.value = currentTime;

    dofPointsMaterial.uniforms.uFocus.value = focus;
    dofPointsMaterial.uniforms.uBlur.value = aperture;

    easing.damp(
      dofPointsMaterial.uniforms.uTransition,
      "value",
      introspect ? 1.0 : 0.0,
      introspect ? 0.35 : 0.2,
      delta,
    );

    simulationMaterial.uniforms.uTime.value = currentTime;
    simulationMaterial.uniforms.uNoiseScale.value = noiseScale;
    simulationMaterial.uniforms.uNoiseIntensity.value = noiseIntensity;
    simulationMaterial.uniforms.uTimeScale.value = timeScale * speed;

    dofPointsMaterial.uniforms.uPointSize.value = pointSize;
    dofPointsMaterial.uniforms.uOpacity.value = opacity;
    dofPointsMaterial.uniforms.uRevealFactor.value = revealFactor;
    dofPointsMaterial.uniforms.uRevealProgress.value = easedProgress;
  });

  return (
    <>
      {createPortal(
        <mesh material={simulationMaterial}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[positions, 3]}
            />
            <bufferAttribute attach="attributes-uv" args={[uvs, 2]} />
          </bufferGeometry>
        </mesh>,
        scene,
      )}
      <points material={dofPointsMaterial}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles, 3]} />
        </bufferGeometry>
      </points>
    </>
  );
}
