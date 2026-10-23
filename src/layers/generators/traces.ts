// Traces & mazes (FR8.8): circuit-board traces and mazes on a grid of nodes. The diagonal angle sets the cell aspect
// (45° = square cells), so diagonals can be any angle and still tile.
//   Route: paths with no junctions or crossings, bending where blocks of cells meet (routed buses).
//   Maze:  independent links east / north and, by chance, diagonally; junctions allowed.
//   Fill:  space-filling routing (router.ts): seed walks, then traces filling the rest without touching.
//   Labyrinth: a perfect maze — one spanning tree through every node (traceLinks.ts).
// Every mode's links are computed per node on the CPU (traceLinks.ts, router.ts) and read here from a per-node texture;
// the shader only draws them. Pads on ends, vias; the result is an SDF (traces, pads and vias), value 1 inside, and
// one random per connected trace (Per-feature variation, Random jitter).

import { hashI } from '@/core/hash';
import { P, halfPx, type ParamValues } from '@/core/params';
import { modeIs } from '../commonParams';
import type { LayerDef } from '../types';
import { routeTraces } from './router';
import { KING, linkDegrees, linkTo, traceLinks } from './traceLinks';

const MODES: [string, string, string][] = [
	[
		'route',
		'Route (paths, no junctions)',
		'Short paths that never branch or cross, bending where blocks of cells meet'
	],
	[
		'maze',
		'Maze (links, junctions)',
		'Independent links between neighbouring nodes: a network with junctions, loops and dead ends'
	],
	[
		'fill',
		'Fill (routed, space-filling)',
		'Circuit routing: long traces that fill the board, run alongside each other in buses and never touch'
	],
	[
		'labyrinth',
		'Labyrinth (perfect maze)',
		'One tree of corridors through every node: no loops, every node reachable — a classic maze'
	]
];
const isFill = modeIs('fill');
/** A param's value; its declared default when missing. */
const num = (q: ParamValues, key: string) => Number(q[key] ?? tracesLayer.params.find((d) => d.key === key)!.default);

/** Combined search reach is capped at this many extra rings of nodes (features up to ~8 cells across). */
const MAX_RINGS = 8;

