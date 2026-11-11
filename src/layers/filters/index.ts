import type { LayerDef } from '../types';
import { blurLayer } from './blur';
import { bevelLayer, etchLayer } from './edges';
import { cavityLayer } from './cavity';
import { warpLayer } from './warp';
import { glassLayer } from './glass';
import { heightFromDiffuseLayer, hsvLayer, levelsLayer } from './adjust';
import { symmetryLayer } from './symmetry';
import { splitsLayer } from './splits';

/** Every filter / adjustment layer type (the New Layer menu orders them by MENU_ORDER in ui/meta.ts). */
export const FILTERS: LayerDef[] = [
	blurLayer,
	bevelLayer,
	etchLayer,
	cavityLayer,
	splitsLayer,
	warpLayer,
	glassLayer,
	levelsLayer,
	hsvLayer,
	heightFromDiffuseLayer,
	symmetryLayer
];
