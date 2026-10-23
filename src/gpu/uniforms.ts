// ParamDef → GLSL uniform declarations and values. Every param `key` becomes `u_<key>`:
//   float/seed → float · int → int · bool → bool · enum → int (option index)
//   color → vec3 (LINEAR rgb) · gradient → vec4 u_<key>_stops[8] (sRGB rgb, position) + int u_<key>_count
//   text with a 'points' / 'lines' `bitmap` → vec4 u_<key>[64] (polygon vertices) + ivec2 u_<key>_size;
//   other text params are not uploaded (Stamp's pixels and Label's text are read on the CPU)

import * as THREE from 'three';
import { hexToLinear, hexToRgb } from '@/core/color';
import { MAX_PATH_POINTS, packPolygons, parsePolygons, parsePolylines } from '@/core/bitmap';
import {
	MAX_CURVE_POINTS,
	MAX_GRADIENT_STOPS,
	curveTangents,
	enumIndex,
	type Curve,
	type Gradient,
	type ParamDef,
	type ParamValues
} from '@/core/params';
import type { Uniforms } from './context';

/** Text params uploaded as path vertices. */
const isPathBitmap = (d: ParamDef) => d.bitmap === 'points' || d.bitmap === 'lines';
/** Params that become uniforms: all but `uniform: false` and text other than paths. */
const hasUniform = (d: ParamDef) => d.uniform !== false && (d.type !== 'text' || isPathBitmap(d));

/** A text param's packed uniform: its data and `_size`. */
interface PackedText {
	data: Float32Array;
	size: [number, number];
}
/** Packed text by kind and value: materials are updated many times per evaluation, the text rarely changes. */
const packedText = new Map<string, PackedText>();

function packText(d: ParamDef, value: string): PackedText {
	const key = `${d.bitmap}\u0000${value}`;
	let p = packedText.get(key);
	if (!p) {
		const pk = packPolygons(d.bitmap === 'lines' ? parsePolylines(value) : parsePolygons(value));
		p = { data: pk.data, size: [pk.count, pk.polygons] };
		if (packedText.size >= 64) packedText.clear();
		packedText.set(key, p);
	}
	return p;
}

export function declareUniforms(defs: ParamDef[]): string {
	const lines: string[] = [];
	for (const d of defs) {
		if (!hasUniform(d)) continue;
		const n = `u_${d.key}`;
		switch (d.type) {
			case 'float':
			case 'seed':
				lines.push(`uniform float ${n};`);
				break;
			case 'int':
			case 'enum':
				lines.push(`uniform int ${n};`);
				break;
			case 'bool':
				lines.push(`uniform bool ${n};`);
				break;
			case 'color':
				lines.push(`uniform vec3 ${n};`);
				break;
			case 'gradient':
				lines.push(`uniform vec4 ${n}_stops[${MAX_GRADIENT_STOPS}];`, `uniform int ${n}_count;`);
				break;
			case 'curve':
				// Points (x, y, slope, 0) for a shape-preserving cubic Hermite; curve_<key>(x) evaluates it.
				lines.push(
					`uniform vec4 ${n}_pts[${MAX_CURVE_POINTS}];`,
					`uniform int ${n}_count;`,
					// (The loop runs to the uniform count, without break or return: FXC on D3D11 unrolls a loop to a constant
					// capacity with an early exit, and this function is inlined at every bevel-profile call site —
					// docs/shader-compilation.md.)
					`float curve_${d.key}(float x) {
  int c = min(${n}_count, ${MAX_CURVE_POINTS});
  x = clamp(x, 0.0, 1.0);
  float y = ${n}_pts[max(c - 1, 0)].y;
  bool found = x <= ${n}_pts[0].x;
  if (found) y = ${n}_pts[0].y;
  for (int i = 0; i < c - 1; i++) {
    vec4 a = ${n}_pts[i], b = ${n}_pts[i + 1];
    if (!found && x <= b.x) {
      found = true;
      float h = max(b.x - a.x, 1e-6), t = (x - a.x) / h, t2 = t * t, t3 = t2 * t;
      y = (2.0 * t3 - 3.0 * t2 + 1.0) * a.y + (t3 - 2.0 * t2 + t) * h * a.z + (-2.0 * t3 + 3.0 * t2) * b.y + (t3 - t2) * h * b.z;
    }
  }
  return y;
}`
				);
				break;
			case 'text':
				lines.push(`uniform vec4 ${n}[${MAX_PATH_POINTS}];`, `uniform ivec2 ${n}_size;`);
				break;
		}
	}
	return lines.join('\n') + '\n';
}