export const tracesLayer: LayerDef = {
	type: 'traces',
	label: 'Traces & mazes',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Circuit traces or mazes on a grid of nodes linked straight or diagonally (any angle): routed space-filling traces, paths, link networks or a perfect labyrinth, with pads on dead ends and vias. Tileable.',
	params: [
		P.enum('mode', 'Mode', 'fill', MODES),
		P.int('cells', 'Cells across', 47, 1, 1024, {
			softMax: 128,
			hint: 'Nodes across the texture: the node pitch is width / cells (2 px pitch = 1 px traces 1 px apart)'
		}),
		P.float('angle', 'Diagonal angle', 45, 10, 80, {
			unit: '°',
			step: 0.5,
			hint: 'Slope of the diagonals; sets the row spacing (45° = square cells; rows are rounded to tile)'
		}),
		P.float('density', 'Density', 0.75, 0, 1, {
			step: 0.001,
			showIf: modeIs('route', 'maze'),
			hint: 'Chance of each link'
		}),
		P.float('diagonal', 'Diagonals', 0.4, 0, 1, {
			step: 0.001,
			showIf: modeIs('route', 'maze', 'labyrinth'),
			hint: 'Share of diagonal links (0 = right angles only)'
		}),
		P.float('bias', 'Horizontal bias', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Straight links and steps: 0 = mostly vertical, 0.5 = even, 1 = mostly horizontal'
		}),
		P.float('straight', 'Straightness', 0.8, 0, 1, {
			step: 0.001,
			showIf: modeIs('route', 'fill', 'labyrinth'),
			hint: 'Chance a trace or corridor carries straight on at each node (else it turns): low = twisty, 1 = long straight runs. Labyrinth: 0.25 = no preference'
		}),
		P.float('grouping', 'Grouping', 0.7, 0, 1, {
			step: 0.001,
			showIf: modeIs('maze'),
			hint: 'Links in a block follow its dominant direction — parallel bus runs instead of a tangle'
		}),
		P.int('block', 'Block size', 4, 1, 256, {
			softMax: 16,
			showIf: modeIs('route', 'maze'),
			hint: 'Cells per block: a block shares one direction (route) / dominant direction (maze)'
		}),
		P.int('min_links', 'Shortest trace', 4, 1, 256, {
			softMax: 16,
			showIf: modeIs('route', 'maze'),
			hint: 'Traces (connected pieces) with fewer links than this are dropped — no more pad-to-pad stubs; raise Density for more long ones'
		}),
		P.float('branching', 'Branching', 0.1, 0, 1, {
			step: 0.001,
			showIf: modeIs('labyrinth'),
			hint: 'How the maze grows: 0 = depth first (long winding corridors, few dead ends), 1 = from random places (short branches, many dead ends)'
		}),
		P.int('seeds', 'Seed traces', 8, 0, 256, {
			softMax: 16,
			group: 'fill',
			showIf: isFill,
			hint: 'Long random walks laid first'
		}),
		P.int('seed_length', 'Seed length', 240, 2, 8192, { softMax: 400, group: 'fill', showIf: isFill, hint: 'Steps' }),
		P.int('max_length', 'Fill length', 120, 2, 8192, {
			softMax: 200,
			group: 'fill',
			showIf: isFill,
			hint: 'Longest fill trace (steps)'
		}),
		P.int('min_length', 'Shortest trace', 8, 1, 256, {
			softMax: 16,
			group: 'fill',
			showIf: isFill,
			hint: 'Fill traces shorter than this are dropped'
		}),
		P.int('gap', 'Clearance', 0, 0, 16, {
			softMax: 4,
			group: 'fill',
			showIf: isFill,
			hint: 'Free nodes kept between traces (0 = neighbouring nodes; traces still never touch or cross)'
		}),
		P.enum(
			'directions',
			'Directions',
			'8',
			[
				['8', '8 (straight + diagonals)'],
				['6', '6 (no verticals; hexagonal at a 60° diagonal angle)'],
				['4', '4 (right angles)']
			],
			{
				group: 'fill',
				showIf: isFill,
				hint: 'One fixed set — traces only bend between neighbouring directions of it'
			}
		),
		P.float('hug', 'Run alongside', 0.6, 0, 10, {
			softMax: 3,
			step: 0.001,
			group: 'fill',
			showIf: isFill,
			hint: 'Preference for following a neighbouring trace, above all one running the same way, and for starting new traces beside fresh ones — 0 = loose, 1 = buses, 3 = tight parallel buses that bend together'
		}),
		P.float('fill', 'Fill', 1, 0, 1, {
			step: 0.001,
			group: 'fill',
			showIf: isFill,
			hint: 'Share of the empty board new traces may start in'
		}),
		P.float('open', 'Open areas', 0, 0, 1, {
			step: 0.001,
			group: 'fill',
			showIf: isFill,
			hint: 'Leaves rectangles of bare board between the routed clusters — footprints, mounting areas (0 = traces everywhere, 1 = about half the board open)'
		}),
		P.float('open_size', 'Open area size', 0.15, 0.02, 1, {
			softMax: 0.5,
			step: 0.001,
			group: 'fill',
			showIf: (p) => isFill(p) && Number(p.open) > 0,
			hint: 'Typical side of an open area, as a share of the board (each one 0.4–1.6× it, up to 3:1 long)'
		}),
		P.float('pins', 'Pin pads', 0.04, 0, 1, {
			step: 0.001,
			group: 'fill',
			showIf: isFill,
			hint: 'Chance each link breaks into two traces ending in pads — more pads, shorter traces'
		}),
		P.float('width', 'Trace width', 4, 0.25, 256, { softMax: 16, unit: 'px', step: 0.25 }),
		P.float('wide', 'Wide traces', 0.12, 0, 1, {
			step: 0.001,
			hint: 'Share of the traces drawn wider (power and ground runs); their pads and vias grow with them'
		}),
		P.float('wide_width', 'Wide width', 2, 1, 8, {
			softMax: 4,
			step: 0.05,
			showIf: (p) => Number(p.wide) > 0,
			hint: '× Trace width, for the wide traces — capped so a wide trace keeps 1 px clear of a normal one beside it (fewer cells across allow wider)'
		}),
		P.float('pads', 'Pads on ends', 1, 0, 1, {
			step: 0.001,
			group: 'pads',
			hint: 'Chance each trace end (dead end) gets a pad'
		}),
		P.float('pad_size', 'Pad radius', 5, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'pads',
			hint: 'Half the pad’s width (square, octagon) or its radius'
		}),
		P.float('tight_pads', 'Pads where crowded', 0.75, 0, 1, {
			step: 0.001,
			group: 'pads',
			showIf: isFill,
			hint: 'Fill: an end with another trace beside it has no room for a full pad. It gets one this size (× Pad radius) instead; 0 = it ends bare'
		}),
		P.enum(
			'pad_shape',
			'Pad shape',
			'round',
			[
				['round', 'Round'],
				['square', 'Square'],
				['octagon', 'Octagon']
			],
			{ group: 'pads' }
		),
		P.float('pad_hole', 'Pad hole', 0, 0, 256, {
			softMax: 8,
			unit: 'px',
			step: 0.25,
			group: 'pads',
			hint: 'Radius of a drill hole through each pad (0 = solid pads)'
		}),
		P.float('pad_lift', 'Pad height', 0.3, 0, 3, {
			softMax: 1,
			step: 0.001,
			group: 'pads',
			hint: 'Pads and vias stand this much higher than the traces (0.3 = 30 % higher: solder, plating). With it or Pad dome above 0, Height › Pattern takes the relief from this layer’s own shapes; at 0 from the combined mask it writes, like other shape layers'
		}),
		P.float('pad_dome', 'Pad dome', 0.35, 0, 1, {
			step: 0.001,
			group: 'pads',
			hint: 'Rounds pads and vias into domes (solder blobs): 0 = the Edge bevel, 1 = one dome over the whole pad'
		}),
		P.float('vias', 'Vias', 0.12, 0, 1, {
			step: 0.001,
			group: 'pads',
			hint: 'Chance of a ring at any linked node (never two linked side by side)'
		}),
		P.float('via_size', 'Via radius', 5, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'pads',
			hint: 'At least the trace’s half-width + the ring, so the ring always shows round the trace'
		}),
		P.float('via_ring', 'Via ring', 3, 0.25, 256, {
			softMax: 8,
			unit: 'px',
			step: 0.25,
			group: 'pads',
			hint: 'Width of the via’s ring round its hole; at or past the radius the via is solid'
		}),
		P.seed()
	],
	groups: [
		{ id: 'fill', label: 'Fill routing' },
		{ id: 'pads', label: 'Pads & vias' }
	],
	// A routed circuit board: domed traces, raised domed pads on every end, drilled vias (the px sizes as at 512 px).
	defaults: {
		h_on: true,
		h_amount: 0.5,
		h_var: 0.2,
		bevel: 2,
		profile: 'smooth',
		aa: true,
		dif_on: true,
		dif_src: 'flat'
	},
	// Added in the editor: the px sizes follow the texture — a 2 px pitch and 1 px traces at 64 px (pixel art, no
	// anti-aliasing), ~11 px pitch with 4 px traces at 512 px.
	fresh: ({ width, height }) => {
		const k = Math.sqrt(width * height) / 64;
		const pitch = Math.max(2, 2 * k ** 0.82);
		const w = halfPx(0.36 * pitch, 1);
		const pad = halfPx(1.1 * w + 0.5, 1.5);
		return {
			cells: Math.min(1024, Math.max(2, Math.round(width / pitch))),
			width: w,
			pad_size: pad,
			via_size: halfPx(pad, 1.5),
			via_ring: halfPx(0.7 * w, 0.5),
			aa: pitch >= 4,
			bevel: halfPx(0.5 * w, 0.5)
		};
	},
	textures: ['route'],
	// R = link mask (bit d: a trace toward KING[d]); G = flags: 1 a trace end with a pad, 2 via, 4 a crowded end with a pad
	// (fill's ends without room for a full one), 8 on a wide trace; B + 256 A = connected trace id (16 bits: on boards of
	// more than 65 535 traces, ids repeat).
	cpuData(q, ctx) {
		const nx = Math.min(1024, Math.max(1, Math.round(num(q, 'cells'))));
		const cw = ctx.width / nx;
		const ch = cw * Math.tan((Math.min(80, Math.max(10, num(q, 'angle'))) * Math.PI) / 180);
		const ny = Math.min(4096, Math.max(1, Math.round(ctx.height / ch)));
		const n = nx * ny;
		const m = String(q.mode ?? 'fill');
		let links: Uint8Array;
		let flags: Uint8Array;
		if (m === 'fill') {
			const dirs = num(q, 'directions');
			const r = routeTraces({
				nx,
				ny,
				wrap: ctx.tileable,
				seed: Math.floor(ctx.seed * 7919) + 1,
				seeds: Math.round(num(q, 'seeds')),
				seedLength: Math.round(num(q, 'seed_length')),
				minLength: Math.round(num(q, 'min_length')),
				maxLength: Math.round(num(q, 'max_length')),
				gap: Math.round(num(q, 'gap')),
				straight: num(q, 'straight'),
				directions: dirs === 4 ? 4 : dirs === 6 ? 6 : 8,
				hug: num(q, 'hug'),
				fill: num(q, 'fill'),
				vias: num(q, 'vias'),
				pins: num(q, 'pins'),
				bias: num(q, 'bias'),
				open: num(q, 'open'),
				openSize: num(q, 'open_size')
			});
			links = new Uint8Array(n);
			for (let i = 0; i < n; i++) if (r.out[i] >= 0) links[i] = 1 << r.out[i];
			flags = r.flags.map((f) => f & 3); // the router's bit 2 (on a trace) is not ours
		} else {
			({ links, flags } = traceLinks({
				mode: m === 'maze' ? 'maze' : m === 'labyrinth' ? 'labyrinth' : 'route',
				nx,
				ny,
				wrap: ctx.tileable,
				seed: ctx.seed,
				density: num(q, 'density'),
				diagonal: num(q, 'diagonal'),
				bias: num(q, 'bias'),
				straight: num(q, 'straight'),
				grouping: num(q, 'grouping'),
				block: num(q, 'block'),
				vias: num(q, 'vias'),
				branching: num(q, 'branching')
			}));
		}
		const id =
			m === 'route' || m === 'maze'
				? dropShort(links, flags, nx, ny, Math.round(num(q, 'min_links')))
				: traceIds(links, nx, ny);
		spaceVias(links, flags, nx, ny);
		if (m === 'fill') markCrowdedEnds(links, flags, nx, ny);
		// Per trace and per end, drawn here rather than per pixel for every node in reach: which traces are wide, and which
		// ends get their pad (bit for bit the shader's hashI, against the float uniforms it would have compared with).
		const wide = Math.fround(num(q, 'wide'));
		const pads = Math.fround(num(q, 'pads'));
		const data = new Uint8Array(n * 4);
		for (let i = 0; i < n; i++) {
			const tid = id[i] & 0xffff;
			let fl = flags[i] & 7;
			if (fl & 5 && !(hashI(i % nx, Math.floor(i / nx), ctx.seed + 21) < pads)) fl &= ~5;
			if (hashI(tid, 9, ctx.seed) < wide) fl |= 8;
			data[i * 4] = links[i];
			data[i * 4 + 1] = fl;
			data[i * 4 + 2] = tid & 255;
			data[i * 4 + 3] = tid >> 8;
		}
		return { route: { width: nx, height: ny, data } };
	},
	glsl: /* glsl */ `
const ivec2 KING[8] = ivec2[8](${KING.map(([x, y]) => `ivec2(${x}, ${y})`).join(', ')});
ivec2 tr_n;
vec2 tr_cs;

ivec2 tr_w(ivec2 k) { return uTile ? imod(k, tr_n) : k; }
bool tr_in(ivec2 k) { return uTile || (k.x >= 0 && k.y >= 0 && k.x < tr_n.x && k.y < tr_n.y); }
// Node centres snapped to pixel centres, so 1 px traces stay 1 px (a centre on a pixel edge smears into two).
vec2 tr_node(ivec2 k) { return floor((vec2(k) + 0.5) * tr_cs) + 0.5; }

GenOut gen(vec2 p) {
  tr_n = textureSize(t_route, 0);
  tr_cs = uRes / vec2(tr_n);
  ivec2 c0 = ivec2(floor(p / tr_cs - 0.5));
  float best = 1e4;  // everything
  float bestT = 1e4; // traces
  float bestP = 1e4; // pads and vias (with their holes)
  float fx = 0.0;    // pads and vias: the deepest point into their own bevel (0 edge … 1 full height)
  float bestId = 0.0;
  float hw = 0.5 * u_width;
  // Wide traces: a share of the traces (by trace id) Wide width × as wide; their pads and vias grow by as much.
  // A wide trace keeps 1 px clear of a normal one beside it: the nearest neighbour runs a node over (gap + 1 in fill),
  // which for parallel diagonals is cw·ch / |cs| away.
  float near = tr_cs.x * tr_cs.y / length(tr_cs) * (u_mode == 2 ? 1.0 + float(u_gap) : 1.0);
  float wideK = u_wide > 0.0 ? max(min(u_wide_width, (near - hw - 1.0) / max(hw, 1e-3)), 1.0) : 1.0;
  float grow = hw * (wideK - 1.0);
  // Nodes around the pixel: 4×4 reaches features up to a cell from their node; each further cell of the largest
  // feature (trace half-width, pad, via) adds a ring. The count comes from uniforms, so D3D's compiler (ANGLE on
  // Windows) keeps this a loop instead of unrolling it.
  float ring = max(u_via_ring, 0.25);
  float padR = u_pads > 0.0 ? (max(u_pad_size, hw) + grow + 0.5) * (u_pad_shape == 0 ? 1.0 : 1.415) : 0.0;
  float viaR = u_vias > 0.0 ? max(u_via_size, hw + ring) + grow : 0.0;
  float reach = max(hw * wideK, max(padR, viaR)) + 1.0;
  float cmin = min(tr_cs.x, tr_cs.y);
  int rings = min(int(reach / cmin), ${MAX_RINGS});
  int span = 4 + 2 * rings;
  int off = span / 2 - 1;
  // Every feature nearer than this was found (traces from nodes past the window end a ring in, pads and vias sit two
  // rings in): the distance is capped there, so it stays continuous where the window moves on (Bevel / Etch read the
  // mask out to their width).
  float sure = max(min(float(rings + 1) * cmin - hw * wideK, float(rings + 2) * cmin - max(padR, viaR)), 0.5);
  float hole = 1e4; // drill holes (pads, vias): cut out of everything at the end, traces running in included
  // Bevel aspect: the same distances measured in the space the aspect stretches (px of Bevel), per piece — each
  // trace's sides by their normal and its caps by their direction, square and octagon pads by their sides' planes,
  // rings and holes by their direction — so the least of them stays continuous where pieces and pad sides meet (the
  // distances' own direction steps there). Off at aspect 1: the wrapper's bevel, unchanged.
  bool asp = bevelAspectOn();
  vec2 bk = u_bevel / bevelWidths();             // × per screen axis
  float bkd = u_bevel / bevelWidth(vec2(1.0));   // × across an octagon's diagonal sides
  float bestB = 1e4, bestTB = 1e4, holeB = 1e4;  // (bestB: pads and vias)
  // No continue in these loops: ANGLE / D3D11 can miscompile it (AGENTS.md).
  for (int c = 0; c < span * span; c++) {
    ivec2 k = c0 + ivec2(c % span, c / span) - off;
    if (tr_in(k)) {
      vec4 t = texelFetch(t_route, tr_w(k), 0);
      int links = int(t.r * 255.0 + 0.5);
      int fl = int(t.g * 255.0 + 0.5);
      float id = floor(t.b * 255.0 + 0.5) + 256.0 * floor(t.a * 255.0 + 0.5);
      float thw = (fl & 8) != 0 ? hw * wideK : hw;
      float g = thw - hw;
      vec2 a = tr_node(k);
      for (int d = 0; d < 8 * UNI_1; d++) {
        if ((links & (1 << d)) != 0) {
          vec2 c = bevelCapsule(p - a, tr_node(k + KING[d]) - a, thw, mat2(1.0));
          bestT = min(bestT, c.x);
          if (c.x < best) { best = c.x; bestId = id; }
          if (asp) bestTB = min(bestTB, c.y);
        }
      }
      vec2 q = abs(p - a);
      float r = length(q);
      // Pads (on ends that drew one; crowded ends smaller) and vias; a via on a pad is the pad's (Pad hole drills pads).
      float pr = (fl & 1) != 0 ? u_pad_size : (fl & 4) != 0 ? u_pad_size * u_tight_pads : 0.0;
      bool pad = pr > 0.0;
      if (pad || (fl & 2) != 0) {
        // One round feature, its arguments picked first: radius R, always reaching past the trace it sits on (a via's ring
        // always shows round it), shape and drill hole hr (> 0: drilled; a via's hole leaves its ring).
        float R = pad ? max(pr + g, thw + 0.5) : max(u_via_size + g, thw + ring);
        int shp = pad ? u_pad_shape : 0;
        float hr = pad ? u_pad_hole : R - ring;
        float dist = shp == 1 ? sdBox(q, vec2(R)) : shp == 2 ? max(max(q.x, q.y), (q.x + q.y) * 0.70711) - R : r - R;
        if (dist < best) { best = dist; bestId = id; }
        // Its own height (Pad height / Pad dome): a dome over it, or over the ring of a drilled one so it peaks mid-ring
        // (its bevel at most 0.4 of the ring, a little flat top), never a bowl round the hole.
        float bw = mix(u_bevel, R, u_pad_dome);
        // (Stretched: exact inside square and octagon pads; outside only its sign matters. Circles by their direction.)
        float distB = !asp ? dist : shp == 0 ? bevelLine(dist, q)
                    : max(max((q.x - R) * bk.x, (q.y - R) * bk.y), shp == 2 ? ((q.x + q.y) * 0.70711 - R) * bkd : -1e4);
        if (hr > 0.0) {
          hole = min(hole, r - hr);
          dist = max(dist, hr - r);
          bw = min(bw, 0.4 * (pad ? max(R - hr, 0.0) : ring));
          if (asp) {
            holeB = min(holeB, bevelLine(r - hr, q));
            distB = max(distB, bevelLine(hr - r, q));
          }
        }
        bestP = min(bestP, dist);
        bestB = min(bestB, distB);
        // The bevel (Pad dome 0) in the stretched space; the dome over the whole feature stays round.
        fx = max(fx, -(asp ? mix(distB, dist, u_pad_dome) : dist) / max(bw, 1e-3));
      }
    }
  }
  best = max(min(best, sure), -hole);
  bestT = min(bestT, sure);
  bestP = min(bestP, sure);
  float rnd = hashI(ivec2(int(bestId), 5), uSeed);
  GenOut g = genOut(1.0, 1.0, rnd, best);
  if (u_pad_lift > 0.0 || u_pad_dome > 0.0) {
    // Pad height / dome: the relief from the layer's own shapes — traces by the Edge bevel, pads and vias (1 + Pad
    // height) × as high (domed per Pad dome); every hole cuts through all of it.
    bestT = max(bestT, -hole);
    bestP = max(bestP, -hole);
    bool noBev = u_profile == 0 && u_pad_dome <= 0.0;
    float tH = bevelProfile(-(asp ? max(bestTB, -holeB) : bestT) / u_bevel);
    float pH = noBev ? 1.0 : profileCurve(u_profile == 0 ? 3 : u_profile, fx);
    g = genOutHeight(1.0, 1.0, rnd, best, max(tH * coverage(bestT, u_aa), (1.0 + u_pad_lift) * pH * coverage(bestP, u_aa)));
  }
  if (asp) g.bdist = max(min(bestTB, bestB), -holeB);
  return g;
}
`
};

