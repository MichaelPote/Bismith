// Stage 5: present a buffer in the viewport canvas with zoom / pan, nearest sampling, 5×5 tile preview,
// pixel grid, alpha checkerboard and per-channel visualisation.

import * as THREE from 'three';
import type { Gpu } from '@/gpu/context';
import { GLSL_COMMON } from '@/layers/glsl/common';
import { MASK_EMPTY } from './materialPipeline';

export type ChannelView =
	| 'final'
	| 'diffuse'
	| 'height'
	| 'roughness'
	| 'specular'
	| 'metal'
	| 'normal'
	| 'ao'
	| 'emissive'
	| 'opacity'
	| 'masks';

export const CHANNEL_VIEWS: { id: ChannelView; label: string; key: string }[] = [
	{ id: 'final', label: 'Final', key: '1' },
	{ id: 'diffuse', label: 'Diffuse', key: '2' },
	{ id: 'height', label: 'Height', key: '3' },
	{ id: 'roughness', label: 'Roughness', key: '4' },
	{ id: 'specular', label: 'Specular', key: '5' },
	{ id: 'metal', label: 'Metalness', key: 'm' },
	{ id: 'normal', label: 'Normal', key: '6' },
	{ id: 'ao', label: 'AO', key: '7' },
	{ id: 'emissive', label: 'Emissive', key: '8' },
	{ id: 'opacity', label: 'Opacity', key: '9' },
	{ id: 'masks', label: 'Masks', key: '0' }
];

/** The shader's mode per channel (MODE_<CHANNEL> in it). */
const MODE: Record<ChannelView, number> = {
	final: 0,
	diffuse: 1,
	height: 2,
	roughness: 3,
	normal: 4,
	emissive: 5,
	opacity: 6,
	masks: 7,
	specular: 8,
	ao: 9,
	metal: 10
};

export interface ViewTransform {
	/** Canvas device px per texel. */
	zoom: number;
	/** Canvas device px of the texture's top-left corner from the canvas top-left. */
	offsetX: number;
	offsetY: number;
}

export interface DisplayOptions {
	tile: boolean;
	grid: boolean;
	checker: boolean;
}

/** The viewport round the texture (display sRGB). */
export const VOID_COLOR: readonly [number, number, number] = [0.09, 0.098, 0.11];

const glFloat = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

const FRAG = /* glsl */ `
${Object.entries(MODE)
	.map(([k, v]) => `#define MODE_${k.toUpperCase()} ${v}`)
	.join('\n')}
uniform sampler2D tImage;
uniform int uMode;
uniform vec2 uTex;
uniform vec2 uCanvas;
uniform vec2 uOffset;   // top-left corner of the texture, canvas px from top-left
uniform float uZoom;
uniform bool uTileView;
uniform bool uGrid;
uniform bool uChecker;
uniform vec2 uHRange;
uniform float uSS;      // texels of tImage per texture pixel (supersampled material maps)
out vec4 oColor;

