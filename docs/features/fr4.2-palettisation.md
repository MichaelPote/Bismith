# FR4.2 — 8-bit palettisation & dithering

**Status:** done (v1) — filter, palettes, helpers, and the "Extract from render" button + palette swatches in
the filter's properties (`src/ui/panels/PostExtras.vue`).

## Goal

"8-bit palettisation for that retro look" — snap the image to a fixed palette, with optional dithering.

## Plan

- `src/render/post/palettes.ts` — built-in palettes: Quake (256), Doom (256), PICO-8 (16), EGA (16),
  CGA (4), Game Boy (4), C64 (16), RGB332 (generated 256), greyscale ramps.
- Custom palettes as a list of hex colours (paste / edit), and **Auto**: k-means (OKLab) over the current
  render to N colours (CPU, on demand).
- Shader: palette uploaded as a 256×1 texture + count; nearest colour in OKLab (perceptual) or RGB.
- Dithering: none, ordered Bayer 2×2 / 4×4 / 8×8, strength; applied in sRGB space before lookup.
- Unit tests for palette parsing, k-means, nearest-colour CPU reference.

## Checklist

- [x] Palette data (Quake, Doom, PICO-8, EGA, CGA, Game Boy, C64, RGB332)
- [x] Palette post filter (OKLab / RGB nearest)
- [x] Bayer dithering 2/4/8 + strength
- [x] Custom hex-list palettes
- [x] Auto palette via k-means — `extractPalette()`, wired to _Extract_ (N colours) in the Palette filter's properties
- [x] Unit tests

## Implementation notes

Files: `src/render/post/palettes.ts` (data + pure-TS helpers), `src/render/post/palettize.ts` (the `palette`
filter), `src/render/post/palettes.test.ts` (vitest).

**Palettes** (`BUILTIN_PALETTES`, ids in brackets): Quake [`quake`], Quake without the 32 fullbrights
[`quake_nofb`, indices 0–223 — use it for textures that must not glow in-engine], Doom PLAYPAL #0 [`doom`], PICO-8
[`pico8`], EGA [`ega`], CGA mode 4 palette 1 high [`cga`], Game Boy DMG greens [`gameboy`], C64 Pepto [`c64`],
RGB332 [`rgb332`], greyscale 4/8/16 [`grey4/8/16`], plus `custom`.

- Quake: byte-for-byte from DarkPlaces `palette.c` (`host_quakepal`), cross-checked identical with SLADE's
  `Quake .pal`.
- Doom: SLADE's `Doom .pal` (first 768 bytes of PLAYPAL), cross-checked identical with omgifol's default palette.

**Filter params:** palette, custom colours (text, shown for `custom`), match in (OKLab / RGB), dither (none,
Bayer 2×2/4×4/8×8), dither strength, alpha (keep / cut out at 50%, dithered / opaque).

**Pipeline (per pixel):** linear (clamped 0..1) → sRGB-encoded → `+ bayer(x, y) × spread × strength` (same offset
on all channels; image-space coordinates, y down, so patterns line up with the top-left) → nearest entry
(squared distance in OKLab or sRGB RGB, ties → lowest index) → the entry's **exact linear value** from the lookup
texture. `spread` is computed per palette on the CPU: the mean per-channel (Chebyshev) step from each colour to its
nearest neighbour — exactly the step for even grey ramps, so strength 1 dithers between adjacent levels.

**GPU data:** a 256×3 RGBA float `DataTexture` (row 0 linear output colours, row 1 sRGB, row 2 OKLab, all computed
in double precision on the CPU) + count + spread uniforms. Textures are cached by palette content (LRU of 8).

**Exactness:** the filter writes `float32(srgbToLinear(byte/255))`; the export's
`round(linearToSrgb(v) × 255)` recovers the byte for all 256 values (unit-tested), so with Palette last in the
stack every exported pixel is a palette colour. Verified headlessly for every built-in palette + custom × both
metrics × all dither modes on a 128×64 render: 0 non-member pixels in the float read-back and in the exported
PNGs, and 0 mismatches against the CPU reference (`palettizePixel`) run on the pre-palette image.

**Helpers** (`palettes.ts`):

- `parsePaletteText(text)` — hex lists (`#rrggbb`, `rrggbb`, `#rgb`, `#rrggbbaa`, Paint.NET `aarrggbb`, `0x…`),
  decimal triplets / `rgb()`, GIMP `.gpl`, JASC-PAL; `;`-lines, `# ` lines and `//` comments ignored; order and
  duplicates kept.
- `paletteColors(id, customText)`, `preparePalette(colors)`, `nearestColorIndex(srgb, palette, metric)`,
  `bayerThreshold(x, y, n)`, `palettizePixel(linear, x, y, palette, opts)` — the CPU reference.
- `extractPalette(img: { width, height, data /* linear RGBA, rows top-down */ }, n)` — weighted histogram of the
  opaque pixels' 8-bit sRGB colours (coarsened above 16k distinct colours) → k-means++ seeding (seeded PRNG,
  deterministic) → Lloyd iterations in OKLab (empty clusters re-seeded at the worst-served colour); returns hex
  sorted dark → light, fewer than `n` if the image has fewer distinct colours. n = 256 on random noise takes
  ≈0.16 s at 512² and ≈0.5 s at 1024² (Node).

**For the UI button:** extract from the image _before_ the Palette filter (otherwise you get the current palette
back), e.g. render with `post` truncated before the filter (only post re-runs), `extractPalette(engine.readFinal(), n)`,
restore, then set the filter's `palette: 'custom'`, `custom: colours.join(' ')`.
