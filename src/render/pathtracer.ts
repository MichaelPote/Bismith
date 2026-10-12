// Stage 3 (docs/architecture.md §7): a progressive path tracer specialised for a height field z = h(x, y)
// seen by an orthographic top-down camera. World space is GL pixel space (x right, y up) with z up in px.

import * as THREE from 'three'
import type { Project } from '@/core/project'
import { hexToLinear } from '@/core/color'
import { Gpu, PingPong } from '@/gpu/context'
import { GLSL_COMMON } from '@/layers/glsl/common'
import type { MaterialPipeline } from './materialPipeline'

export const MAX_LIGHTS = 8
/** Distance (px) at which a point light of intensity 1 lights a white surface to 1.0. */
export const POINT_LIGHT_REF_DIST = 64

const TRACE_FRAG = /* glsl */ `
uniform sampler2D tAlbedo;
uniform sampler2D tSurface;
uniform sampler2D tEmissive;
uniform sampler2D tNormal;   // xyz normal, w = world height px (linear filtered)
uniform sampler2D tAccum;
uniform float uN;            // samples already accumulated
uniform int uFrame;
uniform float uMaxH;
uniform float uMinH;
uniform int uBounces;
uniform float uF0;
uniform float uSpecTint;
uniform sampler2D tAO;
uniform float uAO;
uniform bool uJitter;
uniform float uClamp;
uniform bool uShadows;
uniform bool uSkyOn;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uAmbient;
uniform int uLightCount;
uniform int uLType[${MAX_LIGHTS}];
uniform vec3 uLColor[${MAX_LIGHTS}];
uniform vec3 uLVec[${MAX_LIGHTS}];
uniform float uLSize[${MAX_LIGHTS}];
uniform float uLRange[${MAX_LIGHTS}];
uniform float uRefDist;

out vec4 oColor;

// ---------------------------------------------------------------- rng
uint rngState;
float rnd() { rngState = pcg(rngState); return u2f(rngState); }
vec2 rnd2() { return vec2(rnd(), rnd()); }

// ---------------------------------------------------------------- surface queries
vec4 normalHeight(vec2 px) {
  return texture(tNormal, px / uRes);
}
float heightAt(vec2 px) { return normalHeight(px).w; }

ivec2 texelOf(vec2 px) { return texelCoord(ivec2(floor(px))); }

// March the height field. Returns t of the first hit, -1 if the ray escapes, -2 if inconclusive.
float traceHeight(vec3 ro, vec3 rd, float tMax) {
  if (rd.z > 0.0) {
    if (ro.z >= uMaxH) return -1.0;
    tMax = min(tMax, (uMaxH - ro.z) / rd.z);
  } else if (rd.z < 0.0) {
    tMax = min(tMax, (uMinH - 0.01 - ro.z) / rd.z);
  }
  float hxy = length(rd.xy);
  float dt = 0.75 / max(hxy, 1e-4);
  float prevT = 0.0;
  float t = 0.0;
  for (int i = 0; i < 512; i++) {
    t = min(t + dt, tMax);
    vec3 p = ro + rd * t;
    float diff = p.z - heightAt(p.xy);
    if (diff < 0.0) {
      float a = prevT, b = t;
      for (int k = 0; k < 6; k++) {
        float m = 0.5 * (a + b);
        vec3 q = ro + rd * m;
        if (q.z - heightAt(q.xy) < 0.0) b = m; else a = m;
      }
      return b;
    }
    if (t >= tMax) return rd.z >= 0.0 ? -1.0 : -2.0;
    prevT = t;
  }
  return -2.0;
}

bool visible(vec3 ro, vec3 rd, float dist) {
  float t = traceHeight(ro, rd, dist);
  if (t == -1.0) return true;
  if (t == -2.0) return rd.z >= 0.0;
  return t >= dist;
}

// ---------------------------------------------------------------- BRDF
vec3 fresnel(vec3 F0, float c) { float f = pow(1.0 - clamp(c, 0.0, 1.0), 5.0); return F0 + (1.0 - F0) * f; }
float ggxD(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float smithVis(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-6);
}
float smithG1(float NoV, float a) { float a2 = a * a; return 2.0 * NoV / (NoV + sqrt(a2 + (1.0 - a2) * NoV * NoV)); }

struct Mat { vec3 albedo; float rough; float metal; vec3 F0; vec3 emissive; float alpha; };

Mat fetchMat(vec2 px) {
  ivec2 c = texelOf(px);
  vec4 A = texelFetch(tAlbedo, c, 0);
  vec4 S = texelFetch(tSurface, c, 0);
  Mat m;
  m.albedo = A.rgb;
  m.alpha = A.a;
  m.rough = clamp(S.g, 0.02, 1.0);
  m.metal = clamp(S.b, 0.0, 1.0);
  vec4 Ev = texelFetch(tEmissive, c, 0);
  // Per-pixel specular level (emissive alpha) × the render scale (uF0 = 0.08 × scale).
  // Tint: the albedo's hue at unit luminance, so a tinted glint is as bright as a white one but richer.
  vec3 hue = min(A.rgb / max(luma(A.rgb), 1e-3), vec3(8.0));
  vec3 f0 = min(vec3(uF0 * Ev.a) * mix(vec3(1.0), hue, uSpecTint), vec3(1.0));
  m.F0 = mix(f0, A.rgb, m.metal);
  m.emissive = Ev.rgb;
  return m;
}

// f(l) * NoL
vec3 evalBRDF(Mat m, vec3 n, vec3 v, vec3 l) {
  float NoL = dot(n, l);
  float NoV = max(dot(n, v), 1e-4);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(v + l);
  float NoH = max(dot(n, h), 0.0);
  float VoH = max(dot(v, h), 0.0);
  float a = m.rough * m.rough;
  vec3 F = fresnel(m.F0, VoH);
  vec3 spec = ggxD(NoH, a) * smithVis(NoV, NoL, a) * F;
  vec3 kd = (1.0 - F) * (1.0 - m.metal);
  return (kd * m.albedo / PI + spec) * NoL;
}

void basis(vec3 n, out vec3 t, out vec3 b) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float c = n.x * n.y * a;
  t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
  b = vec3(c, s + n.y * n.y * a, -n.y);
}

// Heitz 2018 visible-normal sampling, tangent space (z = normal).
vec3 sampleVNDF(vec3 Ve, float a, vec2 u) {
  vec3 Vh = normalize(vec3(a * Ve.x, a * Ve.y, Ve.z));
  float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
  vec3 T1 = lensq > 0.0 ? vec3(-Vh.y, Vh.x, 0.0) * inversesqrt(lensq) : vec3(1.0, 0.0, 0.0);
  vec3 T2 = cross(Vh, T1);
  float r = sqrt(u.x);
  float phi = TAU * u.y;
  float t1 = r * cos(phi);
  float t2 = r * sin(phi);
  float s = 0.5 * (1.0 + Vh.z);
  t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;
  vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * Vh;
  return normalize(vec3(a * Nh.x, a * Nh.y, max(0.0, Nh.z)));
}

float specPick(Mat m, float NoV) {
  float ws = luma(fresnel(m.F0, NoV));
  float wd = luma(m.albedo) * (1.0 - m.metal) * (1.0 - ws);
  return clamp(ws / max(ws + wd, 1e-4), 0.1, 0.9);
}

// Sample a direction; returns false if invalid. weight = f * NoL / pdf.
bool sampleBRDF(Mat m, vec3 n, vec3 v, out vec3 l, out vec3 weight) {
  vec3 t, b;
  basis(n, t, b);
  vec3 vt = vec3(dot(v, t), dot(v, b), dot(v, n));
  float NoV = max(vt.z, 1e-4);
  float a = m.rough * m.rough;
  float ps = specPick(m, NoV);
  vec3 lt;
  if (rnd() < ps) {
    vec3 ht = sampleVNDF(vt, a, rnd2());
    lt = reflect(-vt, ht);
  } else {
    vec2 u = rnd2();
    float r = sqrt(u.x), phi = TAU * u.y;
    lt = vec3(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
  }
  if (lt.z <= 0.0) return false;
  l = t * lt.x + b * lt.y + n * lt.z;
  vec3 ht = normalize(vt + lt);
  float pdfSpec = smithG1(NoV, a) * ggxD(max(ht.z, 0.0), a) / (4.0 * NoV);
  float pdfDiff = lt.z / PI;
  float pdf = ps * pdfSpec + (1.0 - ps) * pdfDiff;
  if (pdf <= 1e-6) return false;
  weight = evalBRDF(m, n, v, l) / pdf;
  return true;
}

vec3 sky(vec3 d) {
  if (!uSkyOn) return vec3(0.0);
  return mix(uSkyHorizon, uSkyZenith, sqrt(clamp(d.z, 0.0, 1.0)));
}

// Uniform direction in a cone around axis (cosMax = cos of half angle).
vec3 sampleCone(vec3 axis, float cosMax, vec2 u) {
  float c = mix(1.0, cosMax, u.x);
  float s = sqrt(max(0.0, 1.0 - c * c));
  float phi = TAU * u.y;
  vec3 t, b;
  basis(axis, t, b);
  return normalize(t * (cos(phi) * s) + b * (sin(phi) * s) + axis * c);
}

vec3 directLight(Mat m, vec3 p, vec3 n, vec3 v) {
  vec3 sum = vec3(0.0);
  vec3 ro = p + n * 0.05 + vec3(0.0, 0.0, 0.02);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    if (uLType[i] == 0) {
      vec3 l = uLSize[i] > 0.0 ? sampleCone(uLVec[i], cos(uLSize[i]), rnd2()) : uLVec[i];
      if (dot(n, l) <= 0.0 || l.z <= 0.0) continue;
      if (uShadows && !visible(ro, l, 1e6)) continue;
      sum += evalBRDF(m, n, v, l) * uLColor[i] * PI;
    } else {
      vec3 lp = uLVec[i];
      vec3 toL = lp - p;
      if (uTile) toL.xy = wrapDelta(toL.xy);
      float d0 = length(toL);
      vec3 axis = toL / max(d0, 1e-4);
      if (uLSize[i] > 0.0) {
        vec3 t, b;
        basis(axis, t, b);
        vec2 u = rnd2();
        float r = uLSize[i] * sqrt(u.x), phi = TAU * u.y;
        toL += t * (r * cos(phi)) + b * (r * sin(phi));
      }
      float dist = length(toL);
      vec3 l = toL / max(dist, 1e-4);
      if (dot(n, l) <= 0.0) continue;
      float win = 1.0;
      if (uLRange[i] > 0.0) { float x = dist / uLRange[i]; win = clamp(1.0 - x * x * x * x, 0.0, 1.0); win *= win; }
      if (win <= 0.0) continue;
      if (uShadows && !visible(ro, l, dist)) continue;
      float falloff = (uRefDist * uRefDist) / max(dist * dist, 1.0);
      sum += evalBRDF(m, n, v, l) * uLColor[i] * PI * falloff * win;
    }
  }
  return sum;
}

vec3 clampLum(vec3 c) {
  if (uClamp <= 0.0) return c;
  float l = luma(c);
  return l > uClamp ? c * (uClamp / l) : c;
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  rngState = pcg3(uvec3(uint(ip.x), uint(ip.y), uint(uFrame) * 9781u + 1u));

  vec2 px = gl_FragCoord.xy;
  if (uJitter) px += rnd2() - 0.5;

  Mat m = fetchMat(gl_FragCoord.xy);
  vec3 n = normalize(texelFetch(tNormal, ip, 0).xyz);
  vec3 p = vec3(px, heightAt(px));
  vec3 v = vec3(0.0, 0.0, 1.0);

  // Surface lighting (L) is scaled by ambient occlusion at the end; the primary hit's own emission (E0) is not.
  vec3 E0 = m.emissive;
  vec3 L = m.albedo * uAmbient * (1.0 - m.metal);
  vec3 thr = vec3(1.0);

  for (int bounce = 0; bounce <= 4; bounce++) {
    vec3 direct = thr * directLight(m, p, n, v);
    L += bounce == 0 ? direct : clampLum(direct);

    vec3 l, w;
    if (!sampleBRDF(m, n, v, l, w)) break;
    vec3 ro = p + n * 0.05 + vec3(0.0, 0.0, 0.02);
    float t = traceHeight(ro, l, 1e6);
    if (t == -1.0 || (t == -2.0 && l.z >= 0.0)) {
      L += clampLum(thr * w * sky(l));
      break;
    }
    if (t < 0.0 || bounce >= uBounces) break;
    thr *= w;
    // Russian roulette after the first bounce.
    if (bounce >= 1) {
      float q = clamp(max(thr.r, max(thr.g, thr.b)), 0.05, 1.0);
      if (rnd() > q) break;
      thr /= q;
    }
    p = ro + l * t;
    m = fetchMat(p.xy);
    n = normalize(normalHeight(p.xy).xyz);
    v = -l;
    L += clampLum(thr * m.emissive);
  }

  if (uAO > 0.0) L *= pow(max(texelFetch(tAO, ip, 0).r, 1e-3), uAO);
  L += E0;

  vec4 prev = texelFetch(tAccum, ip, 0);
  vec4 cur = vec4(L, m.alpha);
  cur.a = texelFetch(tAlbedo, ip, 0).a;
  oColor = uN <= 0.0 ? cur : mix(prev, cur, 1.0 / (uN + 1.0));
}
`

