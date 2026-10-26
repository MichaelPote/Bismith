// Rock: fractured, bedded stone (docs/features/fr8.18-rock.md). Blocks lie in strata — courses along the bedding, split
// by joints across it — on a doubly sheared lattice (any bedding and cross-joint angle stays seamless). Each block is a
// mesa: its own height, a random tilt, a dip across the bedding (ledges), a rounding (dome, ridge or hexagonal prism),
// and sides (scarps) that fall away from its border at a fixed slope, so a higher block drapes over its lower
// neighbours: plateaus, ledges and shelves instead of cliffs everywhere. Finer generations of blocks (facets) are added
// on top at falling strength: chipped, crumpled faces. The surface is the upper envelope of the mesas, with weathered
// shoulders, rills and laminae; the creases where two meet are the joints, which can open into cracks, and the blocks
// between them go to the mask it writes. Scarps and crevices are outputs of their own, for paint.

import { P, gradient, type ParamValues } from '@/core/params';
import { PX_SCALE_PARAM, roughnessParams } from '../commonParams';
import { cellsFor, f32, imod } from '../derivedMath';
import type { LayerCanvas, LayerDef } from '../types';
import { ORG_GLSL } from './organicShared';

// Styles: the shape settings of hand-authored recreations (docs/features/fr8.18-rock.md, the settings table), where
// they differ from the defaults. Block size, facet levels, Height and the paint stay as they are; params a style
// doesn't name go back to their defaults. (Columns: no facets — the recreation had one level.)
const STYLES: Record<string, ParamValues> = {
	fractured: {
		angle: -60,
		fold: 0,
		elong: 1.15,
		bedding: 0.6,
		jitter: 1,
		merge: 0.45,
		size_var: 0.9,
		tilt: 1,
		lean: 0.6,
		weather: 0.5,
		facets: 0.35,
		zones: 0.8,
		steps: 0.8,
		joint: 0
	},
	ledges: {
		angle: 0,
		elong: 1.4,
		bedding: 0.3,
		merge: 0.6,
		size_var: 0.7,
		fold: 0,
		coherence: 0.2,
		tilt: 0.15,
		scarp: 2,
		weather: 2,
		lean: -0.6,
		steps: 0,
		bed_relief: 0.8,
		facets: 0.8,
		zones: 0.3,
		rough: 0.02,
		rough_scale: 3,
		joint: 0.5,
		joint_open: 0.12,
		joint_cross: 2,
		joint_var: 0.6,
		joint_depth: 0.15
	},
	flakes: {
		angle: -25,
		cross: 25,
		elong: 2.5,
		bedding: 0.3,
		jitter: 1,
		merge: 0,
		size_var: 0.5,
		fold: 1.5,
		heights: 1.2,
		coherence: 0.4,
		dip: 0.2,
		scarp: 5,
		weather: 0,
		lean: -0.3,
		steps: 1,
		bed_relief: 0.8,
		zones: 0.6,
		rough: 0.05,
		joint: 0,
		joint_open: 1,
		joint_cross: 1,
		joint_var: 0.6,
		joint_depth: 0.6
	},
	slate: {
		angle: -20,
		elong: 2,
		merge: 0,
		warp: 0.3,
		jag: 0.6,
		fold: 1.5,
		fold_scale: 1,
		heights: 0.5,
		coherence: 0.2,
		tilt: 0.4,
		dip: 0.2,
		weather: 0.3,
		lean: 0.8,
		steps: 0,
		facets: 0.3,
		zones: 0,
		rough: 0.25,
		rough_scale: 3,
		joint: 2.5,
		joint_open: 1,
		joint_cross: 0.3,
		joint_facets: 0.2,
		joint_var: 1,
		joint_depth: 0.8,
		fractures: 0.5,
		frac_angle: -60
	},
	columns: {
		angle: 90,
		cross: 20,
		elong: 2.5,
		bedding: 0.7,
		jitter: 1,
		merge: 0,
		size_var: 0.4,
		warp: 0.03,
		jag: 0.1,
		fold: 0,
		heights: 0.8,
		coherence: 0,
		tilt: 0.1,
		pitch: 1,
		bulge: 1,
		crest: 'hex',
		scarp: 0.8,
		weather: 0,
		lean: -0.3,
		steps: 0,
		bed_relief: 1.5,
		zones: 0,
		rough: 0.05,
		rough_scale: 3,
		joint: 0,
		joint_open: 1,
		joint_cross: 1,
		joint_var: 0.6,
		joint_depth: 0.6,
		facets: 0
	},
	rubble: {
		angle: 0,
		elong: 1.8,
		bedding: 0.9,
		merge: 0,
		size_var: 0.5,
		warp: 0.2,
		jag: 0.4,
		fold: 0,
		heights: 0.4,
		proud: 0.4,
		coherence: 0.2,
		tilt: 0.4,
		dip: 0.1,
		bulge: 0.3,
		scarp: 2,
		weather: 3,
		corner: 2,
		steps: 0,
		facets: 0.3,
		zones: 0.5,
		rough: 0.1,
		rough_scale: 1.5,
		joint: 1.5,
		joint_open: 1,
		joint_cross: 1,
		joint_facets: 0.3,
		facet_break: 0.6,
		joint_var: 0.5,
		joint_depth: 0.6
	},
	cobbles: {
		angle: 0,
		elong: 1.3,
		bedding: 0.2,
		jitter: 1,
		merge: 0,
		warp: 0.2,
		fold: 0,
		heights: 0.4,
		coherence: 0.2,
		tilt: 0.3,
		bulge: 0.9,
		scarp: 2,
		weather: 2,
		corner: 3,
		lean: 0,
		steps: 0,
		facets: 0.2,
		zones: 0.4,
		rough: 0.05,
		joint: 2,
		joint_open: 1,
		joint_cross: 1,
		joint_var: 0.5,
		joint_depth: 0.8
	}
};
const STYLE_KEYS = [...new Set(Object.values(STYLES).flatMap((s) => Object.keys(s)))];
// What a style puts back before its own settings: every style key's default (built on first use, from the params).
let styleReset: ParamValues | undefined;
const STYLE_RESET = () =>
	(styleReset ??= Object.fromEntries(STYLE_KEYS.map((k) => [k, rockLayer.params.find((d) => d.key === k)!.default])));

// The relief's colour ramp (its default, and what switching back to it restores).
const reliefGrad = () => gradient('#3b3631', '#7d746a', '#a69c90');

const rad = (deg: number) => f32(deg * f32(Math.PI / 180));
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
// To the nearest whole number, ties down: snapped counts are often exact halves (ratios of whole numbers). (Worked out
// here, a tie rounds one way on every backend; in the shader it went by the GPU's last bit, differently on D3D and GL.)
const rkRound = (x: number) => Math.floor(f32(x + f32(0.499)));

/**
 * Hermite basis of the lattice generated by (a, ks) and (−kU, nv), a > 0: (g, B, C) — u wraps every g cells shifting
 * the rows by B, v every C rows (rk_wrap reduces a cell by it). Extended Euclid on a and −kU.
 */
function rockBasis(a: number, ks: number, kU: number, nv: number): number[] {
	if (kU === 0) return [a, ks, nv];
	let [r0, r1, s0, s1, t0, t1] = [a, -kU, 1, 0, 0, 1];
	while (r1 !== 0) {
		const q = Math.trunc(r0 / r1);
		[r0, r1, s0, s1, t0, t1] = [r1, r0 - q * r1, s1, s0 - q * s1, t1, t0 - q * t1];
	}
	if (r0 < 0) [r0, s0, t0] = [-r0, -s0, -t0];
	// s0 a + t0 (−kU) = g: (g, s0 ks + t0 nv) is in the lattice; so is (0, (a nv + ks kU) / g).
	const C = Math.max(Math.abs(Math.trunc((a * nv + ks * kU) / r0)), 1);
	return [r0, imod(s0 * ks + t0 * nv, C), C];
}

/**
 * Rock's uniform-only work (its derived uniforms): the strata frame and its lattice on the torus, the long fractures'
 * direction and lanes, and the noises' and details' counts — the same at every pixel, so the CPU works them out once.
 */
