import { wrapEffect } from "@react-three/postprocessing";
import { BlendFunction, Effect } from "postprocessing";
import { Uniform } from "three";

/**
 * The template's `vignetteShader` expressed as a `postprocessing.Effect`.
 *
 * The math is identical to `vignetteShader.ts`:
 *   dist     = dot((uv - 0.5) * 2.0, (uv - 0.5) * 2.0)
 *   vignette = 1.0 - smoothstep(offset, offset + darkness, dist)
 *   color    = inputColor.rgb * vignette
 *
 * Defaults match the template's control values (darkness 1.5, offset 0.4).
 */
class VignetteEffectImpl extends Effect {
  constructor({
    darkness = 1.5,
    offset = 0.4,
  }: { darkness?: number; offset?: number } = {}) {
    super(
      "VignetteEffect",
      /* glsl */ `
      uniform float darkness;
      uniform float offset;

      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 centered = (uv - 0.5) * 2.0;
        float dist = dot(centered, centered);
        float vignette = 1.0 - smoothstep(offset, offset + darkness, dist);
        outputColor = vec4(inputColor.rgb * vignette, inputColor.a);
      }
    `,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, Uniform<number>>([
          ["darkness", new Uniform(darkness)],
          ["offset", new Uniform(offset)],
        ]),
      },
    );
  }
}

export const VignetteEffect = wrapEffect(VignetteEffectImpl);