/**
 * Route / maze: removes connected traces with fewer than `min` links (their pads and vias go with them). Returns the
 * trace ids of what is left (traceIds' numbering).
 */
export function dropShort(links: Uint8Array, flags: Uint8Array, nx: number, ny: number, min: number): Int32Array {
	const id = traceIds(links, nx, ny);
	if (min <= 1) return id;
	const count = new Int32Array(nx * ny + 1);
	for (let i = 0; i < nx * ny; i++) for (let d = 0; d < 8; d++) if (links[i] & (1 << d)) count[id[i]]++;
	// Dropped traces are whole: the rest keep their order of first nodes, renumbered without gaps.
	const kept = new Int32Array(nx * ny + 1);
	let next = 0;
	for (let i = 0; i < nx * ny; i++) {
		if (!id[i]) continue;
		if (count[id[i]] < min) {
			links[i] = 0;
			flags[i] = 0;
			id[i] = 0;
		} else id[i] = kept[id[i]] ||= ++next;
	}
	return id;
}

/** Vias need clearance: a via linked to an earlier node (in scan order) that kept its via is dropped. */
export function spaceVias(links: Uint8Array, flags: Uint8Array, nx: number, ny: number): void {
	for (let i = 0; i < nx * ny; i++) {
		if (!(flags[i] & 2)) continue;
		for (let d = 0; d < 8; d++) {
			const j = linkTo(i, d, nx, ny);
			// A link either way: from i toward j, or from j back toward i.
			if (j < i && flags[j] & 2 && (links[i] & (1 << d) || links[j] & (1 << ((d + 4) % 8)))) {
				flags[i] &= ~2;
				break;
			}
		}
	}
}