export class PathTracer {
  private gpu: Gpu
  private accum: PingPong | null = null
  private ao: THREE.WebGLRenderTarget | null = null
  private aoMat: THREE.RawShaderMaterial
  private mat: THREE.RawShaderMaterial
  samples = 0
  private width = 0
  private height = 0

  constructor(gpu: Gpu) {
    this.gpu = gpu
    this.mat = gpu.material(GLSL_COMMON + TRACE_FRAG, {
      uRes: { value: new THREE.Vector2() },
      uTile: { value: true },
      tAlbedo: { value: null },
      tSurface: { value: null },
      tEmissive: { value: null },
      tNormal: { value: null },
      tAccum: { value: null },
      uN: { value: 0 },
      uFrame: { value: 0 },
      uMaxH: { value: 0 },
      uMinH: { value: 0 },
      uBounces: { value: 2 },
      uF0: { value: 0.04 },
      uSpecTint: { value: 0 },
      tAO: { value: null },
      uAO: { value: 0 },
      uJitter: { value: true },
      uClamp: { value: 8 },
      uShadows: { value: true },
      uSkyOn: { value: true },
      uSkyZenith: { value: new THREE.Vector3() },
      uSkyHorizon: { value: new THREE.Vector3() },
      uAmbient: { value: new THREE.Vector3() },
      uLightCount: { value: 0 },
      uLType: { value: new Array(MAX_LIGHTS).fill(0) },
      uLColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
      uLVec: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
      uLSize: { value: new Array(MAX_LIGHTS).fill(0) },
      uLRange: { value: new Array(MAX_LIGHTS).fill(0) },
      uRefDist: { value: POINT_LIGHT_REF_DIST },
    })
    this.aoMat = gpu.material(
      GLSL_COMMON +
        /* glsl */ `
      uniform sampler2D tNormal;
      uniform float uRadius;
      out vec4 oColor;
      void main() {
        vec2 c = gl_FragCoord.xy;
        float h0 = fetchT(tNormal, ivec2(c)).w;
        const int D = 16;
        const int S = 8;
        float occ = 0.0;
        for (int d = 0; d < D; d++) {
          float a = (float(d) + 0.5) / float(D) * TAU;
          vec2 dir = vec2(cos(a), sin(a));
          float horizon = 0.0;
          for (int s = 1; s <= S; s++) {
            float dist = uRadius * float(s) / float(S);
            float dh = sampleT(tNormal, c + dir * dist).w - h0;
            // Sine of the elevation of this sample, fading with distance so far occluders count less.
            float f = 1.0 - float(s - 1) / float(S);
            horizon = max(horizon, f * dh / sqrt(dist * dist + dh * dh));
          }
          occ += horizon;
        }
        float ao = clamp(1.0 - occ / float(D), 0.0, 1.0);
        oColor = vec4(ao, ao, ao, 1.0);
      }`,
      { uRes: { value: new THREE.Vector2() }, uTile: { value: true }, tNormal: { value: null }, uRadius: { value: 4 } },
    )
  }

