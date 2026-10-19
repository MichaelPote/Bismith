// Smart-material recipes (docs/features/fr8.3-smart-materials.md): a good preset distilled into a handful of macro
// controls. `build(macros, ctx)` returns the recipe's layers, each tagged with a role and a stack ('relief' layers shape
// the surface only and go first in the material's block of layers); the editor keeps the layers as ordinary members and, when a macro moves, rewrites only the member params whose built value changed
// (see applyMacro in ./index.ts) — so recipes never need separate "apply" code.

import type { GroupDef, ParamDef, ParamValues } from '@/core/params';
import type { Layer, LayerStack, RenderSettings } from '@/core/project';

export interface RecipeContext {
	width: number;
	height: number;
	/** The project's heightDepth: world px of a height of 1 (for true-scale relief such as round pipes). */
	depth?: number;
}

export interface RecipeLayer {
	/** Stable role name within the recipe (the member key), e.g. 'pillow', 'stone-colour'. */
	role: string;
	stack: LayerStack;
	layer: Layer;
}

export interface RecipeDef {
	id: string;
	label: string;
	description: string;
	/** Macro controls; `group` refers to `groups`. */
	params: ParamDef[];
	groups: GroupDef[];
	/** Deterministic in the macros and size (layer ids aside). */
	build(m: ParamValues, ctx: RecipeContext): RecipeLayer[];
	/**
	 * How a colour fit may change this material's colour controls (default 'all'). 'lightness': only lightness — hue and
	 * chroma stay as authored. 'none': leave them alone. 'tones': the first gradient control becomes the reference's
	 * tonal ramp (its own colours, dark → light), each stop placed at the matching quantile of the layer's value, and
	 * the colour controls take its brightest tone — the reference's dynamic range without dulling saturated, glowing
	 * looks (lava, water); see fitTones.
	 */
	fit?: 'all' | 'lightness' | 'none' | 'tones';
	/**
	 * Added at the top of the stack, wherever the editor would insert it: it writes masks the materials below it are
	 * limited to (masks reach only the layers after their writer, FR8.23).
	 */
	first?: boolean;
	/** Render settings the look relies on, raised (never lowered; shadows only switched on) when the material is added. */
	render?: Partial<Pick<RenderSettings, 'ao' | 'aoRadius' | 'specularTint' | 'shadows'>>;
}