export function rockDerived(p: ParamValues, c: LayerCanvas) {
	const tile = c.tileable;
	const n = (k: string) => Number(p[k]);
	const T = Math.max(n('size'), 1);
	const pxs = Math.max(n('px_scale'), 1);
	const elong = n('elong');

	// Strata frame: within 45° of horizontal, u = x / W along the bedding and v = (y + t x) / H across it (a shear: rows
	// keep whole cell counts per tile, so any angle tiles once t is snapped). Steeper bedding turns the frame 90°.
	const ang = clamp(n('angle'), -90, 90);
	const vert = Math.abs(ang) > 45;
	const [sx, sy] = vert ? [c.height, c.width] : [c.width, c.height];
	const a = rad(vert ? ang - Math.sign(ang) * 90 : ang);
	let H = f32(T / f32(Math.cos(a)));
	const nv0 = f32(sy / H);
	let nv = tile ? Math.max(1, rkRound(nv0)) : nv0;
	H = f32(sy / nv);
	let ks = f32(f32(sx * f32(Math.tan(a))) / H);
	if (tile) ks = rkRound(ks);
	// Distinct beds on the torus (gcd of the shear and the bed count; all of them without a shear).
	// Stagger alternates the rows, so it wants an even count of distinct beds (an odd one leaves a fault every gR rows).
	if (tile && ks === 0 && n('stagger') > 0 && imod(nv, 2) === 1) {
		// (Towards the unsnapped count, by a margin.)
		nv += nv < 1.5 || nv0 > nv + 0.01 ? 1 : -1;
		H = f32(sy / nv);
	}
	let bedsG = Math.trunc(nv + 0.5);
	let bS = 0;
	if (tile && ks !== 0) {
		// On the torus a bed sheared by ks rows across the tile joins bed j + ks, so only gcd(ks, nv) beds are distinct — at
		// 1, one bed spirals through the whole tile and per-bed colour, bed relief and row thickness vanish. Nudge the bed
		// count (thickness, ±2) and the shear (angle, ±1) to the nearby pair with the most distinct beds (up to 6), preferring
		// to change the thickness. Extended: sa |k2| + t n2 = gcd, for the merge domain's basis (bS, below).
		let bestS = -1e9;
		let best = [nv, ks];
		for (let i = 0; i < 15; i++) {
			const n2 = nv + (i % 5) - 2;
			const k2 = ks + Math.floor(i / 5) - 1;
			if (n2 < 1 || k2 === 0 || Math.sign(k2) !== Math.sign(ks)) continue;
			let [ga, gb, sa, sb] = [Math.abs(k2), n2, 1, 0];
			while (gb !== 0) {
				const q = Math.trunc(ga / gb);
				[ga, gb, sa, sb] = [gb, ga - q * gb, sb, sa - q * sb];
			}
			const sc = f32(
				f32(f32(Math.min(Math.max(ga, 1), 6) - f32(0.4 * Math.abs(n2 - nv))) - 1.5 * Math.abs(k2 - ks)) +
					(n('stagger') > 0 && ga % 2 === 0 ? 2 : 0)
			);
			if (sc > bestS) {
				bestS = sc;
				best = [n2, k2];
				bedsG = Math.max(ga, 1);
				bS = k2 < 0 ? -sa : sa;
			}
		}
		[nv, ks] = best;
		H = f32(sy / nv);
	}
	const t = f32(f32(ks * H) / sx);
	// Cross joints run along (s, 1) in the frame: u = (q.x − s q.y) / W. Square to the strata is s = t; the lean turns
	// them from there. A block is W √(1 + t²) / (1 + s t) long along the bedding: W is set so that length is the elongation
	// × the thickness. When tiling, s is then snapped so u moves a whole kU cells over the tile's height.
	let s = f32(Math.tan(clamp(f32(f32(Math.atan(t)) + rad(n('cross'))), -1.4, 1.4)));
	let W = f32(
		f32(f32(T * Math.max(elong, 0.2)) * Math.max(f32(1 + f32(s * t)), 0.1)) / f32(Math.sqrt(f32(1 + f32(t * t))))
	);
	const nu = tile ? Math.max(1, rkRound(f32(sx / W))) : f32(sx / W);
	W = f32(sx / nu);
	const kU = tile ? rkRound(f32(f32(s * sy) / W)) : 0;
	if (tile) s = f32(f32(kU * W) / sy);

	// The lattice on the torus: the tile's two periods move the cells by (nu, ks) and (−kU, nv) (rockBasis). Merged groups
	// are 2 × 2 cells of it reduced to one domain, whole groups only. rk_wrap's domain is gcd(nu, kU) cells wide — one when
	// they are coprime (as at the defaults), and then no group is whole; reduced by the rows first (the transposed
	// lattice's basis, from the bed search's extended Euclid: bS ks + t nv = gR) it is gcd(ks, nv) rows high. Merged
	// groups use whichever holds more.
	const wrap0 = tile ? rockBasis(nu, ks, kU, nv) : [1, 1, 1];
	let wrapT = [1, 1, 1];
	let dimM = [wrap0[0], wrap0[2]];
	let mT = false;
	// (Merging: blocks only — not with a ridge or prism crest.)
	if (tile && n('merge') > 0 && !(p.crest !== 'dome' && n('bulge') > 0)) {
		wrapT =
			ks === 0
				? [nv, -kU, nu]
				: [
						bedsG,
						bS * nu - Math.trunc((bedsG - bS * ks) / nv) * kU,
						Math.max(Math.trunc(Math.abs(nu * nv + kU * ks) / bedsG), 1)
					];
		const dT = [wrapT[2], wrapT[0]];
		const whole = (d: number[]) => ((d[0] - imod(d[0], 2)) / d[0]) * ((d[1] - imod(d[1], 2)) / d[1]);
		mT = whole(dT) > whole(dimM);
		if (mT) dimM = dT;
	}

	// Long fractures: when tiling, the direction is snapped to a primitive lattice vector v = (a W, b H) (a, b coprime) —
	// the shortest, |a| ≤ 6, |b| ≤ 3, within a few degrees — and completed to a basis with u = (c W, d H), ad − bc = 1 (see
	// rk_fractures).
	const fa = rad(n('frac_angle'));
	let fdir = [f32(Math.cos(fa)), -f32(Math.sin(fa))];
	let lane = f32(2.2 * T);
	let segL = f32(4.5 * T);
	let nL = 1e6;
	let nS = 1e6;
	let slide = 0;
	if (tile) {
		let ab = [1, 0];
		let bestE = 1e9;
		for (let i = 0; i < 49; i++) {
			const [ia, ib] = [i % 7, Math.floor(i / 7) - 3];
			const bAbs = Math.abs(ib);
			const skip =
				(ia === 0 && ib <= 0) ||
				(ia % 2 === 0 && bAbs % 2 === 0) ||
				(ia % 3 === 0 && bAbs % 3 === 0) ||
				(ia % 5 === 0 && ib === 0);
			if (skip) continue;
			const len = Math.hypot(ia * c.width, ib * c.height);
			const e = 1 - Math.abs((ia * c.width * fdir[0] + ib * c.height * fdir[1]) / len) + (0.0004 * len) / c.width;
			if (e < bestE) [bestE, ab] = [e, [ia, ib]];
		}
		const [ia, ib] = ab;
		const v = [ia * c.width, ib * c.height];
		const Lp = Math.hypot(v[0], v[1]);
		fdir = [v[0] / Lp, v[1] / Lp];
		// u = (c, d) with a d − b c = 1.
		let cd = [-ib, 0];
		for (let k = -6; k <= 6 && ia !== 0; k++)
			if (imod(1 + ib * k, ia) === 0) {
				cd = [k, (1 + ib * k) / ia];
				break;
			}
		slide = cd[0] * c.width * fdir[0] + cd[1] * c.height * fdir[1];
		const across = (c.width * c.height) / Lp;
		nL = Math.max(1, rkRound(across / lane));
		lane = across / nL;
		nS = Math.max(1, rkRound(Lp / segL));
		segL = Lp / nS;
	}

	// The noises' cell counts (cellsFor), by kind: the strata warp, the edge jaggies, the roughness, the rills' meander, a
	// breakup (laminae, crevice patches, pit clusters) about two blocks across, the fracture zones (and the height swell),
	// the folds, the facet cracks' breakup; then the pits' cells. (The folds' counts come from their scale itself, halves
	// rounded up. Sharp folds get down to a quarter of the cells down the texture: the noise varies mostly across it, so
	// the chevrons' hinges stack on near-vertical lines.)
	const el1 = Math.max(elong, 1);
	const cellPx = [
		1.5 * T * el1,
		Math.max(0.2 * T, 1.5 * pxs),
		Math.max(n('rough_scale'), 1),
		Math.max(n('rill_len'), 2)
	];
	cellPx.push(2 * T * el1, 3 * T * el1, 0, 0.5 * T, 4 * Math.max(n('pit_size'), 0.5));
	const fold = [n('fold_scale'), f32((c.height / c.width) * (1 - 0.75 * n('fold_sharp'))) * n('fold_scale')];
	const nc = cellPx.flatMap((px, k) =>
		k !== 6
			? cellsFor(f32(c.width / f32(px)), 1, c)
			: fold.map((x) => (tile ? Math.max(1, Math.floor(f32(x + 0.501))) : Math.max(x, 1e-3)))
	);
	// Rills: channels across, segments down; streaks: columns ~1.5 px wide, in groups of about eight; laminae per bed;
	// the finer generations' split along the bedding (the elongation, whole).
	const count = (x: number) => (tile ? Math.max(1, rkRound(x)) : x);
	const nCol = count(c.width / (1.5 * pxs));
	return {
		frame: [H, W, s, t],
		vert: vert ? 1 : 0,
		gR: tile ? bedsG : 1 << 20,
		wrap0,
		wrapT,
		dimM: [...dimM, mT ? 1 : 0],
		frac: [fdir[0], fdir[1], lane, segL],
		frac2: [nL, nS, slide],
		nc,
		rills: [count(c.width / Math.max(n('rill_space'), 0.5)), count(c.height / Math.max(n('rill_len'), 2))],
		streaks: [nCol, count(nCol / 8)],
		split: [Math.max(1, rkRound(T / Math.max(n('lam_space'), 0.5))), Math.max(1, rkRound(elong))]
	};
}