  /** Ambient-occlusion map (R), recomputed on every configure. */
  get aoTexture(): THREE.Texture | null {
    return this.ao?.texture ?? null
  }

  /** Horizon-based AO from the world height (normal texture w): 16 directions × 8 steps within the radius. */
  private computeAO(project: Project, normal: THREE.Texture, radius: number): void {
    if (!this.ao || this.ao.width !== project.width || this.ao.height !== project.height) {
      this.ao?.dispose()
      this.ao = this.gpu.target(project.width, project.height)
    }
    const u = this.aoMat.uniforms
    ;(u.uRes.value as THREE.Vector2).set(project.width, project.height)
    u.uTile.value = project.tileable
    u.tNormal.value = normal
    u.uRadius.value = radius
    this.gpu.run(this.aoMat, this.ao)
  }

  get output(): THREE.Texture | null {
    return this.accum?.read.texture ?? null
  }

  reset(): void {
    this.samples = 0
  }

  private ensure(w: number, h: number): void {
    if (this.accum && this.width === w && this.height === h) return
    this.accum?.dispose()
    this.accum = new PingPong(this.gpu, w, h)
    this.width = w
    this.height = h
    this.samples = 0
  }

  /** Upload scene uniforms. Call after the material changed or lighting/render settings changed. */
  configure(project: Project, material: MaterialPipeline, override?: { bounces?: number }): void {
    this.ensure(project.width, project.height)
    const u = this.mat.uniforms
    ;(u.uRes.value as THREE.Vector2).set(project.width, project.height)
    u.uTile.value = project.tileable
    u.tAlbedo.value = material.albedo
    u.tSurface.value = material.surface
    u.tEmissive.value = material.emissive
    const nt = material.normalTex!
    const wrap = project.tileable ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
    if (nt.wrapS !== wrap || nt.minFilter !== THREE.LinearFilter) {
      nt.wrapS = nt.wrapT = wrap
      nt.minFilter = nt.magFilter = THREE.LinearFilter
      nt.needsUpdate = true
    }
    u.tNormal.value = nt
    u.uMaxH.value = material.heightStats.max + 0.01
    u.uMinH.value = material.heightStats.min
    const r = project.render
    u.uBounces.value = override?.bounces ?? r.bounces
    u.uF0.value = 0.08 * r.specular
    u.uSpecTint.value = r.specularTint ?? 0
    u.uAO.value = r.ao ?? 0
    // Always computed (cheap) so the AO channel can be viewed and exported even at strength 0.
    this.computeAO(project, nt, r.aoRadius ?? 4)
    u.tAO.value = this.ao!.texture
    u.uJitter.value = r.jitter
    u.uClamp.value = r.clamp
    u.uShadows.value = r.shadows !== false

    const lt = project.lighting
    u.uSkyOn.value = lt.sky.enabled
    const z = hexToLinear(lt.sky.zenith).map((c) => c * lt.sky.intensity)
    const hz = hexToLinear(lt.sky.horizon).map((c) => c * lt.sky.intensity)
    ;(u.uSkyZenith.value as THREE.Vector3).set(z[0], z[1], z[2])
    ;(u.uSkyHorizon.value as THREE.Vector3).set(hz[0], hz[1], hz[2])
    const amb = hexToLinear(lt.ambient.color).map((c) => c * lt.ambient.intensity)
    ;(u.uAmbient.value as THREE.Vector3).set(amb[0], amb[1], amb[2])

    const lights = lt.lights.filter((l) => l.enabled).slice(0, MAX_LIGHTS)
    u.uLightCount.value = lights.length
    const types = u.uLType.value as number[]
    const colors = u.uLColor.value as THREE.Vector3[]
    const vecs = u.uLVec.value as THREE.Vector3[]
    const sizes = u.uLSize.value as number[]
    const ranges = u.uLRange.value as number[]
    lights.forEach((l, i) => {
      const p = l.params
      const c = hexToLinear(String(p.color)).map((v) => v * Number(p.intensity))
      colors[i].set(c[0], c[1], c[2])
      if (l.type === 'directional') {
        types[i] = 0
        const az = (Number(p.azimuth) * Math.PI) / 180
        const el = (Number(p.elevation) * Math.PI) / 180
        // Azimuth is clockwise from the top of the image; GL y is up.
        vecs[i].set(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)).normalize()
        sizes[i] = (Number(p.angle) * Math.PI) / 180
        ranges[i] = 0
      } else {
        types[i] = 1
        vecs[i].set(Number(p.x) * project.width, (1 - Number(p.y)) * project.height, Number(p.z))
        sizes[i] = Number(p.radius)
        ranges[i] = Number(p.range)
      }
    })
  }

  /** Render `count` more samples into the accumulation buffer. */
  trace(count: number, maxSamples: number): number {
    if (!this.accum) return 0
    let done = 0
    const u = this.mat.uniforms
    while (done < count && this.samples < maxSamples) {
      u.tAccum.value = this.accum.read.texture
      u.uN.value = this.samples
      u.uFrame.value = this.samples
      this.gpu.run(this.mat, this.accum.write)
      this.accum.swap()
      this.samples++
      done++
    }
    return done
  }

  dispose(): void {
    this.accum?.dispose()
    this.ao?.dispose()
    this.mat.dispose()
    this.aoMat.dispose()
  }
}
