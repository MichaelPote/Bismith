# FR2.6 — Normal derivation

**Status:** done (v1)

## Goal

Normals are always derived from Height (never edited), consistently for the viewport, path tracer and export.

## Plan

- Pass after the layer stack: Sobel (or central differences, selectable) on `surface.r × heightDepth`,
  wrapping on tileable projects; output RGBA half float (xyz normal).
- Normal channel view in the viewport (remapped `n × 0.5 + 0.5`).
- Export as OpenGL (Y+) or DirectX (Y−) tangent-space normal map.

## Checklist

- [x] Normal pass (Sobel, wrap-aware) — normal target also carries world height in .w for the path tracer
- [x] Viewport normal view
- [x] Export OpenGL / DirectX convention — both in File ▸ Export one map; GL in the zip bundle
