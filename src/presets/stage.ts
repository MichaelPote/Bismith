// What a preset is rendered with (docs/features/fr5.4-presets.md): the item under one standard light rig, so all
// thumbnails compare, and — only for an item without relief of its own (a filter, a paint layer, a light, a post
// filter) — a fixed test scene under it, so its thumbnail shows something.

import type { Layer, Lighting, PostFilter, PresetInfo, Project, LayerGroup } from '@/core/project';
import { defaultRender } from '@/core/project';
import { createLayer, createLight, createPostFilter, createProject, reliefOnly } from '@/core/serialize';
import { getLayerDef } from '@/layers/registry';
import { gradient } from '@/core/params';
import { metalColour } from '@/core/color';

/** Size of the built-in presets' projects (the user's are saved at their project's size). */
const BUILTIN_PRESET_SIZE = 128;

/** The standard rig: a sun from the top left, sky and AO — flat ambient light would hide relief. */
function presetLighting(): Lighting {
	return {
		sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.35 },
		ambient: { color: '#ffffff', intensity: 0.02 },
		lights: [
			{
				...createLight('directional', { azimuth: 315, elevation: 40, angle: 3, intensity: 1.3, color: '#fff4e6' }),
				name: 'Sun'
			}
		]
	};
}

/** An empty project on the rig: mid grey base, tonemap only. */
export function presetBase(width = BUILTIN_PRESET_SIZE, height = width, tileable = true): Project {
	return createProject({
		name: 'Preset',
		width,
		height,
		tileable,
		heightDepth: 2,
		base: { color: '#808080', roughness: 0.7, specular: 0.5, metalness: 0, height: 0, opacity: 1 },
		layers: [],
		lighting: presetLighting(),
		render: { ...defaultRender(), maxSamples: 64, ao: 0.6, aoRadius: 6 },
		post: [createPostFilter('tonemap')]
	});
}

/** A layer that makes relief of its own: a generator with its Height output on. */
function makesRelief(layer: Pick<Layer, 'type' | 'params'>): boolean {
	return getLayerDef(layer.type)?.kind === 'generator' && layer.params.h_on === true;
}

/**
 * The stage for items without relief of their own: large bevelled bricks (writing the Shape mask) over soft noise,
 * relief only, sized to the texture.
 */
function presetStage(width: number): Layer[] {
	const u = width / BUILTIN_PRESET_SIZE;
	const noise = { noise: 'perlin', fractal: 'fbm', scale: 3, octaves: 4, h_on: true, h_amount: 0.12 };
	const bricks = { columns: 2, rows: 4, mortar: 3 * u, bevel: 3 * u, chips: 0, h_on: true, h_amount: 0.5 };
	return [
		reliefOnly(createLayer('noise', noise, 'Stage noise')),
		reliefOnly(createLayer('bricks', bricks, 'Stage bricks'))
	];
}

/**
 * The stage for lights and lighting: presetStage's matte bricks with a polished steel dome in the middle, which shows
 * the light's highlight and what metals reflect (the sky, or its environment image) from every direction.
 */
function presetLightStage(width: number): Layer[] {
	const r = 0.22 * width;
	const dome = createLayer(
		'circle',
		{
			radius: r,
			bevel: r,
			profile: 'round',
			h_on: true,
			// Over the bricks, not added to them: no joints across the dome.
			h_mode: 'max',
			h_amount: 6,
			dif_on: true,
			dif_src: 'flat',
			dif_grad: gradient(metalColour('#9a9a9a')),
			r_on: true,
			r_src: 'flat',
			r_b: 0.2,
			mt_on: true,
			mt_src: 'flat'
		},
		'Stage dome'
	);
	return [...presetStage(width), dome];
}

/** What a preset holds: the item and its kind. */
export type PresetItem =
	| { kind: 'layer'; layer: Layer }
	| { kind: 'group'; group: LayerGroup; layers: Layer[] }
	| { kind: 'light'; light: Lighting['lights'][number] }
	| { kind: 'lighting'; lighting: Lighting }
	| { kind: 'post'; filter: PostFilter };

/**
 * The project a preset of `item` is saved as, built on `base` (presetBase at the wanted size): the item under the
 * standard rig, on presetStage when it has no relief of its own. A post filter goes on `postScene` (the Stone bricks
 * starter) when given, the stage otherwise.
 */
export function presetProject(
	item: PresetItem,
	base: Project,
	info: Omit<PresetInfo, 'kind' | 'target'>,
	postScene?: () => Project
): Project {
	const p = base;
	switch (item.kind) {
		case 'layer':
			p.layers = makesRelief(item.layer) ? [item.layer] : [...presetStage(p.width), item.layer];
			p.preset = { ...info, kind: 'layer', target: item.layer.type };
			break;
		case 'group':
			p.layers = item.layers;
			p.groups = [item.group];
			p.preset = { ...info, kind: 'group' };
			break;
		case 'light':
			p.layers = presetLightStage(p.width);
			p.lighting = { ...p.lighting, lights: [item.light] };
			p.preset = { ...info, kind: 'light', target: item.light.type };
			break;
		case 'lighting': {
			p.layers = presetLightStage(p.width);
			p.lighting = item.lighting;
			p.preset = { ...info, kind: 'lighting' };
			break;
		}
		case 'post': {
			const scene = postScene?.();
			if (scene) Object.assign(p, { ...scene, name: p.name, preset: undefined, description: undefined });
			else p.layers = presetStage(p.width);
			p.post = [...p.post.filter((f) => f.type !== item.filter.type), item.filter];
			p.preset = { ...info, kind: 'post', target: item.filter.type };
			break;
		}
	}
	return p;
}
