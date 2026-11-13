// Snow (FR8.31): a wintry coat over the layers below, in up to three layers that build on one another.
//
// Rime, the broadest: a noisy white veil over every exposed face — the crevices of the relief below stay bare, by
// Mask area's crevice measure (surfaceMask.ts) — colour only, no height.
//
// Wall: snow builds up on the top sides of the ledges in the relief below — found as Drips finds its ledges
// (layers/ledges.ts), but where the height rises going down the texture — as a rounded cap above each ledge's top edge,
// heaped and thinned along it in drifts, its ends rounded off, clinging a few px down the face below the edge; it adds
// colour and height. Icicles hang from the overhangs (the ledges as Drips finds them), as Ice once grew them.
//
// Floor: snow lies on the most exposed parts (Mask area's high spots and the tops of the relief), in drifts, and ice
// builds up in the hollows: a clear, level glaze that refracts and tints what is below it.

import type { Texture } from 'three';
import { P, gradient, halfPx, round1, type ParamValues } from '@/core/params';
import { LEDGE_GLSL, LEDGE_GRID_GLSL, ledgeCellGlsl, ledgeCells, ledgeGrid, ledgeParams } from '../ledges';
import type { LayerDef } from '../types';
import { noiseCalib, noiseControlsAs, noiseFieldGlsl, NZ_SHARED_GLSL } from './noise';

const wall = (p: ParamValues) => p.mode !== 'floor';
const floorMode = (p: ParamValues) => p.mode === 'floor';
const snowOn = (p: ParamValues) => Number(p.snow) > 0;
const icicles = (p: ParamValues) => wall(p) && Number(p.icicles) > 0;
/** The rime's grain (Noise's controls, under rg_): a 3-octave value fBm of 3 px cells at 512 px — the crystals' flecks. */
const GRAIN_DEFAULTS: ParamValues = { noise: 'value', scale: 170, octaves: 3, gain: 0.55 };

/**
 * The snow caps pass (Wall): per pixel, how thick the snow on it is (px), from the ledges above and below it. Looking
 * down the texture up to the cap's depth: a ledge's top rising k px below carries a cap there — as thick as its rise over the pixel
 * plus Snow height, so it heaps up over a joint onto the face above — rounded off over the cap's depth (a quarter ellipse), which drifts (Drifts across) heap and
 * thin along the ledge. Looking up: just below a ledge's top edge, snow clings down its face (Cling, ragged), Snow
 * height thick. Both counted as far as the rise counts as a ledge (the ledge test, the other way up).
 */
const SNOW_CAPS_GLSL =
	LEDGE_GLSL +
	/* glsl */ `
void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy));
  vec2 px = gl_FragCoord.xy;
  float h0 = fetchT(tSurface, c).r;
  vec2 dc = cellsFor(u_snow_scale, 1.0);
  float dn = 0.67 * valueNoise(px / uRes * dc, periodOf(dc), uSeed + 131.0)
           + 0.33 * valueNoise(px / uRes * dc * 2.0, periodOf(dc * 2.0), uSeed + 137.0);
  // (Lumps: a noise a cap or so across bulges and sags its top.)
  vec2 lc = cellsFor(uRes.x / max(1.2 * u_snow_depth, 2.0), 1.0);
  float nl = valueNoise(px / uRes * lc, periodOf(lc), uSeed + 141.0);
  float S = max(u_snow_depth * u_snow * (1.0 - u_snow_drift * smoothstep(0.2, 0.8, dn)) * (1.0 + 0.6 * u_lumps * (nl - 0.5)), 0.5);
  vec2 cc = cellsFor(uRes.x / max(1.2 * u_snow_depth, 2.0), 1.0);
  float C = max(u_snow_cling * u_snow * (0.15 + 0.85 * valueNoise(px / uRes * cc, periodOf(cc), uSeed + 139.0)), 0.5);
  int K = int(ceil(u_snow_depth * u_snow)), KC = int(ceil(u_snow_cling * u_snow));
  float T = 0.0, mn = h0;
  for (int i = 0; i < K + KC; i++) {
    bool down = i < K;
    int k = down ? i + 1 : i - K + 1;
    if (i == K) mn = h0;
    float hk = fetchT(tSurface, c + ivec2(0, down ? -k : k)).r;
    // The step that counts as a ledge: below, a ledge's top rising from the lowest point passed (so the cap can heap up
    // over a joint onto the face above it); above, the face falling away over its top edge.
    mn = min(mn, hk);
    float step_ = down ? hk - mn : h0 - mn;
    float t = float(k) / (down ? S : C);
    float prof = sqrt(max(1.0 - t * t, 0.0));
    T = max(T, ((down ? max(hk - h0, 0.0) * uDepth : 0.0) + u_snow_height) * prof * ledgeOk(step_));
  }
  oColor = vec4(T, 0.0, 0.0, 1.0);
}
`;

