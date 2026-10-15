# FR8.16 — New project wizard and one add grid

**Status:** done — File ▸ New project… (Ctrl+Alt+N) opens the wizard; smart materials joined the add-layer grid

## Goal
Start a project from something good-looking: the template families the Match workspace suggests for a reference,
without needing a reference, each in a colour scheme that suits its material; plus blank and the example projects.
And one place to add anything to the layer list.

## Design
- **Add grid** (outliner +): Noise · Shapes · Patterns · **Smart materials** · Filters · Adjust as tile rows — the
  composites sit right after the generators they are made of. The separate ◆ button is gone.
- **Wizard** (`ui/panels/NewProjectWizard.vue`, `editor.wizard`): Starters — Blank (no layers, base material only)
  and the presets as they are (the File ▸ New from preset menu is gone) — then Suggestions: every reference template
  (`match/templates.ts`) built at the chosen size (32–256) from a random scheme. Every card can be picked at once.
  Thumbnails render on demand for the cards scrolled into view (an IntersectionObserver), one at a time with a frame
  between, cheaply (no supersampling, 8 samples). Shaders dominate the cost — measured on D3D11 (Windows Chrome,
  RTX 5080): a card renders in ~48 ms, but its first render waits for its generators' shaders (0.5–7 s each; Truchet
  17 s), ~66 s for all 45 cards one after another. So on opening, where the browser compiles off the main thread
  (KHR_parallel_shader_compile), every card's shaders compile in one batch — in parallel, ~7 s cold for all 26, near
  instant once the driver has cached them — and cards render as soon as theirs are ready (already-compiled ones at
  once). Without parallel compile a batch would freeze the page, so each card compiles its own as it comes into view; they are cached across openings (examples by preset, suggestions by template + size + colours, the colour
  seed kept until Shuffle). The main viewport is suspended only while a batch renders and always resumed after —
  picking a card mid-batch used to leave it frozen. Shuffle colours re-rolls the schemes. Esc / the backdrop
  closes it; while it is open the editor's shortcuts wait. Light fixtures get a little glow so their emission comes on.
- **Schemes** (`match/schemes.ts`): a texture's palette is one or two colours in many values and saturations, not a
  background / primary / accent set — and its colours belong to its material. Each template has a Look
  (`TEMPLATE_LOOKS`): stone is brown, sandy, warm grey or slate (never green), brick red / tan / weathered, metal
  steel / grey / olive with a chance of rust, copper and bronze with a chance of verdigris, wood brown, liquids lava /
  slime / water / nukage, circuits green / blue / grey with gold or copper traces, ornaments crimson / blue / green
  with gold, light fixtures grey with a warm, cyan, red or green glow. A Look gives the hue ranges and chroma of its
  main colour, a minor colour with its chance (every third value), a glow / highlight family for the lightest value,
  and its value range. A scheme draws one hue and chroma, then seven values from deep shadow to highlight, each at
  its own saturation (less at a ramp's ends) with a little hue drift — OKLab, chroma lowered into the sRGB gamut.
  `schemeAnalysis` turns it into a synthetic `Analysis` (palette, tones at the measured ranks, lightness and chroma
  statistics, no periods). An earlier version drew Doom palette colours by hue family and snapped to the palette; it
  made green rock and electric blue stone, so colours are now chosen per material and the snap is gone.

## Checklist
- [x] Smart materials in the add grid
- [x] Wizard: Starters (blank + presets), Suggestions, size, shuffle, progressive thumbnails
- [x] Cards whose project carries a preview show it without compiling or rendering (FR8.20) — the examples all do
- [x] Schemes per material: valid, dark → light, deterministic per seed; stone never green, lava never blue; every
      template has a look and builds (`schemes.test.ts`)
