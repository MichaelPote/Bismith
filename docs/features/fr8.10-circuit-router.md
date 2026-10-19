# FR8.10 — Circuit routing (space-filling traces)

**Status:** done — Traces & mazes › Mode _Fill_; the Circuit board lump's default

Space-filling traces that never touch need a global, sequential process, so they are routed on the CPU and drawn on
the GPU:

- **Generator data hook** (`LayerDef.cpuData` / `textures`): a generator may compute RGBA8 textures from its params
  and the texture size on the CPU; the pipeline caches them per layer (until params, size, tiling or seed change) and
  binds them as `sampler2D t_<name>`.
- **Router** (`layers/generators/router.ts`, tested): nodes on a wrapping grid; one fixed **direction set** — 8
  (straight + diagonals at the Diagonal angle), 6 (no verticals: hexagonal at a 60° diagonal angle) or 4 (right
  angles), never mixed; traces only bend one step within it. A few long seed walks go first; then every
  free node, in random order, may start a fill trace running alongside its neighbour (Run alongside → buses).
  Clearance 0 lets traces use neighbouring nodes (1 px lines on a 2 px pitch, 1 px apart) while never crossing:
  a diagonal step can't cross another trace's diagonal over the same grid square. Each fill start tries its
  directions until one walks, over two passes. Fill sets how much of the empty board new traces may start in.
- **Pads**: a pad needs a ring of nodes free of other traces, which it then reserves (later traces keep clear); a
  blocked end backs off up to three nodes to find room, else ends bare. **Pin pads** sets how often traces end in
  pads: it drops nodes from finished traces (the trace becomes two pieces, each ending in a pad one node short of the
  gap, pieces keep two links) and ends walks early where a pad fits — more, shorter, pad-ended traces at the cost of
  some density. Vias go on interior nodes.
- **Horizontal bias** weights horizontal against vertical steps and starts. **Run alongside** favours steps beside
  another trace, far more one running the same way, and queues the free nodes beside each new trace as the next
  starts, so buses grow trace by trace and bend together. **Open areas** keeps rectangles of board (varied size per
  _Open area size_, up to 3:1, wrapping) free of traces — footprints and mounting areas between routed clusters. A
  diagonal step never crosses another over the same grid square, the walking trace's own included. **Pads where
  crowded**: ends left without room for a full pad (flag 4) get one this fraction of the radius instead of ending bare.
- **Shader**: reads each node's link (R) and flags (G) and draws crisp SDF segments, pads and vias; node centres
  snap to pixel centres so 1 px traces stay 1 px.
- Other modes stay: _Route_ (local paths, no junctions — per-node out / in priority) and _Maze_ (independent links).