/**
 * The icicle cells pass (Wall): per ledge cell (tLedges: its strongest ledge pixel, user px, and drop), whether it grows
 * an icicle — by the chance Icicles × how much its drop counts as a ledge × the clustering. Worked out once per cell, not
 * at every pixel an icicle might reach: (pos, drop, 1 if it grows one).
 */
const ICICLE_CELLS_GLSL =
	LEDGE_GLSL +
	/* glsl */ `
uniform sampler2D tLedges;
void main() {
  ivec2 lw = ivec2(floor(gl_FragCoord.xy));
  vec4 b = texelFetch(tLedges, lw, 0);
  vec2 icl = cellsFor(4.0, 1.0);
  float cl = mix(1.0, 2.0 * smoothstep(0.4, 0.7, valueNoise(b.xy / uRes * icl, periodOf(icl), uSeed + 69.0)), u_ice_cluster);
  bool grows = hashI(lw, uSeed + 63.0) < u_icicles * ledgeOk(b.z) * cl;
  // How far it may hang: down to where the surface stands out past the overhang it hangs from (a block that projects
  // further), so it never runs into one. (A brick below as far out as the one above lets it hang in front.)
  ivec2 c0 = ivec2(int(b.x), int(uRes.y - b.y));
  int reach = int(u_ledge_reach + 0.5);
  float top = fetchT(tSurface, c0).r;
  int n = int(ceil(u_ice_len + 1.0));
  float maxLen = u_ice_len + 1.0;
  bool hit = false;
  for (int k = reach + 1; k < n; k++) {
    if (!hit && fetchT(tSurface, c0 - ivec2(0, k)).r - top > max(0.5 * u_ledge, 0.05)) { hit = true; maxLen = float(k) - 2.0; }
  }
  oColor = vec4(b.xyz, grows ? max(maxLen, 0.0) : 0.0);
}
`;

