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

float sdCircle(vec2 p, float r) { return length(p) - r; }

// Ellipse (approximate but robust, exact for circles).
float sdEllipse(vec2 p, vec2 ab) {
  ab = max(ab, vec2(1e-3));
  if (abs(ab.x - ab.y) < 1e-3) return length(p) - ab.x;
  float k0 = length(p / ab);
  float k1 = length(p / (ab * ab));
  return k0 < 1e-6 ? -min(ab.x, ab.y) : k0 * (k0 - 1.0) / k1;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

// Segment with flat (butt) caps.
float sdSegmentFlat(vec2 p, vec2 a, vec2 b, float th) {
  float l = length(b - a);
  vec2 d = (b - a) / max(l, 1e-6);
  vec2 q = p - (a + b) * 0.5;
  q = mat2(d.x, -d.y, d.y, d.x) * q;
  q = abs(q) - vec2(l * 0.5, th);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float dot2(vec2 v) { return dot(v, v); }

// Quadratic Bézier, unsigned distance.
float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A;
  vec2 b = A - 2.0 * B + C;
  if (dot(b, b) < 1e-6) return sdSegment(pos, A, C);
  vec2 c = a * 2.0;
  vec2 d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float res = 0.0;
  float p = ky - kx * kx;
  float p3 = p * p * p;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p3;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    res = dot2(d + (c + b * t) * t);
  } else {
    float z = sqrt(-p);
    float v = acos(q / (p * z * 2.0)) / 3.0;
    float m = cos(v);
    float n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    res = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
  }
  return sqrt(res);
}

// Regular polygon with n sides, circumradius r (vertex pointing up).
float sdNgon(vec2 p, float r, int n) {
  float an = PI / float(n);
  vec2 acs = vec2(cos(an), sin(an));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p.y += clamp(-p.y, 0.0, r * acs.y);
  return length(p) * sign(p.x);
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

float sdCross(vec2 p, vec2 b, float r) {
  p = abs(p);
  p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2 w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.0)) + r;
}

// Onion: turn a solid into an outline of thickness t (t <= 0 leaves it solid).
float sdOnion(float d, float t) { return t > 0.0 ? abs(d + t * 0.5) - t * 0.5 : d; }
`
