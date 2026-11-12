// Glow (bloom) post filter (docs/features/fr4.1-post-stack.md). Works on the HDR render, so put it before
// Tonemap. Passes:
//   1. bright pass at full resolution: max-channel threshold with a soft knee (on premultiplied colour);
//   2. down-sample chain: level i = ceil(level i-1 / 2) per axis, 5-tap "dual filter" (13-texel footprint);
//   3. up-sample chain: U_i = mix(D_i, tent(U_i+1), a_i) giving level weights ∝ (1 - r) r^(i-1) for radius r,
//      normalised to sum to 1 (so a uniformly bright area glows by exactly `intensity`) — radius moves weight to the
//      wider levels;
//   4. composite: input + tent(U_1) × intensity × tint (straight alpha: glow over transparent pixels raises alpha).
// Every level spans the whole texture (non-integer ratios for odd sizes), and all sampling is wrap-aware when the
// project is tileable, so the glow bleeds across the tile seam. Down to 1×1 levels for tiny textures.

import * as THREE from 'three';
import { P } from '@/core/params';
import type { PostDef } from './types';

const SAMPLING = /* glsl */ `
uniform vec2 uSrcRes; // size of the texture being sampled (tInput unless stated)

// 3×3 tent (1 2 1) of bilinear taps one source texel apart. They cover one 4×4 block of texels, so it is fetched
// once with the combined weights per axis: (1 − f, 2 − f, 1 + f, f) / 4 at offsets −1 … 2 from the bilinear base.
vec4 glowTent(sampler2D t, vec2 res, vec2 px) {
  ivec2 r = ivec2(res);
  vec2 q = px - 0.5;
  vec2 f = fract(q);
  ivec2 i = ivec2(floor(q)) - 1;
  vec4 wx = vec4(1.0 - f.x, 2.0 - f.x, 1.0 + f.x, f.x) * 0.25;
  vec4 wy = vec4(1.0 - f.y, 2.0 - f.y, 1.0 + f.y, f.y) * 0.25;
  vec4 s = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    vec4 row = vec4(0.0);
    for (int x = 0; x < 4; x++) row += fetchTSized(t, r, i + ivec2(x, y)) * wx[x];
    s += row * wy[y];
  }
  return s;
}
// Where this fragment's centre falls in the source texture (each level spans the whole image).
vec2 glowSrcPos(vec2 srcRes) { return gl_FragCoord.xy * srcRes / uRes; }
`;

const BRIGHT = /* glsl */ `
void main() {
  vec4 c = texelFetch(tInput, ivec2(gl_FragCoord.xy), 0);
  vec3 x = max(c.rgb, vec3(0.0)) * clamp(c.a, 0.0, 1.0);
  float br = max(x.r, max(x.g, x.b));
  float knee = max(u_threshold * u_knee, 1e-4);
  float soft = clamp(br - u_threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float w = max(soft, br - u_threshold) / max(br, 1e-6);
  oColor = vec4(min(x * w, vec3(65000.0)), 1.0);
}
`;

const DOWN =
	SAMPLING +
	/* glsl */ `
void main() {
  vec2 q = glowSrcPos(uSrcRes);
  // The centre (weight 4), then the four diagonal neighbours, through one sampleTSized.
  vec4 s = vec4(0.0);
  for (int j = 0; j < 5 * UNI_1; j++) {
    vec2 o = j == 0 ? vec2(0.0) : vec2((j & 1) == 1 ? -1.0 : 1.0, j < 3 ? -1.0 : 1.0);
    s += sampleTSized(tInput, ivec2(uSrcRes), q + o) * (j == 0 ? 4.0 : 1.0);
  }
  oColor = s / 8.0;
}
`;

const UP =
	SAMPLING +
	/* glsl */ `
uniform sampler2D tDown;   // D_i, same size as the target
uniform float uScatter;
void main() {
  vec4 d = texelFetch(tDown, ivec2(gl_FragCoord.xy), 0);
  vec4 u = glowTent(tInput, uSrcRes, glowSrcPos(uSrcRes));
  oColor = mix(d, u, uScatter);
}
`;