export const snowLayer: LayerDef = {
	type: 'snow',
	label: 'Snow',
	category: 'pattern',
	kind: 'generator',
	description:
		'Snow and ice over the layers below: Made from a white rime on every exposed face, snow on the ledges (Wall) or the high spots (Floor), and icicles under the overhangs or ice in the hollows. Makes frozen walls and ledges, snowy floors and paving, winter versions of any texture.',
	params: [
		P.enum(
			'mode',
			'Mode',
			'wall',
			[
				['wall', 'Wall', 'snow on the top sides of the ledges, icicles hanging from their undersides'],
				['floor', 'Floor', 'snow on the most exposed parts, ice built up in the hollows']
			],
			// It picks the shader variant (shaderFeatures), not a branch in it.
			{ uniform: false, hint: 'Whether the surface is upright (snow sits on ledges, icicles hang) or lies flat' }
		),
		P.enum(
			'output',
			'Output',
			'all',
			[
				[
					'all',
					'All',
					'the rime, snow and ice over the layers below (Diffuse takes this colour instead of the gradient ramp)'
				],
				['rime', 'Rime', '1 where the rime covers'],
				['snow', 'Snow', '1 on the snow'],
				['ice', 'Ice', '1 on the icicles (Wall) or the ice in the hollows (Floor)']
			],
			{ hint: 'Picks what the layer puts out' }
		),

		P.float('rime', 'Rime', 0.4, 0, 1, {
			step: 0.001,
			section: 'Rime',
			hint: 'How much of the exposed surface a white, grainy rime covers (0 = none). Colour only: it adds no height'
		}),
		P.color('rime_col', 'Rime colour', '#e4edf5', { section: 'Rime', showIf: (p) => Number(p.rime) > 0 }),
		P.float('rime_scale', 'Rime patches across', 6, 0.5, 64, {
			softMax: 24,
			step: 0.01,
			section: 'Rime',
			showIf: (p) => Number(p.rime) > 0,
			hint: 'How many thick and thin patches of rime fit across the width'
		}),
		P.float('shelter', 'Shelter', 0.8, 0, 1, {
			step: 0.001,
			section: 'Rime',
			hint: 'How bare the crevices of the relief stay (0 = rime everywhere). On a Floor, the crevices are also where ice builds up'
		}),
		P.float('shelter_r', 'Shelter radius', 6, 0.5, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			section: 'Rime',
			hint: 'How far round each pixel the relief is looked at for crevices and exposed high spots (as Mask area’s Search radius)'
		}),

		P.float('snow', 'Snow', 0.7, 0, 1, {
			step: 0.001,
			section: 'Snow',
			hint: 'How much snow builds up: on a Wall, how deep the caps on the ledges are; on a Floor, how much of the exposed surface it covers (0 = none)'
		}),
		P.color('snow_col', 'Snow colour', '#f3f7fb', {
			section: 'Snow',
			hint: 'The colour of the snow, and of the icicles’ milky cores and rims'
		}),
		P.float('snow_depth', 'Cap depth', 14, 1, 128, {
			softMax: 48,
			unit: 'px',
			axis: 'y',
			step: 0.1,
			section: 'Snow',
			showIf: (p) => wall(p) && snowOn(p),
			hint: 'How far the deepest snow caps reach up the wall above a ledge’s top edge (Snow scales it)'
		}),
		P.float('snow_height', 'Snow height', 2, 0, 16, {
			softMax: 4,
			unit: 'px',
			step: 0.01,
			section: 'Snow',
			showIf: snowOn,
			hint: 'How far the snow stands proud of what it lies on, in height px: on a Wall, in front of the ledge; on a Floor, its thickness'
		}),
		P.float('snow_cling', 'Cling', 3, 0, 32, {
			softMax: 12,
			unit: 'px',
			axis: 'y',
			step: 0.1,
			section: 'Snow',
			showIf: (p) => wall(p) && snowOn(p),
			hint: 'How far the snow hangs down the face below a ledge’s top edge, raggedly'
		}),
		P.float('snow_scale', 'Drifts across', 5, 0.5, 64, {
			softMax: 24,
			step: 0.01,
			section: 'Snow',
			showIf: snowOn,
			hint: 'How many drifts fit across the width: heaps and thin stretches along the ledges, or patches on a floor'
		}),
		P.float('snow_drift', 'Drift', 0.75, 0, 1, {
			step: 0.001,
			section: 'Snow',
			showIf: (p) => wall(p) && snowOn(p),
			hint: 'How much the caps heap up and thin out along the ledges (0 = even)'
		}),
		P.float('lumps', 'Lumps', 0.5, 0, 1, {
			step: 0.001,
			section: 'Snow',
			showIf: snowOn,
			hint: 'Lumps in the snow’s surface and its outline'
		}),
		P.float('sparkle', 'Sparkle', 0.5, 0, 1, {
			step: 0.001,
			section: 'Snow',
			showIf: snowOn,
			hint: 'Glossy grains in the snow that glint in the light (with Roughness and Specular › Parts)'
		}),

		P.float('icicles', 'Icicles', 0.3, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: wall,
			hint: 'Chance that a spot along an overhang (a ledge, as Drips finds them) grows an icicle (0 = none)'
		}),
		P.float('ice_gap', 'Icicle spacing', 12, 1, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			section: 'Icicles',
			showIf: icicles,
			hint: 'How far apart icicles can hang along a ledge; Icicles picks among those spots'
		}),
		P.float('ice_cluster', 'Icicle clustering', 0.35, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Gathers the icicles into runs with bare stretches of ledge between (0 = evenly spread)'
		}),
		P.float('ice_len', 'Icicle length', 50, 1, 2048, {
			softMax: 256,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Length of the longest icicles'
		}),
		P.float('ice_len_var', 'Length variation', 0.7, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Mixes short icicles in with the long ones (0 = all as long as Icicle length)'
		}),
		P.float('ice_w', 'Icicle width', 16, 1, 256, {
			softMax: 48,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Width of the widest icicles at their roots'
		}),
		P.float('ice_w_var', 'Width variation', 0.45, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Mixes thin icicles in with the wide ones (0 = all as wide as Icicle width; shorter ones are still a little thinner)'
		}),
		P.float('ice_ripple', 'Icicle ripples', 0.4, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Bulges down each icicle, where meltwater froze in rings'
		}),

		P.float('ice', 'Ice', 0.3, 0, 1, {
			step: 0.001,
			section: 'Ice',
			showIf: floorMode,
			hint: 'How much of the hollows a clear, level glaze of ice fills (0 = none)'
		}),
		P.float('pool_w', 'Fill width', 12, 0.5, 128, {
			softMax: 32,
			unit: 'px',
			step: 0.05,
			section: 'Ice',
			showIf: (p) => floorMode(p) && Number(p.ice) > 0,
			hint: 'Widest hollow the ice fills level'
		}),
		P.gradient('depth_grad', 'Depth colour', gradient('#e2f6fb', '#9edfe9', '#45b6d0', '#1f7fb4', '#175c94'), {
			section: 'Ice',
			hint: 'The ice’s colour by its depth, from thin (left) to the deepest (right): it tints what is seen through the icicles and the ice'
		}),
		P.float('refraction', 'Refraction', 14, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Ice',
			hint: 'How far the icicles’ round sections and the ice’s surface bend the view of what is behind them'
		}),
		// (A higher threshold than Drips': only clear steps carry snow and icicles, not the faint ones on a rough face.)
		// The grain of the rime's crystals (and faintly the snow's): any of Noise's noises; octaves finer than a pixel or
		// two fade out instead of aliasing.
		...noiseControlsAs('rg_', 'Rime grain', (p) => Number(p.rime) > 0 || snowOn(p), GRAIN_DEFAULTS),
		...ledgeParams({ section: 'Ledges' }, wall).map((d) => (d.key === 'ledge' ? { ...d, default: 0.35 } : d)),
		P.seed()
	],
	// Wall: the snow on each pixel from the ledges round it, and the ledges' cells (layers/ledges.ts) — each one's
	// strongest ledge pixel, and whether an icicle hangs from it.
	prepare(ctx, layer): Record<string, Texture> {
		const p = layer.params;
		const res: Record<string, Texture> = {};
		if (!wall(p)) return res;
		if (snowOn(p)) {
			const mat = ctx.material('snow:caps', SNOW_CAPS_GLSL);
			const target = ctx.scratch('snow-caps');
			ctx.run(mat, target);
			res.snow = target.texture;
		}
		if (icicles(p)) {
			const cells = ledgeGrid(ctx.width, ctx.height, Math.max(Number(p.ice_gap), 1));
			const mat = ctx.material('snow:icicle-cells', ICICLE_CELLS_GLSL, { tLedges: { value: null } });
			mat.uniforms.tLedges.value = ledgeCells(ctx, 'snow-ledges', cells);
			const target = ctx.scratch('snow-icicles', cells[0] + 1, cells[1] + 1);
			ctx.run(mat, target);
			res.ledges = target.texture;
		}
		return res;
	},
	textures: ['snow', 'ledges', 'calib'],
	cpuData: (p, ctx) => noiseCalib(p, ctx.tileable, 'rg_'),
	// A Floor starts with snow on its most exposed parts only; a Wall's caps fill its ledges.
	linkedDefaults: (p) => ({ snow: floorMode(p) ? 0.45 : 0.7 }),
	// (Worley grains compile in a variant of their own: in every Snow shader they would double its compile time.)
	shaderFeatures: (p) => [
		...(floorMode(p) ? ['SNOW_FLOOR'] : []),
		...(['worley', 'worley2', 'cells'].includes(String(p.rg_noise)) ? ['SNOW_GRAIN_CELLS'] : [])
	],
	parts: 'each part gets its own level: rime and snow matte (the snow’s sparkles glossy), ice glossy',
	defaults: {
		dif_on: true,
		h_on: true,
		h_amount: 1,
		r_on: true,
		r_src: 'parts',
		r_a: 0,
		r_b: 1,
		s_on: true,
		s_src: 'parts',
		s_a: 0,
		s_b: 1
	},
	// Added in the editor: lengths sized to the texture (as at 512 px), never under a pixel or two.
	fresh: ({ width, height }) => {
		const k = Math.sqrt(width * height) / 512;
		return {
			// (The grain's cells 3 px across, whatever the size.)
			rg_scale: Math.max(4, Math.round((170 * width) / 512)),
			shelter_r: halfPx(6 * k, 1.5),
			snow_depth: halfPx((14 * height) / 512, 3),
			snow_cling: halfPx((3 * height) / 512, 1),
			pool_w: halfPx(12 * k, 1.5),
			refraction: round1(Math.max(2, 14 * k)),
			ice_len: halfPx((50 * height) / 512, 4),
			ice_w: halfPx((16 * width) / 512, 3),
			ice_gap: halfPx((12 * width) / 512, 3),
			// (Fewer icicles on a small texture, where they would line every ledge 2 px apart.)
			icicles: Math.round(300 * Math.min(1, width / 256)) / 1000
		};
	},
	glsl:
		'#ifndef SNOW_GRAIN_CELLS\n#define NZ_LATTICE_ONLY\n#endif\n' +
		NZ_SHARED_GLSL +
		noiseFieldGlsl('rg_', true) +
		LEDGE_GRID_GLSL +
		ledgeCellGlsl('t_ledges') +
		/* glsl */ `
float fr_h(vec2 px) { return sampleT(tSurface, px).r * uDepth; }

GenOut gen(vec2 p) {
  vec2 fc = gl_FragCoord.xy;
  ivec2 ic = ivec2(fc);
  float h0 = fr_h(fc);

  // Shelter and exposure, as Mask area finds crevices and high spots (surfaceMask.ts): in each of 8 directions the
  // steepest rise out to 3× Shelter radius and the steepest fall within about it; each opposite pair counts twice the
  // lesser plus half the difference. One flat loop over all 48 samples; their mean is the local level.
  float reach = 3.0 * max(u_shelter_r, 0.5);
  float st = 0.1;
  float up = 0.0, dn = 0.0, hMean = 0.0, hNear = 0.0, hWide = 0.0;
  vec4 u4 = vec4(0.0), d4 = vec4(0.0), u4b = vec4(0.0), d4b = vec4(0.0);
  for (int j = 0; j < 48 * UNI_1; j++) {
    int dir = j / 6, k = j - dir * 6;
    float a = 0.7853982 * float(dir);
    float dist = reach * exp2(float(k) - 5.0);
    float hh = fr_h(fc + vec2(cos(a), sin(a)) * dist);
    hMean += hh;
    hNear += k <= 3 ? hh : 0.0;
    hWide += k <= 4 ? hh : 0.0;
    float dh = (hh - h0) / dist;
    up = k == 0 ? dh : max(up, dh);
    float fd = -dh * clamp(1.25 - dist / max(u_shelter_r, 0.5), 0.0, 1.0);
    dn = k == 0 ? fd : max(dn, fd);
    if (k == 5) {
      vec4 sel = vec4(equal(ivec4(dir & 3), ivec4(0, 1, 2, 3)));
      if (dir < 4) { u4 += sel * up; d4 += sel * dn; } else { u4b += sel * up; d4b += sel * dn; }
    }
  }
  float crev = dot(clamp((2.0 * min(u4, u4b) + 0.5 * abs(u4 - u4b)) / st, 0.0, 1.0), vec4(0.25));
  float high = dot(clamp((2.0 * min(d4, d4b) + 0.5 * abs(d4 - d4b)) / st, 0.0, 1.0), vec4(0.25));
  // (px above the local level)
  float hRel = h0 - hMean / 48.0;
  // (The same of the mean within a quarter of the reach: the surface smoothed over its joints, so a narrow joint between
  // raised parts counts as high as they, and a domed stone's crown highest.)
  float hSm = hNear / 32.0;
  float hRelN = hSm - hMean / 48.0;

  // Two fBms, 4 octaves each, in one flat loop: the rime's patches and the snow's drifts.
  vec2 rc = cellsFor(u_rime_scale, 1.0);
  vec2 sc = cellsFor(u_snow_scale, 1.0);
  vec2 nSum = vec2(0.0), nNorm = vec2(0.0);
  for (int e = 0; e < 8 * UNI_1; e++) {
    int j = e / 4, o = e - 4 * j;
    vec2 cells = j == 0 ? rc : sc;
    float f = exp2(float(o));
    float v = perlinNoise(p / uRes * cells * f, uTile ? periodOf(cells) * (1 << o) : NO_PERIOD, uSeed + (j == 0 ? 11.0 : 23.0) + float(o) * 31.0);
    vec2 w = vec2(j == 0 ? 1.0 : 0.0, j == 1 ? 1.0 : 0.0) / f;
    nSum += v * w;
    nNorm += w;
  }
  vec2 nn = clamp((nSum / nNorm - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  float rn = nn.x, sn = nn.y;
  // The rime's grain (Rime grain: Noise's controls, band-limited, so its octaves under a pixel or two fade out instead
  // of aliasing); the snow's lumps (half a cap deep, or a few Snow heights).
  float gRnd;
  float gr = nz_field(p, uSeed + 51.0, gRnd);
#ifdef SNOW_FLOOR
  float lumpW = max(4.0 * u_snow_height + 2.0, 3.0);
#else
  float lumpW = max(0.5 * u_snow_depth, 3.0);
#endif
  vec2 lc = cellsFor(uRes.x / lumpW, 1.0);
  float lump = clamp((perlinNoise(p / uRes * lc, periodOf(lc), uSeed + 57.0) - 0.5) * 1.6 + 0.5, 0.0, 1.0);

  // The layers, laid over one another (premultiplied, linear): colour, coverage, Roughness and Specular › Parts levels,
  // and the share of the colour that is transmitted light.
  vec3 bg = seenThrough(fc, vec2(0.0));
  vec3 P = vec3(0.0);
  float A = 0.0, Lr = 0.0, Ls = 0.0, Tr = 0.0;

  // Rime: a grainy white veil on the exposed faces, thicker in patches, the crevices bare (Shelter); edges and high spots
  // catch most.
  float expo = clamp(1.0 - u_shelter * smoothstep(0.1, 0.55, crev) + 0.6 * high, 0.0, 1.0);
  float dens = u_rime * expo;
  // (The patches' outline feathered by the grain; inside, a veil the grain thickens and thins.)
  // Crystals: the grain's highs clustered into flecks over a thinner veil; the brightest of them sparkle (antialiased
  // over the grain's screen-space change).
  float fk = 0.5 - 0.2 * high + 0.15 * (0.5 - rn);
  float fleck = smoothstep(fk, fk + 0.3, gr);
  float rv = rn + 0.3 * (gr - 0.5);
  float rimeA = u_rime > 0.0 ? smoothstep(-0.2, 0.2, rv - mix(1.25, -0.3, dens)) * step(1e-3, dens) * (0.5 + 0.45 * mix(gr, fleck, 0.7)) : 0.0;
  float spark = clamp((gr - 0.8) / max(fwidth(gr), 0.02) + 0.5, 0.0, 1.0);
  vec3 rimeC = u_rime_col * (0.88 + 0.12 * fleck + 0.08 * high + 0.12 * spark);
  P = rimeC * rimeA;
  A = rimeA;
  Lr = 0.85 * rimeA;
  Ls = 0.35 * rimeA;

  float snowA = 0.0, snowT = 0.0, iceA = 0.0, iceH = 0.0;
  // (Icicles: the front one's dome, its height px, core, the round section's slope; and their coverage.)
  float iCov = 0.0, iDome = 0.0, iBest = 0.0, iCore = 0.0, iH = 0.0, iC = 0.0, iF = 0.0, iWid = 0.0, iVis = 1.0;
  vec2 iG = vec2(0.0), iSrc = vec2(0.0);
#ifdef SNOW_FLOOR
  // Snow on the most exposed parts: what stands above the local level, judged on the surface smoothed over its joints
  // (crowns first, joints bridged), in drifts (Drifts across). It thickens in from its edge to Snow height, filling the
  // joints under it up to the smoothed level.
  if (u_snow > 0.0) {
    // (Judged half on a still wider level, so a drift's edge crosses the joints instead of following them.)
    float fe = smoothstep(-0.5, 0.8, 0.5 * hRelN + 0.5 * (hWide / 40.0 - hMean / 48.0));
    float m = 0.5 * fe + 0.5 * sn + u_lumps * 0.12 * (lump - 0.5) - mix(0.85, -0.05, u_snow);
    snowA = clamp(m / max(2.0 * fwidth(m), 1e-3) + 0.5, 0.0, 1.0);
    // A blanket: its top the smoothed surface (crowns showing through only a little) plus its depth, never thinner than a
    // quarter of that over a crown.
    float sd = u_snow_height * smoothstep(0.0, 0.18, m) * (1.0 + u_lumps * (lump - 0.5));
    snowT = max(hSm + 0.3 * max(h0 - hSm, 0.0) + sd - h0, 0.25 * sd);
  }
  // Ice in the hollows, never under the snow: where the relief lies low, deep in a hollow or a crevice (and the drifts'
  // noise is low), a glaze that fills it level — its top the mean of two rings round the pixel (Fill width and half of
  // it) raised towards their highest, more so as Ice rises, never above that — and coats the rest thinly. Clear, tinted
  // only by the thin end of Depth colour, milky towards its edges.
  if (u_ice > 0.0) {
    // (fillLevel, GLSL_TRANSPARENCY: the rings' level and its slope, both smooth — the ice's top follows the relief where
    // the glaze only coats it and kinks along every joint, so its slope is taken from the level.)
    vec3 lv = fillLevel(fc, u_pool_w, 2, 0.5 + 0.45 * u_ice, 0.5 / max(uDepth, 1e-3)) * uDepth;
    float level = lv.x;
    float lift = max(level - h0, 0.0);
    float low = clamp(0.4 - 0.3 * hRel + 0.5 * smoothstep(0.05, 0.8, lift) + 0.35 * smoothstep(0.05, 0.5, crev), 0.0, 1.0);
    float iv = 0.35 * (1.0 - sn) + 0.65 * low;
    float mi = iv - mix(0.85, 0.0, u_ice);
    iceA = clamp(mi / max(fwidth(mi), 1e-3) + 0.5, 0.0, 1.0) * (1.0 - snowA);
    // (A glaze 0.3 px thick at least.)
    float th = max(lift, 0.3);
    // (Its normal from the level's slope — a screen-space slope of its top would scatter the view in 2 × 2 steps along
    // the joints. A level glaze bends the view less than an icicle.)
    vec3 nIce = slopeNormal(lv.yz);
    vec3 seen = seenThrough(fc, lensShift(nIce, 0.3 * u_refraction));
    vec3 dcI = srgbToLinear(gradientLookup(u_depth_grad_stops, u_depth_grad_count, clamp(0.1 + 0.2 * th, 0.0, 1.0)));
    float milk = clamp(0.1 * smoothstep(0.3, 0.8, rn) + 0.5 * (1.0 - smoothstep(0.0, 0.1, mi)) - 0.2 * smoothstep(0.5, 2.0, th), 0.0, 1.0);
    vec3 iceC = mix(absorbTint(seen, dcI, 0.45), u_snow_col * mix(vec3(1.0), dcI, 0.4), 0.6 * milk);
    // (A faint sheen: a glaze reflects the sky a little, so it reads as a surface of its own.)
    iceC = mix(iceC, u_snow_col * mix(vec3(1.0), dcI, 0.5), 0.12);
    iceC = mix(iceC, u_snow_col, rimFresnel(grazing(nIce), 0.8));
    iceH = th * iceA;
    P = iceC * iceA + P * (1.0 - iceA);
    A = iceA + A * (1.0 - iceA);
    Lr = mix(0.05, 0.35, milk) * iceA + Lr * (1.0 - iceA);
    Ls = 0.9 * iceA + Ls * (1.0 - iceA);
    Tr = 0.6 * (1.0 - milk) * iceA + Tr * (1.0 - iceA);
  }
#else
  // Snow caps on the ledges' tops (prepare's pass: the snow's thickness here, px, from the ledges round it), their ends
  // rounded off: along the row, the distance to where the cap runs out on either side (a crossing found among taps half
  // a cap deep), and the cap thinned over that distance as a quarter ellipse.
  if (u_snow > 0.0) {
    float T0 = fetchT(t_snow, ic).r;
    float Wd = max(0.5 * u_snow_depth * u_snow, 2.0);
    float spc = Wd / 6.0;
    // (Tb: the thickness smoothed along the row by the nearest taps — each column finds its cap on its own, and over rough
    // relief neighbouring columns jump.)
    float deR = Wd, deL = Wd, prev = T0, Tb = 0.4 * T0;
    bool found = false;
    for (int e = 0; e < 12 * UNI_1; e++) {
      int j = e % 6;
      if (j == 0) { prev = T0; found = false; }
      float side = e < 6 ? 1.0 : -1.0;
      float Tj = sampleT(t_snow, fc + vec2(side * float(j + 1) * spc, 0.0)).r;
      Tb += j < 2 ? 0.15 * Tj : 0.0;
      if (!found && Tj < 0.15) {
        found = true;
        float dj = (float(j) + clamp((prev - 0.15) / max(prev - Tj, 1e-3), 0.0, 1.0)) * spc;
        if (e < 6) deR = dj; else deL = dj;
      }
      prev = Tj;
    }
    // (The ends bite harder near them; a short run — a chip's sliver, a vertical joint — holds none.)
    float ends = sqrt(smoothstep(0.0, 1.0, min(deL, deR) / Wd)) * smoothstep(0.6 * Wd, 1.4 * Wd, deL + deR);
    snowT = Tb * ends * (1.0 + u_lumps * 0.9 * (lump - 0.5));
    float m = snowT - 0.3;
    snowA = clamp(m / max(fwidth(snowT), 0.05) + 0.5, 0.0, 1.0);
  }
  // Icicles hang from the ledges in the relief below, as Drips' trails do: the ledge cells (prepare: each Icicle
  // spacing cell's strongest ledge pixel, user px, and whether it grows one — by the chance Icicles × how much its drop
  // counts as a ledge × the clustering). Per pixel the cells round its column, from its own row up as far as an icicle
  // reaches. The front one (the highest dome) gives the shape; the coverage is all of them.
  if (u_icicles > 0.0) {
    vec2 cellsL = ledgeGrid(max(u_ice_gap, 1.0));
    vec2 csL = uRes / cellsL;
    vec2 pu = vec2(p.x, uRes.y - p.y);
    ivec2 lc0 = ivec2(floor(pu / csL));
    int rx = clamp(int(ceil(0.8 * u_ice_w / csL.x)), 1, 3);
    int nxc = 2 * rx + 1;
    int upc = clamp(int(ceil((u_ice_len + u_ice_w) / csL.y)), 1, 40);
    for (int e = 0; e < nxc * (upc + 1) * UNI_1; e++) {
      ivec2 l = lc0 + ivec2(e % nxc - rx, -(e / nxc));
      ivec2 lw;
      vec4 b = ledgeCell(l, cellsL, lw);
      vec2 src = b.xy;
      vec4 h = vec4(hash3I(lw, uSeed + 61.0), hashI(lw, uSeed + 67.0));
      // (b.w: the longest it may hang before the next ledge below; 0: none grows here.)
      float len = min(u_ice_len * (1.0 - u_ice_len_var * (1.0 - h.x)), b.w);
      // (Shorter ones are thinner.)
      float wid = max(u_ice_w * (1.0 - u_ice_w_var * h.y) * mix(0.6, 1.0, h.x), 2.0);
      // px below its root (user y is down).
      float q = pu.y - src.y;
      // (w: whether it grows one; 0 outside an untiled texture.)
      if (b.w > 1.0 && len > 1.0 && q > -0.5 * wid && q < len + wid) {
        float f = clamp(q / len, 0.0, 1.0);
        float dx = pu.x - src.x - (h.w - 0.5) * 0.8 * wid * f * f;
        // Tapering to a drop at its tip, with rings of bulges down it; rounded over at its root.
        float rb = max(0.08 * wid, 0.6);
        float qt = max(len - rb, 0.0);
        float rT = max(rb, 0.5 * wid * pow(1.0 - qt / len, 0.9));
        // (The rings' spacing its own, and growing out of a smooth root.)
        float ring = (0.6 + 0.8 * fract(h.z * 7.3)) * (0.8 * wid + 3.0);
        float hw = 0.5 * wid * pow(1.0 - f, 0.9)
                 * (1.0 + u_ice_ripple * 0.45 * smoothstep(0.0, 0.25, f) * sin(q * TAU / ring + 6.0 * h.w) * (0.7 + 0.3 * sin(q * 1.7 / ring + h.y * 9.0)));
        float r = q < qt ? max(hw, rb) : rT;
        vec2 rel = vec2(dx, q < 0.0 ? 4.0 * q : max(q - qt, 0.0)) / max(r, 0.5);
        // (Above its root it fades into the overhang, sunk under the lip, instead of ending in a cap.)
        float c = clamp(0.5 - (length(rel) - 1.0) * r, 0.0, 1.0) * smoothstep(-0.2 * wid, 0.15 * wid, q);
        float dm = sqrt(max(1.0 - dot(rel, rel), 0.0));
        // Thinner icicles are lower domes.
        float ws = clamp(r / (0.5 * u_ice_w), 0.25, 1.0);
        if (c * dm * ws > iBest) {
          iBest = c * dm * ws;
          iDome = dm * ws;
          // The round section's slope (height px per px; down the screen is −y), steep at the rims.
          iG = vec2(-rel.x, rel.y) / max(dm, 0.25);
          iCore = exp(-rel.x * rel.x / 0.04) * (1.0 - 0.6 * f) + 0.5 * exp(-q / max(0.3 * wid, 1.0)) * (q > 0.0 ? 1.0 : 0.0);
          // Cylindrical: its section a half circle as high as its radius (the slope above is that circle's), rounded over
          // at the tip. (Rising from nothing above its root, so it merges into the ledge instead of standing on it as a cap.)
          iH = r * dm * smoothstep(-0.2 * wid, 0.2 * wid, q);
          iC = c;
          iF = f;
          iWid = wid;
          iSrc = src;
        }
        iCov = max(iCov, c);
      }
    }
    // The front one's height in the relief: its axis a fifth of its root's radius under the overhang's own height at its
    // root (the highest just above it), so it grows out of the ledge, plus its round section — maxed with the relief, so
    // its rims sink into a face flush with the ledge, rock jutting out past it below hides it, and a face set back behind
    // it leaves it standing proud.
    if (iCov > 0.0) {
      vec2 rf = vec2(iSrc.x, uRes.y - iSrc.y);
      float hRoot = max(fr_h(rf + vec2(0.0, 1.0)), fr_h(rf + vec2(0.0, 3.0)));
      float top = hRoot - 0.1 * iWid + iH;
      iVis = smoothstep(-0.5, 0.5, top - h0);
      iH = max(top - h0, 0.0) * iC;
    }
  }
#endif

  // The snow: white, faintly grained, with sparse glossy grains that glint (Sparkle).
  float spk = step(1.0 - 0.06 * u_sparkle, hashI(wrapCell(ivec2(floor(p)), ivec2(uRes + 0.5)), uSeed + 71.0));
  vec3 snowC = u_snow_col * (0.93 + 0.07 * gr) * (1.0 + 0.15 * spk);
  P = snowC * snowA + P * (1.0 - snowA);
  A = snowA + A * (1.0 - snowA);
  Lr = mix(0.8, 0.12, spk) * snowA + Lr * (1.0 - snowA);
  Ls = mix(0.45, 1.0, spk) * snowA + Ls * (1.0 - snowA);
  Tr *= 1.0 - snowA;

  // An icicle in front: thin, clear ice — what is behind it seen through its round section (and the rime and snow on
  // it), tinted a little by its own depth, a narrow milky core and rims that reflect at grazing angles. Its highlights
  // are the lighting's: its round section is in the height, and it is glossy (Roughness and Specular › Parts).
  float onI = clamp(iCov, 0.0, 1.0) * iVis;
  vec3 nI = slopeNormal(iG);
  if (onI > 0.0) {
    vec3 behind = seenThrough(fc, lensShift(nI, 0.5 * u_refraction)) * (1.0 - A) + P;
    vec3 di = srgbToLinear(gradientLookup(u_depth_grad_stops, u_depth_grad_count, 0.05 + 0.2 * iDome));
    // (Milky over its upper part, clear only towards the tip, and a thin one milky all along: too fine to show what is
    // behind it.)
    float iMilk = clamp(max(0.7 * (1.0 - smoothstep(0.15, 0.6, iF)), 0.55 * iCore) + 0.6 * (1.0 - smoothstep(3.0, 8.0, iWid)), 0.0, 0.9);
    vec3 ci = mix(absorbTint(behind, di, 0.4), u_snow_col * mix(vec3(1.0), di, 0.25), iMilk);
    float gz = grazing(nI);
    ci = mix(ci, u_snow_col, rimFresnel(gz, 0.3));
    P = ci * onI + P * (1.0 - onI);
    A = onI + A * (1.0 - onI);
    Lr = mix(0.06, 0.5, iCore) * onI + Lr * (1.0 - onI);
    Ls = 0.8 * onI + Ls * (1.0 - onI);
    Tr = 0.6 * (1.0 - 0.6 * iCore) * onI + Tr * (1.0 - onI);
  }

  // Height (px over what is below): the snow's thickness, the ice's fill, the icicles' domes; the rime adds none.
  float hpx = snowT * snowA + iceH + iH;
  int ok = u_output;
  float val = ok == 1 ? rimeA : ok == 2 ? snowA : ok == 3 ? max(iceA, onI) : A;
  GenOut g = genOutSmooth(val, val, 0.5, 0.0);
  if (ok == 0) {
    float a = max(A, 1e-4);
    gGenRgb = linearToSrgb(clamp(P / a, 0.0, 1.0));
    gGenTransmit = Tr / a;
    // Its own height, in the surface's units (Height › Amount scales it: 1 = as built).
    g.height = hpx / max(uDepth, 1e-3);
  }
  // Roughness and Specular › Parts.
  gGenLevel = vec4(Lr / max(A, 1e-4), Ls / max(A, 1e-4), -1.0, -1.0);
  return g;
}
`
};
