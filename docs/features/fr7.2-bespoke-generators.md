# FR7.2 — Bespoke generators

**Status:** done — four generator families (FR7.2a–d) plus hand-authored inputs (FR7.5)

## Goal
Motifs the generic layers can't express, found by surveying two reference texture libraries.

| Sub-feature | File | Layers |
| --- | --- | --- |
| [FR7.2a Organic](fr7.2a-organic-generators.md) | `generators/organic.ts` | marble, caustics (lava/slime/water), wood, scales |
| [FR7.2b Geometric](fr7.2b-geometric-generators.md) | `generators/geometric.ts` | tessellation (rhombille, herringbone, basketweave, crosses, octagons…), treadplate, weave, bands |
| [FR7.2c Motif](fr7.2c-motif-generators.md) | `generators/motif.ts`, `filters/symmetry.ts` | truchet / maze / circuit, symmetry (kaleidoscope filter), rosette, glyph |
| [FR7.2d Greebles](fr7.2d-greeble-generators.md) | `generators/greeble.ts` | panels (recursive subdivision), vents, pipes, trim |

Shared additions made for them: `NO_SDF` visible to generators, `int imod(int,int)`, and common **Offset X/Y**
params on every generator (pattern phase alignment for matching).

## Checklist
- [x] Survey of both libraries; motif list
- [x] Placeholder modules wired into the registries
- [x] Organic generators ([FR7.2a](fr7.2a-organic-generators.md))
- [x] Geometric generators ([FR7.2b](fr7.2b-geometric-generators.md))
- [x] Motif generators + symmetry filter ([FR7.2c](fr7.2c-motif-generators.md))
- [x] Greeble generators ([FR7.2d](fr7.2d-greeble-generators.md))
- [x] Hand-authored inputs: Stamp, Label, Path, Cable ([FR7.5](fr7.5-stamps.md))
- [x] Common pattern offset params
