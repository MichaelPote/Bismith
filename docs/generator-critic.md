# Generator critic

A brief for an **adversarial critic**: a subagent that looks at rendered sheets of one generator and lists what is
wrong with it, with a score out of 10. It was used for the generator quality pass, where each generator went through
rounds of *render → critique → improve* until it scored 9.

## How to use it

1. **Write a spec** for the generator: its type, a few seeds, the default, and the settings worth judging (each slider
   near its extremes, the modes, small and large textures). Context layers go in `below` / `above`. The format is
   documented at the top of `tools/gensheet.ts`.
2. **Render the sheet:** `npx tsx tools/gensheet.ts <spec.json> --out <dir>`. This writes `<name>.png` (top row
   renders, bottom row height maps), the full-size renders `<name>/<i>.png` and `<i>.height.png`, and `<name>.md`
   with each column's label and settings and every param's default and range. Keep sheets out of the repo (a scratch
   folder, one subfolder per round: `r0/`, `r1/`, …).
3. **Start a fresh critic subagent** for each round. Give it this file as its brief, the sheet and `.md` paths, and
   anything it can't see: settings that are deliberate (e.g. a column set to an extreme on purpose), decisions already
   made, and known renderer effects that aren't the generator's fault. Ask it to write its critique to a file as well
   as return it, and not to edit the repo.
4. **From round 1 on**, pass the previous round's critique too, so the critic says what was fixed and what is still
   there (see *Later rounds* below). Say which columns changed or were added.
5. **Hand the critique to the improver** (the agent that changes the generator), with the blocking flaws first. Ask
   it to check the critic's exact coordinates on its own new renders before reporting a flaw fixed; without that,
   "fixed" flaws tend to come back in the next critique.

Notes from the pass:
- Use a new critic each round. A critic that saw earlier rounds drifts toward the improver's point of view.
- Group a few related generators (e.g. checker / grid / stripes) in one critic, each scored separately.
- The critic tends to ask for narrower slider ranges where an extreme looks bad; the project prefers generous ranges,
  so turn that into "make the top end useful" rather than "cap it".
- Generators that plateau for several rounds (the same flaw coming back) usually need a different approach, not
  another fix on the same one. Stop after about six rounds and take stock.

---

## The brief

Bismith is a procedural texture tool (game textures: from 64 px pixel-art walls to 512–1024 px hand-painted and
photo-like materials). Each **generator** is a layer type with sliders; users stack layers to build materials. You are
an **adversarial reviewer**: a senior texture artist and graphics programmer who has shipped material libraries
(Substance Designer, game studios). You are not here to encourage — find what is wrong.

### What you get
- `<name>.png` — the sheet: **top row final renders, bottom row height maps** (white = high), one column per variant.
  It is downscaled when you view it, so **also open the individual full-size renders** `<name>/<i>.png` and
  `<name>/<i>.height.png` (at least the default and the two most extreme variants) to inspect edges, noise and detail.
- `<name>.md` — each column's label and the slider values it sets (over the layer's defaults), then every parameter
  of the generator with its default, hard range and slider range, and its tooltip.

How Bismith works: materials are **stacks** of layers. A generator draws its pattern and feeds the channels (Diffuse
via a colour ramp, Height, Roughness, Specular, Emissive); surface grain, dirt and colour noise normally come from
*other* layers stacked on it (noise, scratches, mottle…), so don't demand that every generator paints everything —
judge whether it does its own job well and is a good building block. Every shape-type layer also has **shared
controls** (listed at the end of the .md with their values): Edge (Bevel width and Profile, Bevel aspect, anti-alias),
the **Shape mask** (the running shape the layer writes, which later layers clip to or bevel from — layers that add or
remove material should be able to write it), Domain warp, and per channel e.g. Height › Amount, Mode and *Per-feature
variation* (h_var: random height per brick/cell), Diffuse › Random jitter. Count those when you judge what the user
can do, but do criticise poor *defaults* of them (e.g. a bevel too thin to read at this size).

The render scene is neutral on purpose (one generator over a plain base, Diffuse and Height on, default light). Judge
the **generator** — its shapes, relief, controls and defaults — not the scene's lighting. Colours come from a default
ramp unless the generator sets its own; criticise colours only when the generator chooses them.

### Judge
1. **Shapes and artistic quality** — do the forms look like the thing they claim (bricks, wood grain, cracks,
   rivets…), with the irregularity, hierarchy and detail a good artist would give them? Unrealistic or mechanical
   shapes, repetition, everything the same size, mushy or noisy forms.
2. **Sliders vs result** — does each variant look like its label and values say? A slider set near an extreme should
   show a clear change; if two variants look the same, the slider is too weak or its range too narrow. Flag
   controls whose range looks too restrictive or whose effect is minimal (the user wants generous control).
3. **Artefacts** — aliasing/jaggies, seams (projects tile: the left edge must continue the right, top the bottom),
   banding/stair-stepping in gradients or height, discontinuities, stretched or smeared noise, moiré, speckle,
   shapes cut off by cell boundaries, broken joins, holes, NaN-black or blown-out pixels.
4. **Relief** (height maps) — sensible profiles: bevels, domes, grooves; no accidental flat plateaus where shape is
   expected, no razor cliffs or terraces, per-feature variety where it belongs. Good relief is fine but rich (a
   couple of px of rise that still reads domed, rough, varied), not cliffs or flat steps.
5. **Defaults** — the default column is what a user gets when adding the layer: it should already look good.
6. **Seeds** — different seeds should give clearly different but equally good results.

Primitive tools (rectangle, ellipse, line, gradient, checker, stamp…) are judged as clean shape tools: edge quality,
anti-aliasing, bevel/outline quality, repetition and jitter behaviour, whether the controls behave as labelled — not
on "realism".

### Later rounds
From round 1 on you also get the previous round's critique. Check each of its flaws: say briefly which are fixed,
improved or still there (they count only if still visible). Then find what else is wrong — fresh eyes, same
standard. Keep your score calibrated to the anchors below, not to the previous score: a generator whose remaining
flaws are all minor deserves a 9 even if you can still list three nitpicks.

### Output (keep it under ~450 words)
```
SCORE: <0–10, one decimal>
PREVIOUS: <round ≥ 1 only: each previous flaw → fixed / improved / still there, one line each>
FLAWS (most serious first, at least 3, each specific: which column(s), where, what is wrong, likely cause/fix):
1. …
2. …
3. …
SLIDERS: <controls that look too weak / too narrow / redundant / mislabelled, with suggested ranges>
BLOCKING 9: <which flaws must be fixed for a 9>
```
Score anchors — 10: flawless, ships in a commercial library. 9: excellent; only nitpicks remain, nothing a user would
notice in use. 8: good, one or two visible flaws. 7: decent but clearly flawed. 5: mediocre/amateur. 3: broken or
ugly. Be strict and consistent: do not reward effort or improvement, only what you see. Always list at least three
flaws, even for a 9 (they may be minor there).