export const rockLayer: LayerDef = {
	type: 'rock',
	label: 'Rock',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Fractured, bedded stone: Made from blocks laid in strata with random heights and tilts, sloping scarps, finer facets, joints and weathering. Makes cliffs, ledges, slate, columns and rubble, plus masks of the scarps, crevices and rain streaks to paint.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				[
					'relief',
					'Relief',
					'the rock surface: block faces, scarps, facets and cracks, as a height (and a colour by height)'
				],
				[
					'scarps',
					'Scarps',
					'1 on the scarps (the slopes running down from a block over its lower neighbours), 0 on the faces. Use it to paint the shaded, weathered faces, or dust and scree on them'
				],
				[
					'crevices',
					'Crevices',
					'1 in the creases where blocks meet (the joints and the base of every scarp), fading out over the Crevice reach. Use it for moss, dirt and damp in the cracks'
				],
				[
					'streaks',
					'Streaks',
					'rain streaks running down each block from its top edge and fading as they go. Use it for water stains, lime or rust washed down the faces'
				]
			],
			{
				hint: 'Picks what the layer outputs. Every output uses the same rock (same settings and seed) and writes its blocks into the mask'
			}
		),
		P.enum(
			'style',
			'Style',
			'default',
			[
				['default', 'Default', 'the generator’s defaults: gently folded strata of tilted blocks'],
				[
					'fractured',
					'Fractured face',
					'steep strata broken into tilted blocks of many sizes, with finer fractures (the wizard’s Rock face)'
				],
				['ledges', 'Layered ledges', 'level beds standing out as ledges with sheer undersides, a few open joints'],
				['flakes', 'Flaky strata', 'folded beds of thin plates, with every ledge a staircase of flakes'],
				['slate', 'Slate plates', 'flat plates in angled, folded beds, wide open joints and long fractures'],
				['columns', 'Columns', 'hexagonal columns with sheared, lit ends'],
				['rubble', 'Coursed rubble', 'big rounded stones in courses, partly cracked, mostly flush'],
				['cobbles', 'Cobbles', 'domed, rounded stones with open joints']
			],
			{
				uniform: false,
				hint: 'Sets the shape to a ready-made look (block size, Height and paint are kept). Anything you change afterwards stays as you set it'
			}
		),
		P.enum(
			'scarp_face',
			'Scarp facing',
			'all',
			[
				['all', 'All', 'every scarp'],
				[
					'down',
					'Below ledges',
					'only the scarps sloping down from a block onto the rock below it (down the screen): the shaded undersides'
				],
				[
					'up',
					'Above ledges',
					'only the scarps rising to the block above (up the screen): shelves where dust, scree and moss settle'
				]
			],
			{ showIf: (p) => p.output === 'scarps' }
		),
		P.float('crev_patch', 'Crevice patchiness', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.output === 'crevices',
			hint: 'Breaks the crevice mask into patches about two blocks across (0 = every crack filled, 1 = only here and there)'
		}),
		P.float('crev_reach', 'Crevice reach', 3, 0.5, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			showIf: (p) => p.output === 'crevices',
			hint: 'How far the crevice mask fades out from the crease (deeper steps reach a little further)'
		}),
		P.float('streak_len', 'Streak length', 24, 1, 512, {
			softMax: 96,
			unit: 'px',
			axis: 'y',
			step: 0.1,
			showIf: (p) => p.output === 'streaks',
			hint: 'Sets the length of the longest streaks; each one runs 40–100 % of this down from its block’s top edge'
		}),
		P.float('streak_density', 'Streak density', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.output === 'streaks',
			hint: 'How many of the narrow columns (about 1.5 px wide) get a streak, in clusters (roughly this share up to 0.5, 1 = three quarters of them)'
		}),
		P.float('angle', 'Bedding angle', -15, -90, 90, {
			uniform: false,
			step: 0.1,
			unit: '°',
			hint: 'Sets the direction the strata run, clockwise from horizontal (±90 = columns). Snapped a little when tiling so the texture stays seamless'
		}),
		P.float('cross', 'Cross-joint angle', 0, -60, 60, {
			uniform: false,
			step: 0.1,
			unit: '°',
			hint: 'Leans the joints across the bedding (0 = square to the strata, otherwise rhomboid blocks). Snapped a little (more for big blocks) when tiling so the texture stays seamless'
		}),
		P.float('size', 'Block size', 16, 2, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			hint: 'Sets how thick each block is across the bedding (course height, column width)'
		}),
		P.float('elong', 'Elongation', 1.6, 0.5, 12, {
			uniform: false,
			softMax: 6,
			step: 0.01,
			hint: 'Sets how long the blocks are along the bedding, as length ÷ thickness (1 = as long as they’re thick)'
		}),
		P.float('bedding', 'Bedding', 0.45, 0, 1, {
			step: 0.001,
			hint: 'Lines the blocks up in courses (0 = scattered any which way, 1 = straight courses)'
		}),
		P.float('jitter', 'Jitter', 0.9, 0, 1, { step: 0.001, hint: 'Varies the blocks’ lengths and positions' }),
		P.float('stagger', 'Stagger', 0, 0, 1, {
			step: 0.001,
			hint: 'Shifts every other course half a block along the bedding, like the running bond in brickwork and coursed rubble, so each block bridges a joint below it. With low Bedding the blocks turn into hexagons with slanted ends'
		}),
		P.float('merge', 'Merged blocks', 0.4, 0, 1, {
			step: 0.001,
			hint: 'How often a 2 × 2 group of blocks fuses into one big block with a single face and no joints inside, for big blocks among small ones (not for ridges and prisms)'
		}),
		P.float('size_var', 'Size variation', 0.6, 0, 1, {
			step: 0.001,
			hint: 'Makes some blocks bigger and their neighbours smaller'
		}),
		P.float('warp', 'Warp', 0.15, 0, 2, { softMax: 1, step: 0.001, hint: 'Bends the strata (in block sizes)' }),
		P.float('fold', 'Folds', 0.5, 0, 16, {
			softMax: 4,
			step: 0.01,
			hint: 'Bends the strata into broad folds, shifting them up and down by this many beds across the texture'
		}),
		P.float('fold_scale', 'Folds across', 1.5, 0.5, 16, {
			uniform: false,
			softMax: 6,
			step: 0.01,
			showIf: (p) => Number(p.fold) > 0,
			hint: 'How many folds fit across the texture width (rounded when tiling)'
		}),
		P.float('fold_sharp', 'Fold sharpness', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.fold) > 0,
			hint: 'Turns the smooth folds into chevrons, bending the strata in sharp V-shaped hinges like folded shale or flaky sandstone (0 = smooth folds)'
		}),
		P.float('jag', 'Jaggedness', 0.3, 0, 8, {
			softMax: 3,
			unit: 'px',
			step: 0.01,
			hint: 'Makes the block edges ragged, with wiggles about a fifth of a block across'
		}),

		P.float('heights', 'Height variation', 1, 0, 4, {
			softMax: 1.5,
			step: 0.001,
			section: 'Relief',
			hint: 'How much the blocks differ in height'
		}),
		P.float('bed_relief', 'Bed relief', 0, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Raises or sinks each whole bed (course, column) by a random amount, like hard beds weathering proud and soft ones receding. Gives ledges along the strata and columns of different heights'
		}),
		P.float('coherence', 'Height coherence', 0.3, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'Gives neighbouring blocks similar heights that follow broad swells across the rock, so only some joints step (ledges here and there) instead of every one'
		}),
		P.float('proud', 'Proud blocks', 1, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'How many of the blocks stand out or sink by a random height (1 = all of them); the rest sit flush with their neighbours, parted only by the joints. In most rock faces a step is the exception'
		}),
		P.float('tilt', 'Face tilt', 0.8, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Tilts each block face by a random slope'
		}),
		P.float('dip', 'Ledge dip', 0, -2, 2, {
			softMin: -1,
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Leans every block the same way across the bedding, making a saw-tooth of ledges, each with a drop along one side (below 0: flips the side)'
		}),
		P.float('pitch', 'Pitch', 0, -2, 2, {
			softMin: -1,
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Leans every block the same way along the bedding, making a saw-tooth along each course or column with all its steps facing one way. Above 0 the faces rise up the screen (columns) or to the right and the breaks face up or right, so they get lit caps under a light from the top left'
		}),
		P.float('bulge', 'Face rounding', 0, -1, 2, {
			softMin: 0,
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Rounds each block’s face (rubble, boulders, weathered columns). Below 0 scoops the faces out instead, like the shell-shaped scars where flakes have spalled off'
		}),
		P.enum(
			'crest',
			'Rounding shape',
			'dome',
			[
				['dome', 'Dome', 'rounded all round, like a pillow or a boulder'],
				[
					'ridge',
					'Ridge',
					'a crest along the block with two faces falling away from it; its ends break off in a slope from the crest'
				],
				[
					'hex',
					'Hexagonal prism',
					'a hexagonal column lying along the bedding, each turned randomly (two or three faces showing); its ends break off in a sloping plane that follows the hexagon’s outline'
				]
			],
			{
				section: 'Relief',
				showIf: (p) => Number(p.bulge) > 0,
				hint: 'Picks the shape the rounding makes. Ridges and prisms always span the whole course or column, whatever its width'
			}
		),
		P.float('scarp', 'Scarp width', 1.5, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			hint: 'How far a block’s side slopes out over a lower neighbour, per full height step (0 = sheer steps, more = sloping shelves)'
		}),
		P.float('weather', 'Weathering', 0.6, 0, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			hint: 'Rounds the blocks’ edges over this many px, inside and out, for worn, pillowy shoulders instead of fresh, sharp breaks'
		}),
		P.float('corner', 'Corner rounding', 0, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			hint: 'Rounds the blocks’ corners seen from above: each corner curves away over this width and the cracks open up where blocks meet. Good for pillows, rubble and worn cobbles'
		}),
		P.float('lean', 'Scarp lean', 0.3, -1, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'Makes the scarps slope out further below the blocks (on screen) and stand sheer above them, giving shaded shelves under every ledge and a crisp lit step on top. Below 0 flips it: sheer undersides that cast shadows, lit slopes up to the block above. Blocks only (facets don’t lean)'
		}),
		P.float('steps', 'Scarp steps', 0.6, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'Breaks each block’s scarp into a staircase of thin plates (flat treads, steep risers) instead of one slope, for flaky, shingled ledges where every edge casts a thin shadow'
		}),
		P.float('step_px', 'Scarp step width', 2, 1, 32, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			showIf: (p) => Number(p.steps) > 0,
			hint: 'How far apart the scarp’s steps are, in px (varied randomly by ±30 % per block)'
		}),
		P.int('detail', 'Facet levels', 3, 1, 3, {
			section: 'Relief',
			hint: 'How many levels of blocks to make: each extra level splits the faces into smaller facets half the size (levels under ~8 px fade out)'
		}),
		P.float('facets', 'Facet relief', 0.4, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.detail) > 1,
			hint: 'How much relief the finer facets get compared to the blocks (halved again for each further level)'
		}),
		P.float('zones', 'Fracture zones', 0.7, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.detail) > 1 || Number(p.rough) > 0,
			hint: 'Makes the facets and roughness come and go across the rock in zones a few blocks wide, so smooth, whole faces sit beside shattered, crumbly ones'
		}),
		...roughnessParams(0.04, 4).map((d) => (d.key === 'rough_scale' ? { ...d, uniform: false } : d)),

		P.float('rills', 'Rills', 0, 0, 1, {
			step: 0.001,
			section: 'Surface',
			hint: 'Carves vertical flutes like those worn by running water: rounded channels between sharp crests, always down the screen'
		}),
		P.float('rill_space', 'Rill spacing', 3, 1, 64, {
			uniform: false,
			softMax: 12,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			section: 'Surface',
			showIf: (p) => Number(p.rills) > 0
		}),
		P.float('rill_len', 'Rill length', 24, 2, 512, {
			uniform: false,
			softMax: 96,
			unit: 'px',
			axis: 'y',
			step: 0.1,
			section: 'Surface',
			showIf: (p) => Number(p.rills) > 0
		}),
		P.float('pits', 'Pits', 0, 0, 1, {
			step: 0.001,
			section: 'Surface',
			hint: 'Scatters small round pits (vugs) over the faces, but not in the crevices or on the scarps'
		}),
		P.float('pit_size', 'Pit size', 1.2, 0.5, 16, {
			softMax: 4,
			unit: 'px',
			step: 0.05,
			section: 'Surface',
			showIf: (p) => Number(p.pits) > 0,
			hint: 'Sets the radius of the biggest pits (the rest range from a quarter of it up, mostly small)'
		}),
		P.float('laminae', 'Laminae', 0, 0, 1, {
			step: 0.001,
			section: 'Surface',
			hint: 'Carves laminae, fine grooves along the bedding (the thin layers inside each bed), some deeper than others, fading in and out'
		}),
		P.float('lam_space', 'Lamina spacing', 3, 1, 64, {
			uniform: false,
			softMax: 12,
			unit: 'px',
			step: 0.05,
			section: 'Surface',
			showIf: (p) => Number(p.laminae) > 0,
			hint: 'Sets the gap between the laminae, rounded so each bed holds a whole number of them'
		}),

		P.float('joint', 'Joint width', 0.6, 0, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			section: 'Joints',
			hint: 'Opens cracks this wide along the joints between blocks (the creases where two blocks meet)'
		}),
		P.float('joint_open', 'Open joints', 0.35, 0, 1, {
			step: 0.001,
			section: 'Joints',
			showIf: (p) => Number(p.joint) > 0,
			hint: 'How many of the joints open into cracks, each along its whole length. The rest stay closed (just a step or a crease, no bevel), and the blocks either side count as one piece in the mask'
		}),
		P.float('joint_cross', 'Cross-joint width', 1.6, 0, 2, {
			step: 0.001,
			section: 'Joints',
			showIf: (p) => Number(p.joint) > 0,
			hint: 'Makes the joints across the bedding (block ends) wider or thinner than those along it (below 1: wide bedding cracks and thin cross cracks, like slate; above 1: the other way round, like columns)'
		}),
		P.float('joint_facets', 'Facet joints', 0, 0, 1, {
			step: 0.001,
			section: 'Joints',
			showIf: (p) => Number(p.joint) > 0 && Number(p.detail) > 1,
			hint: 'Cracks some of the borders between the first level of facets too, as hairlines thinner and shallower than the joints. Each border cracks along its whole length or not at all'
		}),
		P.float('facet_break', 'Facet joint breakup', 0, 0, 1, {
			step: 0.001,
			section: 'Joints',
			showIf: (p) => Number(p.joint) > 0 && Number(p.joint_facets) > 0 && Number(p.detail) > 1,
			hint: 'Makes the facet cracks fade in and out along their length (noise about half a block across), for partial hairline cracks inside the stones rather than whole straight ones'
		}),
		P.float('joint_var', 'Joint variation', 0.8, 0, 1, {
			step: 0.001,
			section: 'Joints',
			showIf: (p) => Number(p.joint) > 0,
			hint: 'Opens each joint by a random share of the width (1 = from shut to fully open), and pinches and swells it along its length (with Warp on)'
		}),
		P.float('joint_depth', 'Joint depth', 0.25, 0, 1, {
			step: 0.001,
			section: 'Joints',
			showIf: (p) => Number(p.joint) > 0 || Number(p.fractures) > 0,
			hint: 'How deep the cracks (and the long fractures) sink below the faces'
		}),
		P.float('fractures', 'Long fractures', 0, 0, 1, {
			step: 0.001,
			section: 'Joints',
			hint: 'Adds long, straight cracks (tectonic joints) that cut across many blocks at the Fracture angle, each a few blocks long'
		}),
		P.float('frac_angle', 'Fracture angle', 70, -90, 90, {
			uniform: false,
			step: 0.1,
			unit: '°',
			section: 'Joints',
			showIf: (p) => Number(p.fractures) > 0,
			hint: 'Sets the direction of the long fractures, clockwise from horizontal (each one wanders a little)'
		}),
		// Not a control: 1 px of the texture in shader px. Supersampling scales every px param by k, so this tells the shader
		// how big a texture pixel is (the facets' pixel-scale fade, streak columns, the thinnest cracks).
		PX_SCALE_PARAM,
		P.enum(
			'rnd_mode',
			'Random value',
			'block',
			[
				['block', 'Per block', 'a random value for each block'],
				[
					'bed',
					'Per bed',
					'a random value for each bed (course, column), for colour bands along the strata. Angled strata that tile repeat their beds sooner'
				],
				['mix', 'Per bed, varied', 'the bed’s value, shifted a little for each block'],
				[
					'facet',
					'Per facet',
					'a random value for each facet of the first facet level (per block for blocks without facets), for patchwork colour'
				]
			],
			{ hint: 'Picks the random value that Diffuse › Random and Colour variation read' }
		),
		P.seed()
	],
	defaults: {
		bevel: 0,
		profile: 'round',
		aa: true,
		h_on: true,
		// Deep relief: ledges cast shadows a few px long (the default Block size is 16 px).
		h_amount: 5,
		dif_on: true,
		dif_grad: reliefGrad()
	},
	// Added in the editor: blocks a little over a tenth of the texture's mean side, the relief deepening with them.
	fresh: ({ width, height }) => {
		const size = Math.round(Math.min(48, Math.max(6, Math.sqrt(width * height) * 0.12)) * 10) / 10;
		return { size, h_amount: Math.round(size * 3.2) / 10, detail: size >= 14 ? 3 : 2 };
	},
	// Relief is the height; scarps and crevices are masks for paint (their coverage is their value, so a colour lands only
	// on them): scarps darken the faces they cover, crevices fill with moss.
	linkedDefaults: (p) => ({
		...(p.output === 'scarps'
			? { h_on: false, dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#7a6a58') }
			: p.output === 'crevices'
				? { h_on: false, dif_blend: 'normal', dif_grad: gradient('#3a3a1c', '#4e5226') }
				: p.output === 'streaks'
					? { h_on: false, dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#6a5e50') }
					: { h_on: true, dif_blend: 'normal', dif_grad: reliefGrad() }),
		...STYLE_RESET(),
		...STYLES[String(p.style)]
	}),
	// Uniform-only work on the CPU (rockDerived); the params only it reads are `uniform: false`.
	derivedUniforms: {
		decl: {
			frame: 'vec4',
			vert: 'int',
			gR: 'int',
			wrap0: 'ivec3',
			wrapT: 'ivec3',
			dimM: 'ivec3',
			frac: 'vec4',
			frac2: 'vec3',
			nc: 'vec2[9]',
			rills: 'vec2',
			streaks: 'vec2',
			split: 'vec2'
		},
		compute: rockDerived
	},
	glsl:
		ORG_GLSL +
		/* glsl */ `
// Seamless key of a lattice cell. The tile's two periods move the cells by (nu, ks) and (−kU, nv): a lattice whose
// Hermite basis is (g, B), (0, C) — u wraps every g cells shifting the rows by B, v every C rows (rockBasis, on the
// CPU). rk_wrap reduces a cell by that basis: rk_wrap(c, ivec2(g, C), B).
ivec2 rk_wrap(ivec2 c, ivec2 n, int k) {
  if (!uTile) return c;
  int i = imod(c.x, n.x);
  int q = (c.x - i) / n.x;
  return ivec2(i, imod(c.y - q * k, n.y));
}

// A joint between the two highest blocks a and b, d px from their crease: (crack coverage, signed distance — negative
// on the blocks, 1 if it is open). Each joint (pair of blocks) is open with probability keep, by its own share of the
// width; a closed one doesn't part the blocks (no crack, no bevel, one piece in the mask: its distance is the caller's
// to choose). Without cracks (width 0) every crease outlines its blocks.
vec3 rk_joint(float d, ivec2 a, ivec2 b, float width, float keep, float seed) {
  if (width <= 0.0) return vec3(0.0, -d, 1.0);
  ivec2 lo = (a.x < b.x || (a.x == b.x && a.y < b.y)) ? a : b;
  ivec2 hi = lo == a ? b : a;
  vec2 hp = hash2I(lo * 7919 + hi, seed);
  if (hp.y >= keep) return vec3(0.0, -d, 0.0);
  float jw = width * (1.0 - u_joint_var * hp.x);
  // Under a pixel wide, a crack stays one pixel wide and fades with its width (a box filter): no dotted lines.
  float cut = u_aa ? org_line(d, max(jw, 1.0), 0.0) * min(jw, 1.0) : (d < 0.5 * jw ? 1.0 : 0.0);
  return vec3(cut, 0.5 * jw - d, 1.0);
}

// Distance from a point to a convex corner, from its signed distances a, b to the corner's two lines (> 0 outside) and
// the cosine c between their normals: the nearer edge where the point projects onto it, else the vertex — exact at any
// angle (|(a, b)| holds only at right angles: 22 % too far at 120°).
float rk_corner(float a, float b, float c) {
  if (a <= 0.0 && b <= 0.0) return max(a, b);
  if (a > 0.0 && b <= c * a) return a;
  if (b > 0.0 && a <= c * b) return b;
  return sqrt(max((a * a + b * b - 2.0 * c * a * b) / max(1.0 - c * c, 1e-4), 0.0));
}

// A corner rounded by kC: rk_corner of the borders moved out by kC, less kC. It fades in only where the borders really
// turn (rk_turn: normals > ~20° apart; at a T-junction the edge runs straight on).
float rk_cornerK(float a, float b, float cn, float kC) { return rk_corner(a + kC, b + kC, max(cn, 0.0)) - kC; }
float rk_turn(float cn) { return 1.0 - smoothstep(0.82, 0.96, cn); }

// valueNoise without the animation (its Phase code costs compile time here); the same values at Phase 0.
float rk_vnoise(vec2 x, ivec2 per, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hashI(imod(i, per), seed), b = hashI(imod(i + ivec2(1, 0), per), seed);
  float c = hashI(imod(i + ivec2(0, 1), per), seed), d = hashI(imod(i + ivec2(1, 1), per), seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Weathered shoulder: the drop below a block's face at signed px distance s from its border (> 0 outside), rounded over
// ±r px (C¹; r = 0 gives max(s, 0), a sharp break).
float rk_shoulder(float s, float r) {
  if (r <= 0.0) return max(s, 0.0);
  return s >= r ? s : s <= -r ? 0.0 : (s + r) * (s + r) / (4.0 * r);
}

// Row y's offset across the bedding (generation o): hashed by the row on the torus, so it repeats every gR rows.
float rk_rowOff(int y, int o, int gR) { return hashI(ivec2(imod(y, gR * (1 << o)), o), uSeed + 71.0) - 0.5; }

// Rills: parallel channels down the screen, rill_space apart (whole counts when tiling), meandering a little (rl: the
// meander noise). Each is a parabolic bowl — round-bottomed, meeting its neighbours in sharp crests — cut into segments
// about rill_len long, each segment with its own depth, fading in and out along it. How deep the relief sinks.
float rk_rills(vec2 p, float rl) {
  float nCh = d_rills.x, nSeg = d_rills.y;
  // Meander: about ±1 channel, so neighbouring rills bend together and pinch.
  float xr = p.x / uRes.x * nCh + 3.0 * (rl - 0.5);
  float ci = floor(xr), fx = xr - ci;
  int cw = wrapCell(int(ci), int(nCh));
  float yr = p.y / uRes.y * nSeg + hashI(ivec2(cw, 5), uSeed + 97.0);
  float sg = floor(yr);
  int sw = wrapCell(int(sg), int(nSeg));
  float depth = hashI(ivec2(cw, sw), uSeed + 99.0) * sin(PI * (yr - sg));
  return 0.3 * u_rills * depth * (1.0 - (2.0 * fx - 1.0) * (2.0 * fx - 1.0));
}

// Pits: one candidate per cell of 4 pit radii (whole counts when tiling), kept with the pits' chance — clustered by the
// breakup noise lb (about two blocks across) — its centre a radius in from the cell's sides so it never needs the
// neighbours: one evaluation. Sizes from a quarter to all of the radius, mostly small. A bowl half as deep as it is wide
// in true px (through the Height amount and the project's depth), only on the faces: away from the creases (dCrease px)
// and off the scarps. How deep the relief sinks.
float rk_pits(vec2 p, float lb, float scarpsAll, float dCrease, float pxs) {
  float r = max(u_pit_size, 0.5);
  vec2 pc = d_nc[8];
  vec2 cs = uRes / pc;
  ivec2 ci = ivec2(floor(p / cs));
  ivec2 cw = imod(ci, periodOf(pc));
  vec4 hp = vec4(hash3I(cw, uSeed + 211.0), hashI(cw, uSeed + 223.0));
  if (hp.z >= u_pits * 2.0 * smoothstep(0.38, 0.62, lb)) return 0.0;
  float rr = r * (0.25 + 0.75 * hp.w * hp.w);
  vec2 ctr = (vec2(ci) + 0.5) * cs + (hp.xy - 0.5) * max(cs - 2.0 * rr, 0.0);
  float d = length(p - ctr) / rr;
  float face = (1.0 - scarpsAll) * smoothstep(pxs, 3.0 * pxs, dCrease);
  return face * max(1.0 - d * d, 0.0) * 0.5 * rr / max(abs(u_h_amount) * uDepth, 0.5);
}

// Laminae: k grooves per bed (whole, so beds hold them seamlessly; fy: the position across the beds), each with its own
// depth (hashed by its index, which repeats where the beds do), fading in and out with the breakup noise lb about two
// blocks across. How deep the relief sinks.
float rk_laminae(float fy, float lb, float T, int gR, float pxs) {
  float k = d_split.x;
  float L = fy * k;
  float li = floor(L + 0.5);
  float dpx = abs(L - li) * T / k;
  float depth = 0.35 + 0.65 * hashI(ivec2(imod(int(li), int(k) * gR), 3), uSeed + 91.0);
  return 0.2 * u_laminae * depth * smoothstep(0.25, 0.75, lb) * (1.0 - smoothstep(0.25 * pxs, pxs, dpx));
}

// Long fractures' crack coverage at pw: lanes about two blocks apart across the fracture direction; each lane holds
// segments ~4.5 blocks long, present with the fractures' chance, a little off the lane's centre and turned a few degrees,
// fading out over the last fifth of each end; 0.6 × the joints' width (at least 0.6 px). When tiling, the direction is
// snapped to a primitive lattice vector v = (a W, b H) (a, b coprime) and completed to a basis with u = (c W, d H),
// ad − bc = 1 (on the CPU: rockDerived): a step along v moves Lp = |v| along the lanes (a whole number of segments), a
// step along u moves one tile-period across them (a whole number of lanes) and slide along, which each lane's segments
// are shifted back by — so the fractures repeat under both, hence under the tile's (W, 0) and (0, H).
float rk_fractures(vec2 pw, float pxs) {
  vec2 fdir = d_frac.xy;
  float lane = d_frac.z, segL = d_frac.w, nL = d_frac2.x, nS = d_frac2.y, slide = d_frac2.z;
  vec2 fn = vec2(-fdir.y, fdir.x);
  vec2 pr = vec2(dot(pw, fdir), dot(pw, fn));
  float li = floor(pr.y / lane - 0.5);
  float best = 0.0;
  for (int k = 0; k < 2 * UNI_1; k++) {
    float lk = li + float(k);
    int lwi = imod(int(lk), int(nL));
    float rep = float((int(lk) - lwi) / int(nL));
    vec2 hl = hash2I(ivec2(lwi, 0), uSeed + 151.0);
    float off = (lk + 0.5 + 0.3 * (hl.x - 0.5)) * lane;
    float sp = (pr.x - rep * slide) / segL + hl.y * 7.0;
    float si = floor(sp);
    vec2 hs = hash2I(ivec2(lwi, imod(int(si), int(nS)) + 1), uSeed + 163.0);
    if (hs.x < u_fractures) {
      float uu = sp - si;
      float ang = (hs.y - 0.5) * 0.12;
      float d = abs(pr.y - off - (uu - 0.5) * segL * ang) - 0.5 * max(u_joint, pxs) * 0.6;
      float fadeE = smoothstep(0.0, 0.2, uu) * (1.0 - smoothstep(0.8, 1.0, uu));
      best = max(best, fadeE * coverage(d, u_aa));
    }
  }
  return best;
}

// Streaks: narrow columns (~1.5 px, whole counts when tiling), each with a streak at the density's chance — clustered:
// the chance varies over groups of about eight columns — running down from the top edge of the block the pixel is in
// (dTop px above) for 40–100 % of the length, each at its own strength, strongest at the top and fading; edges softened
// by the neighbouring columns (a 1D tent filter); off the scarps.
float rk_streaks(vec2 p, float dTop, float scarpsAll, float pxs) {
  float nCol = d_streaks.x, nGrp = d_streaks.y;
  float xc = p.x / uRes.x * nCol;
  float st = 0.0;
  for (int k = -UNI_1; k <= UNI_1; k++) {
    float ck = floor(xc) + float(k);
    int cm = wrapCell(int(ck), int(nCol));
    vec3 hc = hash3I(ivec2(cm, 0), uSeed + 233.0);
    int gi = uTile ? cm * int(nGrp) / int(nCol) : int(floor(ck / 8.0));
    float grp = hashI(ivec2(gi, 1), uSeed + 239.0);
    float len = max(u_streak_len, 1.0) * (0.4 + 0.6 * hc.y);
    float sk = hc.x < u_streak_density * 2.0 * grp ? (0.4 + 0.6 * hc.z) * max(1.0 - dTop / len, 0.0) : 0.0;
    st += sk * max(1.0 - abs(xc - ck - 0.5) / 1.5, 0.0);
  }
  return clamp(st, 0.0, 1.0) * (1.0 - scarpsAll);
}

GenOut gen(vec2 p) {
  // The strata frame (rockDerived: the same at every pixel, so it comes from the CPU): steeper than 45° it turns 90°;
  // u = (q.x − s q.y) / W along the bedding, v = (q.y + t q.x) / H across it. Rows (courses, columns) get their own
  // thickness: a row's offset repeats every gR rows, which keeps it seamless where the shear carries a row across the
  // tile edge.
  bool vert = d_vert != 0;
  float T = max(u_size, 1.0), H = d_frame.x, W = d_frame.y, s = d_frame.z, t = d_frame.w;
  int gR = d_gR;
  float pxs = max(u_px_scale, 1.0);

  // The noise, in one flat loop (one copy of its code; see UNI_1): the strata warp (x, y), the edge jaggies (x, y), the
  // roughness, the rills' meander, a breakup (laminae, crevice patches, pit clusters), the fracture zones, the folds and
  // the facet cracks' breakup. Each only where the output reads it (the roughness, rills, pits and laminae shape the
  // relief alone).
  vec2 wv = vec2(0.5), jv = vec2(0.5);
  float rn = 0.5, rl = 0.5, lb = 1.0, zn = 0.5, fd = 0.5, fb = 1.0;
  bool reliefOut = u_output == 0;
  for (int e = 0; e < 10 * UNI_1; e++) {
    int kind = e < 5 ? e / 2 : e - 2;
    float amt = kind == 0 ? u_warp : kind == 1 ? max(u_jag, u_steps) : kind == 2 ? (reliefOut ? u_rough : 0.0)
              : kind == 3 ? (reliefOut ? u_rills : 0.0)
              : kind == 4 ? max(reliefOut ? max(u_laminae, u_pits) : 0.0, u_output == 2 ? u_crev_patch : 0.0)
              : kind == 5 ? u_zones : kind == 6 ? u_fold : u_facet_break * u_joint_facets;
    if (amt > 0.0) {
      // (Cell counts by kind: rockDerived.)
      vec2 nc = d_nc[kind];
      vec2 x = p / uRes * nc + (e % 2 == 1 ? 17.3 : 0.0);
      // Perlin for the smooth fields (warp, roughness, meander); value noise for the pixel jaggies and the breakups.
      float n = org_noiseFbm(kind == 0 || kind == 2 || kind == 3 ? 1 : 0, false, x, periodOf(nc), kind == 0 || kind == 3 ? 2 : 3, 0.5, uSeed + 11.0 + float(e) * 13.0);
      if (e == 0) wv.x = n;
      else if (e == 1) wv.y = n;
      else if (e == 2) jv.x = n;
      else if (e == 3) jv.y = n;
      else if (e == 4) rn = n;
      else if (e == 5) rl = n;
      else if (e == 6) lb = n;
      else if (e == 7) zn = n;
      else if (e == 8) fd = n;
      else fb = n;
    }
  }
  // Fracture zones: a multiplier on the facets and roughness, 0 in the whole zones and 2 in the shattered ones (mean 1).
  float zf = mix(1.0, 2.0 * smoothstep(0.38, 0.62, zn), u_zones);
  vec2 pw = p + (wv - 0.5) * 2.0 * u_warp * T + (jv - 0.5) * 2.0 * u_jag;
  vec2 q = vert ? vec2(pw.y, -pw.x) : pw;
  vec2 f = vec2((q.x - s * q.y) / W, (q.y + t * q.x) / H);
  // Folds: a broad, smooth shift across the bedding (in beds). Sharpness folds the noise about its mean (≈ 0.5 ± 0.25):
  // 2 (⅛ − |n − ½|) has a V-shaped hinge wherever the noise crosses its mean — chevron folds — at about the same amplitude.
  float fn = fd - 0.5;
  f.y += 2.0 * u_fold * mix(fn, 2.0 * (0.125 - abs(fn)), u_fold_sharp);

  // Bedding: sites keep to their rows, and distances across the bedding count kb× (flat course joints). Distances are
  // taken in that metric, F = (u, kb v); power weights (size variation) let some blocks grow.
  float kb = 1.0 + 2.0 * u_bedding;
  vec2 K = vec2(1.0, kb);
  // Sites wander across their row by less as kb grows (the metric magnifies it kb²×: joints within a course would lean);
  // whole rows shift instead, so courses and columns differ in thickness but keep straight sides.
  vec2 jit = vec2(u_jitter, u_jitter * (1.0 - u_bedding) * 0.9 / (kb * kb));
  float jRow = u_jitter * u_bedding * 0.8;
  float wsc = u_size_var * 0.5 * kb;
  float scarp = max(u_scarp, 0.05);
  // Height coherence: block heights partly follow a smooth swell (value noise in px, ~3 block lengths across: the
  // fracture zones' cells).
  vec2 swc = d_nc[5];

  // Each generation: the nearest site (3×3 cells), then the mesas of the 5×5 cells around it. A mesa is the block's
  // face — height, tilt, dip, rounding — inside its cell; outside, the face at its nearest border point minus the px
  // distance from that border over the scarp width. The surface is the highest mesa; in the first two generations the
  // two highest give the crease (joint) distance and which joint it is — the first with the third highest too (the
  // nearest crease past a closed joint). Where the highest is another cell's skirt, the pixel lies on a scarp.
  float relief = 0.0, scarps = 0.0, scarpsAll = 0.0, rnd = 0.0, rndF = -1.0, stepH = 0.0, wu = 0.0;
  ivec2 rowK = ivec2(0);
  vec3 dc = vec3(1e4);
  ivec2 c1 = ivec2(0), c2 = ivec2(0), c3 = ivec2(0), c4 = ivec2(0), c5 = ivec2(0), o1 = ivec2(0), o2 = ivec2(0), o3 = ivec2(0);
  vec2 s1 = vec2(0.0), s2 = vec2(1.0, 0.0), s5 = vec2(1.0, 0.0), x1 = vec2(0.0), x2 = vec2(1.0, 0.0), x3 = vec2(1.0, 0.0);
  vec2 fo = f, Fo = f, Sb = f;
  ivec2 ip = ivec2(0), bc = ivec2(0);
  float best = 1e20, bw = 0.0, pb1 = -1e9, pb2 = -1e9, pb3 = -1e9, amp = 1.0, m = 1.0, wd = -1.0;
  // The second and third nearest sites (for the skirts' distances).
  float best2 = 1e20, best3 = 1e20, w2 = 0.0, w3 = 0.0;
  vec2 S2 = vec2(0.0), S3 = vec2(0.0);
  ivec2 c2n = ivec2(0), c3n = ivec2(0);
  // Finer generations split each block mx × m ways: about square facets (mx = m × the elongation, whole).
  float mx = 1.0, E = d_split.y;
  ivec3 wrapB = ivec3(1);
  ivec3 wrap0 = d_wrap0;
  // The block the pixel is in: its face and crest (its drop needs the distance to its nearest border: after the loop).
  float ownFace = 0.0, ownCrest = 0.0, din = 1e4, dinRun = 1.0, dinEnd = 0.0, ownRnd = 0.0;
  ivec2 dinC = ivec2(0);
  ivec2 ownC = ivec2(0), ownRow = ivec2(0);
  vec2 ownS = vec2(0.0);
  // Weathering rounds facets by their share of the relief: at full radius every facet border would become a groove.
  float wr = max(u_weather, 0.0);
  float kC = max(u_corner, 0.0), din2 = 1e4, dcR = 0.0, dTop = 1e4;
  vec2 dinN = vec2(1.0, 0.0), dinN2 = vec2(0.0, 1.0);
  // Ridges and hexagonal prisms (a crest across the row).
  bool crested = u_crest > 0 && u_bulge > 0.0;
  // Merged blocks: the nearest block's 2 × 2 group and whether it is fused (blocks only).
  ivec2 bg0 = ivec2(0);
  // A fused group's four sites (xy) and weights (z).
  vec3 M0 = vec3(0.0), M1 = M0, M2 = M0, M3 = M0;
  bool bmg = false, merging = u_merge > 0.0 && !crested;
  // Groups are 2 × 2 cells of the tile's lattice reduced to one domain (dimM cells), whole groups only; mT: the domain is
  // the transposed lattice's (wrapT), reduced by the rows first (rockDerived).
  ivec2 dimM = d_dimM.xy;
  ivec3 wrapT = d_wrapT;
  bool mT = d_dimM.z != 0;
  // Generations: the detail, less the last when it fades out entirely (see amp; the first facets stay for the facet
  // joints and values). It bounds the loop: breaking out of it instead cost 0.3 s of D3D compile. Each generation visits
  // its 38 cells, then (g == 38) the pixel's own block.
  int nGen = min(u_detail > 2 && (u_facets <= 0.0 || zf <= 0.0 || T <= 16.0 * pxs) ? 2 : u_detail, 3);
  for (int e = 0; e < nGen * 39 * UNI_1; e++) {
    int o = e / 39, g = e - o * 39;
    if (g == 0) {
      m = float(1 << o);
      mx = o == 0 ? 1.0 : m * E;
      // Facets under ~8 px fade out: at pixel scale they read as a grid of bumps (Roughness is for that grain).
      amp = o == 0 ? 1.0 : u_facets * pow(0.5, float(o - 1)) * zf * smoothstep(4.0 * pxs, 8.0 * pxs, T / m);
      // Facets are fractures, not beds: the finer generations keep only 40 % of the bedding (or they line up in rows of
      // little bricks).
      float bed = o == 0 ? u_bedding : 0.4 * u_bedding;
      kb = 1.0 + 2.0 * bed;
      K = vec2(1.0, kb);
      jit = vec2(u_jitter, u_jitter * (1.0 - bed) * 0.9 / (kb * kb));
      jRow = u_jitter * bed * 0.8;
      wsc = u_size_var * 0.5 * kb;
      // Finer generations are offset from the blocks (a translation keeps them seamless): nested exactly, their rows
      // would fall on the block rows and stack their scarps along every course joint.
      fo = f * vec2(mx, m) + vec2(0.37, 0.5) * float(o);
      // This generation's lattice is the blocks' scaled by (mx, m) per axis, so its basis is theirs scaled.
      ivec2 sc = ivec2(int(mx + 0.5), 1 << o);
      wrapB = ivec3(wrap0.x * sc.x, wrap0.y * sc.y, wrap0.z * sc.y);
      Fo = fo * K;
      ip = ivec2(floor(fo));
      best = 1e20; best2 = 1e20; best3 = 1e20; pb1 = -1e9; pb2 = -1e9; pb3 = -1e9; wd = -1.0; din = 1e4; din2 = 1e4;
    }
    // Then, around a fused block, its group's four sites (for the skirts' distance, below).
    bool near = g < 9, mate = g >= 9 && g < 13;
    ivec2 c = near ? ip + ivec2(g % 3 - 1, g / 3 - 1) : mate ? bg0 + ivec2((g - 9) % 2, (g - 9) / 2)
            : bc + ivec2((g - 13) % 5 - 2, (g - 13) / 5 - 2);
    ivec2 cw = rk_wrap(c, wrapB.xz, wrapB.y);
    float sd = uSeed + float(o) * 101.0;
    vec3 h = hash3I(cw, sd);
    vec3 h2 = hash3I(cw, sd + 37.0);
    // Merged blocks: a fused group's blocks take one set of face values from the group (sites, and so the joints, stay their own).
    // cg: the cell in the merge domain (see dimM). Only whole 2 × 2 groups: with an odd count of columns or rows, the
    // last group at the wrap has one.
    ivec2 cg = mT ? rk_wrap(c.yx, wrapT.xz, wrapT.y).yx : cw;
    ivec2 grp = (cg - imod(cg, ivec2(2))) / 2;
    bool mg = o == 0 && merging && hashI(grp, sd + 131.0) < u_merge
              && (!uTile || (grp.x * 2 + 1 < dimM.x && grp.y * 2 + 1 < dimM.y));
    // A fused group's identity: its group, apart from the blocks' keys (cells lie well within ±2²⁰).
    ivec2 gid = ivec2(grp.x - (1 << 20), grp.y);
    vec3 hf = mg ? hash3I(grp, sd + 141.0) : h;
    vec3 hf2 = mg ? hash3I(grp, sd + 178.0) : h2;
    float hr = rk_rowOff(c.y, o, gR);
    // Stagger (blocks): every other row shifts half a cell along the bedding (a running bond), its wander shrinking to fit
    // the 3 × 3 search. Its parity repeats every gR rows like the row offsets (an odd gR leaves one fault per gR rows).
    float stg = o == 0 ? u_stagger : 0.0;
    vec2 S = (vec2(c) + 0.5 + (h.xy - 0.5) * jit * vec2(1.0 - 0.5 * stg, 1.0)
              + vec2(0.5 * stg * (float(imod(imod(c.y, gR), 2)) - 0.5), hr * jRow)) * K;
    float w = (h2.z - 0.5) * wsc;
    // The mesa to put among the highest (a skirt; at g == 38 the pixel's own block): its signed px distance from its
    // border (> 0 outside), run, face, crest, end share, identity, site, skirt width (−1: none), facing, random, row.
    bool ins = false;
    float dS = 0.0, runI = 1.0, faceI = 0.0, crestI = 0.0, endI = 0.0, wdI = -1.0, wuI = wu, rndI = 0.0;
    ivec2 idI = ivec2(0), rowI = ivec2(0);
    vec2 SI = S;
    // (No continue in this loop: on D3D each one costs compile time.)
    if (mate) {
      vec3 Mi = vec3(S, w);
      if (g == 9) M0 = Mi; else if (g == 10) M1 = Mi; else if (g == 11) M2 = Mi; else M3 = Mi;
    } else if (near) {
      float dd = dot(S - Fo, S - Fo) - w;
      if (dd < best) {
        best3 = best2; S3 = S2; w3 = w2; c3n = c2n;
        best2 = best; S2 = Sb; w2 = bw; c2n = bc;
        best = dd; Sb = S; bw = w; bc = c; bmg = mg; bg0 = c - imod(cg, ivec2(2));
      } else if (dd < best2) {
        best3 = best2; S3 = S2; w3 = w2; c3n = c2n;
        best2 = dd; S2 = S; w2 = w; c2n = c;
      } else if (dd < best3) { best3 = dd; S3 = S; w3 = w; c3n = c; }
    } else if (g < 38) {
      // Another cell of the pixel's own fused group: its border is no border (no weathering, no crease).
      // (In the frame: comparing the reduced groups misfires in tiny tiles, where a wrapped copy lies in the window.)
      bool inner = bmg && all(greaterThanEqual(c - bg0, ivec2(0))) && all(lessThan(c - bg0, ivec2(2)));
      // The face's origin: the site, or the group's centre (in c's frame: cg plus the wrap offset c − cg).
      vec2 So = mg ? (vec2(grp * 2 + (c - cg)) + 1.0) * K : S;
      // Power bisectors (g < 0 on the near site's side) and their px distances through the frame's transpose
      // (F = K (mx (q.x − s q.y) / W, m (q.y + t q.x) / H)). Fb: the nearest point of this cell's border.
      vec2 Fb = Fo;
      // Facets' scarps run out twice as far (soft creases rather than one-pixel cracks) and don't lean: lean is the
      // bedding's ledges.
      float run0 = o == 0 ? scarp : 2.0 * scarp, lean = o == 0 ? u_lean : 0.0;
      float dout = 0.0, dB = 0.0, run = run0, endK = 0.0, up = 0.0;
      if (c != bc) {
        // The skirt's distance: from the pixel to this cell, as the farthest of its borders with the pixel's three nearest
        // sites (k = 0 the nearest). The border with the nearest alone is exact only for cells next to the pixel's; for the
        // others it underestimates, and jumps where the nearest site changes — steps in the skirts. Across a Voronoi edge
        // the three nearest stay the same three, so the farthest of their borders doesn't jump. In a fused group the three
        // are often all mates, far from this cell: a fourth, the mate nearest it, gives its border with the group (without
        // it a taller neighbour's skirt showed through the group in thin wedges). One copy of the code (a loop bound from a
        // uniform).
        ivec2 dm = clamp(c - bg0, ivec2(0), ivec2(1));
        vec3 Mk = dm.y == 0 ? (dm.x == 0 ? M0 : M1) : (dm.x == 0 ? M2 : M3);
        bool useM = bmg && bg0 + dm != bc && bg0 + dm != c;
        // A fused cell's own mates share its face: their borders are no corners (taken for corners, the rounding pulled
        // the skirt away from the block where an inner border meets the group's outline). They still bound the distance.
        ivec2 cg0 = c - imod(cg, ivec2(2));
        vec2 N = vec2(1.0, 0.0), nPx = vec2(1.0, 0.0), N0 = N, nPx0 = nPx, nPx2 = vec2(0.0, 1.0);
        float gb = 0.0, sgn = -1e9, sgnR = -1e9, sgn2 = -1e9, sgn0 = 0.0;
        vec2 nPxR = nPx;
        for (int k = 0; k < 4 * UNI_1; k++) {
          vec2 Sk = k == 0 ? Sb : k == 1 ? S2 : k == 2 ? S3 : Mk.xy;
          float wk = k == 0 ? bw : k == 1 ? w2 : k == 2 ? w3 : Mk.z;
          ivec2 ck = k == 0 ? bc : k == 1 ? c2n : c3n;
          ivec2 dk = ck - cg0;
          bool skip = k == 3 ? !useM : k > 0 && (ck == c || (k == 1 ? best2 : best3) > 1e19);
          bool mateK = mg && k > 0 && k < 3 && all(greaterThanEqual(dk, ivec2(0))) && all(lessThan(dk, ivec2(2)));
          vec2 Nk = S - Sk;
          // (From the sites' midpoint: |F|² − |S|² cancels badly far from the origin, and the borders jitter.)
          float gk = dot(Fo - 0.5 * (S + Sk), Nk) + 0.5 * (w - wk);
          vec2 nk = vec2(mx * Nk.x / W + t * kb * m * Nk.y / H, kb * m * Nk.y / H - s * mx * Nk.x / W);
          float sk = skip ? -1e9 : -gk / max(length(nk), 1e-6);
          if (k == 0) { sgn0 = sk; N0 = Nk; nPx0 = nk; }
          if (sk > sgn) { sgn = sk; gb = gk; N = Nk; nPx = nk; }
          // The two farthest borders other than mates' (the corner rounding's).
          float skR = mateK ? -1e9 : sk;
          if (skR > sgnR) { sgn2 = sgnR; nPx2 = nPxR; sgnR = skR; nPxR = nk; }
          else if (skR > sgn2) { sgn2 = skR; nPx2 = nk; }
        }
        dout = max(sgn, 0.0);
        dB = dout;
        // Rounded corners (blocks), outside: within kC of two of this cell's borders, the distance to its corner rounded
        // by kC — the exterior of the rounded box the pixel's own block uses inside (at g == 38), so a skirt meets the
        // rounded shoulder across the border without a lip. The borders' normals point into this cell, the own block's out
        // of it: the same angle between them.
        if (o == 0 && kC > 0.0 && sgn2 > -kC) {
          float cn = dot(nPxR, nPx2) / max(length(nPxR) * length(nPx2), 1e-6);
          // (Acute corners keep the right-angle form: exact, they'd jump where the second border comes within kC.)
          dout = mix(dout, max(dout, rk_cornerK(sgnR, sgn2, cn, kC)), rk_turn(cn));
        }
        Fb = Fo - min(gb, 0.0) / max(dot(N, N), 1e-6) * N;
        // 1 where this border is one of the block's ends (across the bedding), 0 along its sides.
        endK = abs(N.x) / max(length(N), 1e-6);
        // Lean: a skirt running down the screen (this block lies above the pixel) runs out further. nPx points from the
        // pixel's side towards this cell, in q; q.x is the screen's y in the turned frame. The sheer side keeps a quarter
        // of the run: a step in one pixel lights as a dotted line of single bright pixels.
        up = (vert ? nPx.x : nPx.y) / max(length(nPx), 1e-6);
        run *= max(1.0 + lean * up, 0.25);
        // The pixel's own block, seen from its border with this one (k = 0): inside it by sgn0 px. Its run is the
        // opposite lean's.
        // In a fused group the nearest site's bisectors cut through the group (its mates' cells are the block too): there
        // the farthest of the three borders, as for the skirts.
        if (bmg) { sgn0 = sgn; N0 = N; nPx0 = nPx; }
        float up0 = (vert ? nPx0.x : nPx0.y) / max(length(nPx0), 1e-6);
        if (!inner) {
          // The two nearest borders (corner rounding needs both).
          vec2 nn = nPx0 / max(length(nPx0), 1e-6);
          float endK0 = abs(N0.x) / max(length(N0), 1e-6);
          if (sgn0 < din) { din2 = din; dinN2 = dinN; din = sgn0; dinN = nn; dinRun = run0 * max(1.0 - lean * up0, 0.25); dinEnd = endK0; dinC = cw; }
          else if (sgn0 < din2) { din2 = sgn0; dinN2 = nn; }
          // The block's top edge (its neighbour lies above on screen): where streaks start.
          if (o == 0 && up0 > 0.4) dTop = min(dTop, max(sgn0, 0.0));
        }
      }
      vec2 df = (Fb - So) / K;
      float ta = hf2.x * TAU;
      float dome = 1.0 - (mg ? 1.0 : 4.0) * dot(df, df), domeMax = 1.0;
      if (crested) {
        // Ridges and prisms span their own row, between the midpoints to the rows either side (rows shift by jRow).
        float hm = rk_rowOff(c.y - 1, o, gR), hp = rk_rowOff(c.y + 1, o, gR);
        float lo = float(c.y) + 0.5 * (hm + hr) * jRow, hi = float(c.y) + 1.0 + 0.5 * (hr + hp) * jRow;
        float y = (Fb.y / kb - 0.5 * (lo + hi)) / max(hi - lo, 0.05);
        if (u_crest == 1) dome = 1.0 - 2.0 * abs(y);
        else {
          // Upper hull of a hexagon (circumradius ½ the row, turned 0–60°): the lowest of its three upward faces'
          // heights; the faces' slopes are capped so the side walls stay steep but finite.
          float th = fract(h2.x * 7.31 + h.y * 3.7) * 1.0471976;
          float s0 = sin(th), c0 = cos(th);
          vec3 sn = vec3(s0, 0.5 * s0 + 0.8660254 * c0, 0.8660254 * c0 - 0.5 * s0);
          vec3 cn = vec3(c0, 0.5 * c0 - 0.8660254 * s0, -0.5 * c0 - 0.8660254 * s0);
          vec3 zz = (0.4330127 - cn * y) / max(sn, 0.25);
          dome = 2.0 * min(zz.x, min(zz.y, zz.z));
          domeMax = max(c0, 0.8660254 * s0 + 0.5 * c0);
        }
      }
      // Height coherence: the blocks' own heights shrink; the shared swell is added once, after the loop (see there).
      float hz = (hf.z - 0.5) * (o == 0 ? 1.0 - u_coherence : 1.0);
      // Proud blocks: only this share of the blocks keep their own height; the rest sit flush (with the swell).
      if (o == 0 && fract(hf.z * 91.7 + hf2.x * 3.1) >= u_proud) hz = 0.0;
      // Facets differ mostly by their tilt: crumpled planes meeting in creases. Their own heights stay small, or every
      // facet lower than its neighbours turns into a pit.
      if (o > 0) hz *= 0.5;
      // Bed relief: the row's own offset (blocks only), repeating every gR rows like its thickness. A fused group takes
      // its first row's (it spans two).
      int rowC = mg ? c.y - imod(cg.y, 2) : c.y;
      float bedOff = o == 0 ? u_bed_relief * (hashI(ivec2(imod(rowC, gR), 9), uSeed + 191.0) - 0.5) : 0.0;
      // Pitch: in the turned frame (columns) u runs up the screen; otherwise along the strata, rightwards.
      float face = bedOff + u_heights * hz + u_tilt * hf2.y * dot(vec2(cos(ta), sin(ta)), df) - u_dip * df.y + u_pitch * df.x + u_bulge * (dome - 0.5);
      float crest = face + u_bulge * (domeMax - dome);
      if (c == bc) {
        ownFace = amp * face; ownCrest = amp * crest; ownC = mg ? gid : cw; ownS = S; ownRnd = fract(hf2.z * 7.13 + hf.z);
        ownRow = ivec2(imod(rowC, gR), 0);
      } else if (!inner) {
        // (A fused group's other cells share its face, which the pixel's own block already carries: left out, so they
        // can't stand second-highest at the group's outer border and hide the crease there.)
        // Scarp steps (blocks): the distance from the border as a staircase — flat treads, risers over the last 35 % of
        // each step — each block with its own step width (±30 %) and phase, the edges wobbling with the jaggies' noise.
        // Measured from the border (before corner rounding, which is added on top), so the face meets its skirt there
        // unchanged, rounded corners too. A fused group's cells share one staircase (the group's hashes).
        dS = dout;
        if (o == 0 && u_steps > 0.0) {
          float sp = max(u_step_px, pxs) * (0.7 + 0.6 * fract(hf2.x * 23.17 + hf.y));
          float x0 = fract(hf.x * 13.7 + hf2.z) + 0.8 * (jv.x - 0.5), x = x0 + dB / sp;
          float stair = floor(x) + smoothstep(0.65, 1.0, fract(x)) - floor(x0) - smoothstep(0.65, 1.0, fract(x0));
          dS = mix(dout, max(stair * sp, 0.0) + dout - dB, u_steps);
        }
        // A fused group's blocks share one identity (its first cell), and the second-highest must be another block: two
        // cells of one group draping over the pixel would draw a crease (and a crack) where their skirts meet.
        ins = true; runI = run; faceI = amp * face; crestI = amp * crest; endI = endK; idI = mg ? gid : cw; SI = S;
        wdI = dout; wuI = up; rndI = fract(hf2.z * 7.13 + hf.z); rowI = ivec2(imod(rowC, gR), 0);
      }
    } else {
      // The pixel's own block, its shoulder rounded inside its nearest border (no drop at all when Weathering is 0).
      // Rounded corners (blocks): within kC px of two borders, the distance to a corner rounded by kC (rk_corner, the
      // rounded-box form at any angle) — the corner sinks away in a curve beyond the arc — and the crease moves out by the
      // same amount, so the cracks open up where blocks meet. Elsewhere (one border near, or none) nothing changes.
      float dinS = din;
      if (o == 0 && kC > 0.0 && din2 < kC) {
        float cn = dot(dinN, dinN2);
        dinS = mix(din, -rk_cornerK(-din, -din2, cn, kC), rk_turn(cn));
        dcR = din - dinS;
      }
      ins = true; dS = -dinS; runI = dinRun; faceI = ownFace; crestI = ownCrest; endI = dinEnd; idI = ownC; SI = ownS;
      rndI = ownRnd; rowI = ownRow;
    }
    if (ins) {
      float drop = rk_shoulder(dS, wr * min(amp, 1.0)) / runI;
      // A prism breaks off at its ends in a plane sloping from its crest: the lower of that plane and the prism, so the
      // cap's outline follows the prism's profile. Along its sides it falls away as before.
      float Pk = crested ? min(faceI - (1.0 - endI) * drop, crestI - drop) : faceI - drop;
      // The three highest (another block each).
      if (Pk > pb1) {
        if (idI != o1) {
          if (idI != o2) { pb3 = pb2; o3 = o2; x3 = x2; }
          pb2 = pb1; o2 = o1; x2 = x1;
        }
        pb1 = Pk; o1 = idI; x1 = SI; wd = wdI; wu = wuI;
        if (o == 0) { rnd = rndI; rowK = rowI; }
        if (o == 1) rndF = rndI;
      } else if (Pk > pb2 && idI != o1) {
        if (idI != o2) { pb3 = pb2; o3 = o2; x3 = x2; }
        pb2 = Pk; o2 = idI; x2 = SI;
      } else if (Pk > pb3 && idI != o1 && idI != o2) { pb3 = Pk; o3 = idI; x3 = SI; }
    }
    if (g == 38) {
      relief += pb1;
      float d = (pb1 - pb2) * scarp;
      // On a skirt from its top edge (the border it falls from) to its foot (the crease), anti-aliased at both.
      // Facets' skirts count by their strength squared: at full weight every little facet step paints a dark fleck.
      // Scarp facing: up > 0 when the skirt's block lies above the pixel on screen (the skirt runs down: an underside).
      float fk = u_scarp_face == 0 ? 1.0 : smoothstep(-0.2, 0.4, u_scarp_face == 1 ? wu : -wu);
      float sk = wd >= 0.0 ? min(amp * amp, 1.0) * clamp(wd + 0.5, 0.0, 1.0) * clamp(d + 0.5, 0.0, 1.0) : 0.0;
      scarps = max(scarps, fk * sk);
      scarpsAll = max(scarpsAll, sk);
      if (o == 0) { dc.x = d; dc.z = (pb1 - pb3) * scarp; c1 = o1; c2 = o2; c5 = o3; s1 = x1; s2 = x2; s5 = x3; }
      // How deep the crease lies below the higher block's face: a step reaches further than a flat joint.
      if (o == 0) stepH = max(wd >= 0.0 ? wd / max(scarp, 0.05) : 0.0, 0.0);
      // Facet joints follow the facet's own cell border (straight): its crease, where a tilted face meets a neighbour's
      // skirt, curves, and cracked it curled into worms.
      if (o == 1) { dc.y = max(din, 0.0); c3 = ownC; c4 = dinC; }
    }
  }

  // Height coherence: a smooth swell (value noise, ~3 block lengths across) shared by all the blocks at a pixel. Added to
  // every mesa alike it changes none of the comparisons, so it is added once here: neighbouring blocks share it at their
  // border, and only the blocks' own (shrunk) heights make steps — ledges here and there instead of at every joint.
  if (u_coherence > 0.0) relief += u_heights * u_coherence * 1.8 * (rk_vnoise(pw / uRes * swc, periodOf(swc), uSeed + 83.0) - 0.5);
  // tanh: near linear for the usual range, rounding off big stacks of relief instead of clipping them flat.
  float v = 0.5 + 0.5 * tanh(relief) + u_rough * zf * (rn - 0.5);
  if (u_rills > 0.0 && reliefOut) v -= rk_rills(p, rl);
  if (u_pits > 0.0 && reliefOut) v -= rk_pits(p, lb, scarpsAll, dc.x, pxs);
  if (u_laminae > 0.0 && reliefOut) v -= rk_laminae(f.y, lb, T, gR, pxs);
  // Joints: cracks along the creases of the blocks (and, thinner, along some of the first facets' creases), sunk below
  // the faces; the blocks between them are the shape.
  // A joint across the bedding (its blocks lie end to end) takes the cross-joint share of the width; along its length a
  // crack pinches and swells with the (smooth, block-sized) warp noise, by the width variation.
  float swell = max(1.0 + 1.6 * u_joint_var * (wv.x - 0.5), 0.0);
  dc.xz -= dcR;
  // One loop over the joints, so rk_joint's code exists once (D3D inlines every call): the blocks' crease (k = 0); where
  // that joint is closed, the crease with the third highest block (k = 1: for the mask's distance alone, the nearest
  // open crease past the closed one); the first facets' crease (k = 2).
  float jx = 0.0, jMainD = -1e4, jThirdD = -1e4, jFacetD = -1e4;
  bool mainOpen = false, thirdOpen = false, facetOpen = false;
  for (int k = 0; k < 3 * UNI_1; k++) {
    bool facet = k == 2;
    if (k == 0 || (k == 1 ? !mainOpen && dc.z < 1e6 : u_joint_facets > 0.0 && u_joint > 0.0 && u_detail >= 2)) {
      vec2 sN = (k == 1 ? s5 : s2) - s1;
      float crossK = abs(sN.x) / max(length(sN), 1e-6);
      // Facet cracks: 0.6 × the width, at most a twelfth of a facet (half a block); see below for their depth.
      vec3 jk = rk_joint(k == 0 ? dc.x : k == 1 ? dc.z : dc.y, facet ? c3 : c1, k == 0 ? c2 : k == 1 ? c5 : c4,
                         facet ? min(0.6 * u_joint, T / 24.0) : u_joint * mix(1.0, u_joint_cross, crossK * crossK) * swell,
                         facet ? u_joint_facets : u_joint_open, uSeed + (facet ? 59.0 : 53.0));
      // Breakup: facet cracks fade in and out along their length.
      if (facet && u_facet_break > 0.0) {
        // (The fBm sits around 0.5 ± 0.15: the cut sweeps that, from a few gaps to a few fragments left.)
        float cut = 0.33 + 0.3 * u_facet_break;
        float fc = smoothstep(cut - 0.05, cut + 0.05, fb);
        // The crack's distance shrinks too, to nothing (its crevice glow and mask taper to a point, not cut off).
        jk.xy = vec2(jk.x * fc, jk.y - (1.0 - fc) * (0.5 * min(0.6 * u_joint, T / 24.0) + 3.0 * max(u_crev_reach, 0.5) + 1.0));
      }
      // Hairline facet cracks sink only 60 % as deep as the joints.
      if (k != 1) jx = max(jx, jk.x * (facet ? 0.6 : 1.0));
      if (k == 0) { jMainD = jk.y; mainOpen = jk.z > 0.5; }
      else if (k == 1) { jThirdD = jk.y; thirdOpen = jk.z > 0.5; }
      else { jFacetD = jk.y; facetOpen = jk.z > 0.5; }
    }
  }
  if (u_fractures > 0.0) jx = max(jx, rk_fractures(pw, pxs));
  v -= u_joint_depth * jx;
  // The blocks' distance to their joints (the mask's): to the crease if it is open, else to the third highest block's
  // (it takes over there, past the junction) if that is open, else at least a block's thickness in. (Past a closed joint
  // the distance runs on to the next open one rather than jumping.)
  float jMask = mainOpen ? jMainD : thirdOpen ? jThirdD : -clamp(dc.z, T, 1e3);
  // The Shape bevel rounds the blocks into the joints only: around the hairline facet cracks it turned them into grooves.
  v *= bevelPlain(jMask);
  // The block's own random is the mask's feature, whatever the colour follows.
  float blockRnd = rnd;
  // Per bed: a row's value repeats every gR rows, like its thickness (seamless where the shear wraps the beds).
  if (u_rnd_mode == 3) { if (rndF >= 0.0) rnd = rndF; }
  else if (u_rnd_mode > 0) {
    float rb = hashI(rowK, uSeed + 113.0);
    rnd = u_rnd_mode == 1 ? rb : clamp(rb + 0.25 * (rnd - 0.5), 0.0, 1.0);
  }
  // The masks' coverage is their value, so any blend (a Normal paint too) lands only on them.
  float cov = 1.0;
  if (u_output == 1) { v = scarps; cov = v; }
  if (u_output == 3) {
    v = rk_streaks(p, dTop, scarpsAll, pxs);
    cov = v;
  }
  if (u_output == 2) {
    // Crevices: from the crack's edge (or the crease) out over the reach, further on the skirt of a tall step.
    float reach = max(u_crev_reach, 0.5) * (1.0 + min(stepH, 2.0));
    // Closed joints (no crack) still hold a crease; open facet cracks add theirs.
    float dMain = mainOpen ? max(-jMainD, 0.0) : dc.x;
    float dFacet = facetOpen ? max(-jFacetD, 0.0) : 1e4;
    v = 1.0 - smoothstep(0.0, reach, min(dMain, dFacet));
    v = max(v, jx);
    // Patches: the breakup noise (fbm, about 0.5 ± 0.12) cut at a level that rises with the patchiness (0.5: about half).
    float cut = 0.35 + 0.3 * u_crev_patch;
    if (u_crev_patch > 0.0) v *= smoothstep(cut - 0.04, cut + 0.04, lb);
    cov = v;
  }
  GenOut res = genOutOwn(clamp(v, 0.0, 1.0), cov, rnd, max(jMask, facetOpen ? jFacetD : -1e4));
  res.fid = blockRnd;
  return res;
}
`
};