const vec3 voidColor = vec3(${VOID_COLOR.map(glFloat).join(', ')});

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);      // canvas px, y down
  vec2 t = (fc - uOffset) / uZoom;                                  // texel coords, y down
  vec2 lo = uTileView ? -2.0 * uTex : vec2(0.0);
  vec2 hi = uTileView ? 3.0 * uTex : uTex;
  if (any(lessThan(t, lo)) || any(greaterThanEqual(t, hi))) { oColor = vec4(voidColor, 1.0); return; }
  vec2 tk = mod(t, uTex) * uSS;                                     // wrapped (tile view), in tImage texels
  ivec2 ci = ivec2(floor(tk));
  ivec2 gl = ivec2(ci.x, int(uTex.y * uSS + 0.5) - 1 - ci.y);
  vec4 v = texelFetch(tImage, gl, 0);
  vec3 col;
  float alpha = 1.0;
  bool encode = true;
  if (uMode == MODE_FINAL || uMode == MODE_DIFFUSE) { col = max(v.rgb, 0.0); alpha = clamp(v.a, 0.0, 1.0); }
  else if (uMode == MODE_HEIGHT) { float span = max(uHRange.y - uHRange.x, 1e-5); col = vec3((v.w - uHRange.x) / span); encode = false; }
  else if (uMode == MODE_ROUGHNESS) { col = vec3(v.g); encode = false; }
  else if (uMode == MODE_METAL) { col = vec3(v.b); encode = false; }
  else if (uMode == MODE_NORMAL) { col = v.xyz * 0.5 + 0.5; encode = false; }
  else if (uMode == MODE_EMISSIVE) { col = v.rgb / (1.0 + luma(v.rgb)); }
  else if (uMode == MODE_OPACITY || uMode == MODE_SPECULAR) { col = vec3(v.a); encode = false; }
  else if (uMode == MODE_AO) { col = vec3(v.r); encode = false; }
  else {
    // A mask (FR8.23): distance bands, inside orange — or, where there are features, each its own hue (by its random).
    float d = v.x;
    if (d > ${glFloat(MASK_EMPTY * 0.5)}) col = vec3(0.12);
    else {
      vec3 hue = clamp(abs(mod(v.y * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      vec3 inside = v.z > 0.5 ? mix(vec3(0.96, 0.43, 0.06), hue, 0.55) : vec3(0.96, 0.43, 0.06), outside = vec3(0.49, 0.66, 0.69);
      col = (d < 0.0 ? inside : outside) * (0.35 + 0.25 * cos(d * 0.8));
      col *= 1.0 - exp(-abs(d) * 0.6) * 0.8;
      col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 1.0, abs(d)));
    }
    encode = false;
  }
  col = clamp(col, 0.0, 1.0);
  if (encode) col = linearToSrgb(col);
  if (uChecker && alpha < 1.0) {
    vec2 cb = floor(fc / 8.0);
    float k = mod(cb.x + cb.y, 2.0);
    vec3 chk = mix(vec3(0.17, 0.19, 0.21), vec3(0.23, 0.25, 0.27), k);
    col = mix(chk, col, alpha);
  }
  if (uGrid && uZoom >= 12.0) {
    vec2 f = fract(t) * uZoom;
    if (f.x < 1.0 || f.y < 1.0) col = mix(col, vec3(0.0), 0.14);
  }
  oColor = vec4(col, 1.0);
}
`;

export class Display {
	private gpu: Gpu;
	private mat: THREE.RawShaderMaterial;

	constructor(gpu: Gpu) {
		this.gpu = gpu;
		this.mat = gpu.material(GLSL_COMMON + FRAG, {
			uRes: { value: new THREE.Vector2() },
			uTile: { value: false },
			tImage: { value: null },
			uMode: { value: 0 },
			uTex: { value: new THREE.Vector2() },
			uCanvas: { value: new THREE.Vector2() },
			uOffset: { value: new THREE.Vector2() },
			uZoom: { value: 1 },
			uTileView: { value: false },
			uGrid: { value: false },
			uChecker: { value: true },
			uHRange: { value: new THREE.Vector2(0, 1) },
			uSS: { value: 1 }
		});
	}

	draw(
		texture: THREE.Texture,
		channel: ChannelView,
		texSize: [number, number],
		canvasSize: [number, number],
		view: ViewTransform,
		opts: DisplayOptions,
		heightRange: [number, number],
		texelScale = 1
	): void {
		const u = this.mat.uniforms;
		u.tImage.value = texture;
		u.uSS.value = texelScale;
		u.uMode.value = MODE[channel];
		(u.uTex.value as THREE.Vector2).set(texSize[0], texSize[1]);
		(u.uCanvas.value as THREE.Vector2).set(canvasSize[0], canvasSize[1]);
		(u.uOffset.value as THREE.Vector2).set(view.offsetX, view.offsetY);
		u.uZoom.value = view.zoom;
		u.uTileView.value = opts.tile;
		u.uGrid.value = opts.grid;
		u.uChecker.value = opts.checker;
		(u.uHRange.value as THREE.Vector2).set(heightRange[0], heightRange[1]);
		this.gpu.run(this.mat, null);
	}

	dispose(): void {
		this.mat.dispose();
	}
}