/** Fill: flags (bit 2) the trace ends the router left without a pad (no room), for Pads where crowded. */
export function markCrowdedEnds(links: Uint8Array, flags: Uint8Array, nx: number, ny: number): void {
	const deg = linkDegrees(links, nx, ny);
	for (let i = 0; i < nx * ny; i++) if (deg[i] === 1 && !(flags[i] & 1)) flags[i] |= 4;
}

/** Connected-trace id per node (union–find over the links, wrapping like the links do); 0 for nodes on no trace. */
export function traceIds(links: Uint8Array, nx: number, ny: number): Int32Array {
	const n = nx * ny;
	const to = (i: number, d: number) => linkTo(i, d, nx, ny);
	const parent = new Int32Array(n);
	for (let i = 0; i < n; i++) parent[i] = i;
	const find = (i: number): number => {
		while (parent[i] !== i) i = parent[i] = parent[parent[i]];
		return i;
	};
	const used = new Uint8Array(n);
	for (let i = 0; i < n; i++)
		for (let d = 0; d < 8; d++) {
			if (!(links[i] & (1 << d))) continue;
			const j = to(i, d);
			used[i] = used[j] = 1;
			const a = find(i);
			const b = find(j);
			if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
		}
	// Number the traces in order of their first node.
	const id = new Int32Array(n);
	const seen = new Int32Array(n);
	let next = 0;
	for (let i = 0; i < n; i++) {
		if (!used[i]) continue;
		const root = find(i);
		if (!seen[root]) seen[root] = ++next;
		id[i] = seen[root];
	}
	return id;
}