export function createUniforms(defs: ParamDef[]): Uniforms {
	const u: Uniforms = {};
	for (const d of defs) {
		if (!hasUniform(d)) continue;
		const n = `u_${d.key}`;
		if (d.type === 'color') u[n] = { value: new THREE.Vector3() };
		else if (d.type === 'curve') {
			u[`${n}_pts`] = { value: Array.from({ length: MAX_CURVE_POINTS }, () => new THREE.Vector4()) };
			u[`${n}_count`] = { value: 0 };
		} else if (d.type === 'text') {
			u[n] = { value: new Float32Array(MAX_PATH_POINTS * 4) };
			u[`${n}_size`] = { value: new Int32Array(2) };
		} else if (d.type === 'gradient') {
			u[`${n}_stops`] = { value: Array.from({ length: MAX_GRADIENT_STOPS }, () => new THREE.Vector4()) };
			u[`${n}_count`] = { value: 0 };
		} else u[n] = { value: 0 };
	}
	return u;
}

export function updateUniforms(u: Uniforms, defs: ParamDef[], values: ParamValues): void {
	for (const d of defs) {
		if (!hasUniform(d)) continue;
		const n = `u_${d.key}`;
		const v = values[d.key] ?? d.default;
		switch (d.type) {
			case 'float':
			case 'seed':
			case 'int':
				if (u[n]) u[n].value = Number(v);
				break;
			case 'bool':
				if (u[n]) u[n].value = Boolean(v);
				break;
			case 'enum':
				if (u[n]) u[n].value = enumIndex(d, v);
				break;
			case 'color': {
				const c = hexToLinear(String(v));
				if (u[n]) (u[n].value as THREE.Vector3).set(c[0], c[1], c[2]);
				break;
			}
			case 'text': {
				if (!u[n]) break;
				const p = packText(d, String(v));
				// (Shared between materials: never written to.)
				u[n].value = p.data;
				(u[`${n}_size`].value as Int32Array).set(p.size);
				break;
			}
			case 'curve': {
				const c = v as Curve;
				const arr = u[`${n}_pts`]?.value as THREE.Vector4[] | undefined;
				if (!arr) break;
				const pts = c.points.slice(0, MAX_CURVE_POINTS);
				const m = curveTangents(pts);
				pts.forEach((p, i) => arr[i].set(p.x, p.y, m[i], 0));
				u[`${n}_count`].value = pts.length;
				break;
			}
			case 'gradient': {
				const g = v as Gradient;
				const arr = u[`${n}_stops`]?.value as THREE.Vector4[] | undefined;
				if (!arr) break;
				const stops = [...g.stops].sort((a, b) => a.pos - b.pos).slice(0, MAX_GRADIENT_STOPS);
				stops.forEach((s, i) => {
					const c = hexToRgb(s.color);
					arr[i].set(c[0], c[1], c[2], s.pos);
				});
				u[`${n}_count`].value = stops.length;
				break;
			}
		}
	}
}

/** Combine a layer/param seed with the project seed into a float uniform value. */
export function mixSeed(layerSeed: number, projectSeed: number): number {
	let h = (Math.imul(layerSeed | 0, 0x9e3779b1) ^ Math.imul(projectSeed | 0, 0x85ebca6b)) >>> 0;
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d) >>> 0;
	h ^= h >>> 12;
	return (h >>> 0) % 65521;
}
