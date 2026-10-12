// ParamDef → GLSL uniform declarations and values. Every param `key` becomes `u_<key>`:
//   float/seed → float · int → int · bool → bool · enum → int (option index)
//   color → vec3 (LINEAR rgb) · gradient → vec4 u_<key>_stops[8] (sRGB rgb, position) + int u_<key>_count
//   text with `bitmap` → ivec4 u_<key>[64] (packed cells) or vec4 u_<key>[64] (polygon vertices) + ivec2 u_<key>_size;
//   other text params are not uploaded

import * as THREE from 'three'
import { hexToLinear, hexToRgb } from '@/core/color'
import { BITMAP_MAX, MAX_PATH_POINTS, packBitmap, packPolygons, parseBitmap, parsePolygons, textBitmap } from '@/core/bitmap'
import { MAX_CURVE_POINTS, MAX_GRADIENT_STOPS, curveTangents, enumIndex, type Curve, type Gradient, type ParamDef, type ParamValues } from '@/core/params'
import type { Uniforms } from './context'

export function declareUniforms(defs: ParamDef[]): string {
  const lines: string[] = []
  for (const d of defs) {
    if (d.uniform === false || (d.type === 'text' && !d.bitmap)) continue
    const n = `u_${d.key}`
    switch (d.type) {
      case 'float':
      case 'seed':
        lines.push(`uniform float ${n};`)
        break
      case 'int':
      case 'enum':
        lines.push(`uniform int ${n};`)
        break
      case 'bool':
        lines.push(`uniform bool ${n};`)
        break
      case 'color':
        lines.push(`uniform vec3 ${n};`)
        break
      case 'gradient':
        lines.push(`uniform vec4 ${n}_stops[${MAX_GRADIENT_STOPS}];`, `uniform int ${n}_count;`)
        break
      case 'curve':
        // Points (x, y, slope, 0) for a shape-preserving cubic Hermite; curve_<key>(x) evaluates it.
        lines.push(
          `uniform vec4 ${n}_pts[${MAX_CURVE_POINTS}];`,
          `uniform int ${n}_count;`,
          `float curve_${d.key}(float x) {
  int c = ${n}_count;
  x = clamp(x, 0.0, 1.0);
  if (x <= ${n}_pts[0].x) return ${n}_pts[0].y;
  for (int i = 0; i < ${MAX_CURVE_POINTS - 1}; i++) {
    if (i + 1 >= c) break;
    vec4 a = ${n}_pts[i], b = ${n}_pts[i + 1];
    if (x <= b.x) {
      float h = max(b.x - a.x, 1e-6), t = (x - a.x) / h, t2 = t * t, t3 = t2 * t;
      return (2.0 * t3 - 3.0 * t2 + 1.0) * a.y + (t3 - 2.0 * t2 + t) * h * a.z + (-2.0 * t3 + 3.0 * t2) * b.y + (t3 - t2) * h * b.z;
    }
  }
  return ${n}_pts[max(c - 1, 0)].y;
}`,
        )
        break
      case 'text':
        if (d.bitmap === 'points') lines.push(`uniform vec4 ${n}[${MAX_PATH_POINTS}];`, `uniform ivec2 ${n}_size;`)
        else lines.push(`uniform ivec4 ${n}[${BITMAP_MAX}];`, `uniform ivec2 ${n}_size;`)
        break
    }
  }
  return lines.join('\n') + '\n'
}

export function createUniforms(defs: ParamDef[]): Uniforms {
  const u: Uniforms = {}
  for (const d of defs) {
    if (d.uniform === false || (d.type === 'text' && !d.bitmap)) continue
    const n = `u_${d.key}`
    if (d.type === 'color') u[n] = { value: new THREE.Vector3() }
    else if (d.type === 'curve') {
      u[`${n}_pts`] = { value: Array.from({ length: MAX_CURVE_POINTS }, () => new THREE.Vector4()) }
      u[`${n}_count`] = { value: 0 }
    }
    else if (d.type === 'text') {
      u[n] = { value: d.bitmap === 'points' ? new Float32Array(MAX_PATH_POINTS * 4) : new Int32Array(BITMAP_MAX * 4) }
      u[`${n}_size`] = { value: new Int32Array(2) }
    }
    else if (d.type === 'gradient') {
      u[`${n}_stops`] = { value: Array.from({ length: MAX_GRADIENT_STOPS }, () => new THREE.Vector4()) }
      u[`${n}_count`] = { value: 0 }
    } else u[n] = { value: 0 }
  }
  return u
}

export function updateUniforms(u: Uniforms, defs: ParamDef[], values: ParamValues): void {
  for (const d of defs) {
    if (d.uniform === false || (d.type === 'text' && !d.bitmap)) continue
    const n = `u_${d.key}`
    const v = values[d.key] ?? d.default
    switch (d.type) {
      case 'float':
      case 'seed':
      case 'int':
        if (u[n]) u[n].value = Number(v)
        break
      case 'bool':
        if (u[n]) u[n].value = Boolean(v)
        break
      case 'enum':
        if (u[n]) u[n].value = enumIndex(d, v)
        break
      case 'color': {
        const c = hexToLinear(String(v))
        if (u[n]) (u[n].value as THREE.Vector3).set(c[0], c[1], c[2])
        break
      }
      case 'text': {
        if (!u[n]) break
        if (d.bitmap === 'points') {
          const pk = packPolygons(parsePolygons(String(v)))
          u[n].value = pk.data
          u[`${n}_size`].value = new Int32Array([pk.count, pk.polygons])
          break
        }
        const b = d.bitmap === 'font' ? textBitmap(String(v)) : parseBitmap(String(v))
        u[n].value = packBitmap(b)
        u[`${n}_size`].value = new Int32Array([b.width, b.height])
        break
      }
      case 'curve': {
        const c = v as Curve
        const arr = u[`${n}_pts`]?.value as THREE.Vector4[] | undefined
        if (!arr) break
        const pts = c.points.slice(0, MAX_CURVE_POINTS)
        const m = curveTangents(pts)
        pts.forEach((p, i) => arr[i].set(p.x, p.y, m[i], 0))
        u[`${n}_count`].value = pts.length
        break
      }
      case 'gradient': {
        const g = v as Gradient
        const arr = u[`${n}_stops`]?.value as THREE.Vector4[] | undefined
        if (!arr) break
        const stops = [...g.stops].sort((a, b) => a.pos - b.pos).slice(0, MAX_GRADIENT_STOPS)
        stops.forEach((s, i) => {
          const c = hexToRgb(s.color)
          arr[i].set(c[0], c[1], c[2], s.pos)
        })
        u[`${n}_count`].value = stops.length
        break
      }
    }
  }
}

/** Combine a layer/param seed with the project seed into a float uniform value. */
export function mixSeed(layerSeed: number, projectSeed: number): number {
  let h = (Math.imul(layerSeed | 0, 0x9e3779b1) ^ Math.imul(projectSeed | 0, 0x85ebca6b)) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  return (h >>> 0) % 65521
}
