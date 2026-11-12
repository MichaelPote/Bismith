// 2D signed-distance primitives (px in, px out; negative inside). Mostly after Inigo Quilez's catalogue.

export const GLSL_SDF = /* glsl */ `
// Rounded box: b = half size, r = corner radii (x: top-right, y: bottom-right, z: top-left, w: bottom-left
// in GL orientation, i.e. y up).
float sdRoundBox(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x = (p.y > 0.0) ? r.x : r.y;
  r.x = min(r.x, min(b.x, b.y));
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Box (half size b) with its corners cut at 45° by c px along each side.
float sdChamferBox(vec2 p, vec2 b, float c) {
  vec2 a = abs(p);
  return max(sdBox(p, b), (a.x + a.y - (b.x + b.y - c)) * 0.70710678);
}

// Hexagon of inradius r, flat top and bottom (swap p's components for one standing on a point).
float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// Ellipse (approximate but robust, exact for circles).
float sdEllipse(vec2 p, vec2 ab) {
  ab = max(ab, vec2(1e-3));
  if (abs(ab.x - ab.y) < 1e-3) return length(p) - ab.x;
  float k0 = length(p / ab);
  float k1 = length(p / (ab * ab));
  return k0 < 1e-6 ? -min(ab.x, ab.y) : k0 * (k0 - 1.0) / k1;
}

// The nearest point to pa (first quadrant) on the ellipse with semi-axes ab, by a few Newton-like steps (0xfaded's
// trig-free method).
vec2 ellipseNearest(vec2 pa, vec2 ab) {
  vec2 t = vec2(0.70710678);
  vec2 e2 = vec2(ab.x * ab.x - ab.y * ab.y, ab.y * ab.y - ab.x * ab.x) / ab;
  for (int i = 0; i < 4 * UNI_1; i++) {
    vec2 e = e2 * t * t * t;
    vec2 qv = pa - e;
    t = clamp((qv * (length(ab * t - e) / max(length(qv), 1e-9)) + e) / ab, 0.0, 1.0);
    t /= max(length(t), 1e-9);
  }
  return ab * t;
}

// Ellipse, exact at any aspect.
float sdEllipseExact(vec2 p, vec2 ab) {
  ab = max(ab, vec2(1e-3));
  if (abs(ab.x - ab.y) < 1e-4 * max(ab.x, ab.y)) return length(p) - ab.x;
  vec2 pa = abs(p);
  float d = length(pa - ellipseNearest(pa, ab));
  return dot(pa / ab, pa / ab) > 1.0 ? d : -d;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

float dot2(vec2 v) { return dot(v, v); }

// Quadratic Bézier A → B → C: the distance to it and the curve parameter (0..1) of the closest point.
vec2 sdBezierT(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A;
  vec2 b = A - 2.0 * B + C;
  vec2 c = a * 2.0;
  vec2 d = A - pos;
  // Within 0.05 px of straight (|b| / 4 is how far the middle bows out): the segment, where the cubic is ill-conditioned.
  if (dot(b, b) < 0.04) {
    vec2 ca = C - A;
    float t = clamp(dot(pos - A, ca) / max(dot(ca, ca), 1e-8), 0.0, 1.0);
    return vec2(length(pos - A - ca * t), t);
  }
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    return vec2(length(d + (c + b * t) * t), t);
  }
  float z = sqrt(-p);
  float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v);
  float n = sin(v) * 1.732050808;
  vec2 t = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
  float d1 = dot2(d + (c + b * t.x) * t.x);
  float d2 = dot2(d + (c + b * t.y) * t.y);
  return d1 < d2 ? vec2(sqrt(d1), t.x) : vec2(sqrt(d2), t.y);
}

// Vesica (pointed lens, two circular arcs) along y: tips at (0, ±a), half-width b. A lens is never wider than it is
// long: wider (b > a), it is the lens turned a quarter, its tips at (±b, 0) — so it always fills its 2a × 2b box, both
// sizes stay live and it passes through the circle at b = a.
float sdVesica(vec2 p, float a, float b) {
  if (b > a) { p = p.yx; float t = a; a = b; b = t; }
  b = max(b, 1e-3);
  a = max(a, b);
  float r = 0.5 * (a * a / b + b);
  float d = r - b;
  p = abs(p);
  return ((p.y - a) * d > p.x * a) ? length(p - vec2(0.0, a)) : length(p + vec2(d, 0.0)) - r;
}

// Star with n points, outer radius r, inner ratio m (0..1).
float sdStar(vec2 p, float r, int n, float m) {
  float an = PI / float(n);
  float en = PI / mix(2.0, float(n), clamp(1.0 - m, 0.0, 1.0));
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

// Onion: turn a solid into an outline of thickness t (t <= 0 leaves it solid).
float sdOnion(float d, float t) { return t > 0.0 ? abs(d + t * 0.5) - t * 0.5 : d; }
`;