const COMPOSITE =
	SAMPLING +
	/* glsl */ `
uniform sampler2D tBloom;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(tInput, ip, 0);
  vec3 g = glowTent(tBloom, uSrcRes, glowSrcPos(uSrcRes)).rgb * u_intensity * u_tint;
  float a = clamp(c.a, 0.0, 1.0);
  if (a >= 1.0) { oColor = vec4(c.rgb + g, c.a); return; }
  // Straight alpha: add the glow to premultiplied colour and let it cover transparent pixels.
  float a2 = a + (1.0 - a) * clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0);
  vec3 p = c.rgb * a + g;
  oColor = vec4(a2 > 1e-6 ? p / a2 : vec3(0.0), a2);
}
`;

export const glowPost: PostDef = {
	type: 'glow',
	label: 'Glow',
	description: 'Bloom around bright (HDR) areas such as emissive lights. Put it before Tonemap.',
	params: [
		P.float('threshold', 'Threshold', 1, 0, 50, {
			softMax: 4,
			step: 0.01,
			hint: 'Brightness (max channel, linear) where glow starts. 1 = display white.'
		}),
		P.float('knee', 'Soft knee', 0.5, 0, 1, { step: 0.01, hint: 'Fades the glow in below the threshold.' }),
		P.float('intensity', 'Intensity', 1, 0, 20, { softMax: 4, step: 0.01 }),
		P.float('radius', 'Radius', 0.6, 0, 0.98, {
			step: 0.01,
			hint: 'Spread: low = tight glow, high = wide halo (weights the coarser blur levels).'
		}),
		P.int('levels', 'Levels', 6, 1, 8, {
			hint: 'Blur levels (each halves the resolution); limits the widest halo. Halo sizes are relative to the canvas, so a bigger canvas glows wider in px.'
		}),
		P.color('tint', 'Tint', '#ffffff')
	],
	run(ctx, input, output) {
		const p = ctx.filter.params;
		const levels = Number(p.levels ?? 6);
		const scatter = Number(p.radius ?? 0.6);
		const W = ctx.width;
		const H = ctx.height;

		const bright = ctx.scratch('bright', W, H);
		ctx.run(ctx.material('bright', BRIGHT), bright, input);

		// Down-sample chain.
		const down = ctx.material('down', DOWN, { uSrcRes: { value: new THREE.Vector2() } });
		const downs: THREE.WebGLRenderTarget[] = [];
		let src = bright;
		for (let i = 1; i <= levels; i++) {
			if (i > 1 && src.width === 1 && src.height === 1) break;
			const t = ctx.scratch(`down${i}`, Math.max(1, Math.ceil(src.width / 2)), Math.max(1, Math.ceil(src.height / 2)));
			(down.uniforms.uSrcRes.value as THREE.Vector2).set(src.width, src.height);
			ctx.run(down, t, src.texture);
			downs.push(t);
			src = t;
		}

		// Up-sample chain.
		const up = ctx.material('up', UP, {
			uSrcRes: { value: new THREE.Vector2() },
			tDown: { value: null },
			uScatter: { value: 0 }
		});
		// Level weights ∝ (1 - s) s^(i-1), normalised over the levels that exist (small textures have fewer), so the
		// coarsest level never soaks up the remainder: U_i = mix(D_i, U_i+1, s (1 - s^(n-i)) / (1 - s^(n-i+1))).
		const n = downs.length;
		let acc = downs[n - 1];
		for (let i = n - 2; i >= 0; i--) {
			const d = downs[i];
			const t = ctx.scratch(`up${i + 1}`, d.width, d.height);
			const rest = n - 1 - i; // levels below this one
			up.uniforms.uScatter.value = scatter > 0 ? (scatter * (1 - scatter ** rest)) / (1 - scatter ** (rest + 1)) : 0;
			(up.uniforms.uSrcRes.value as THREE.Vector2).set(acc.width, acc.height);
			up.uniforms.tDown.value = d.texture;
			ctx.run(up, t, acc.texture);
			acc = t;
		}

		const comp = ctx.material('composite', COMPOSITE, {
			uSrcRes: { value: new THREE.Vector2() },
			tBloom: { value: null }
		});
		(comp.uniforms.uSrcRes.value as THREE.Vector2).set(acc.width, acc.height);
		comp.uniforms.tBloom.value = acc.texture;
		ctx.run(comp, output, input);
	}
};
