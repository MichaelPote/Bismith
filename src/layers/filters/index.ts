import type { LayerDef } from '../types';
import { blurLayer } from './blur';
import { bevelLayer, etchLayer } from './edges';
import { cavityLayer } from './cavity';
import { warpLayer } from './warp';
import { glassLayer } from './glass';
import { heightFromDiffuseLayer, hsvLayer, levelsLayer } from './adjust';
import { SYMMETRY_FILTERS } from './symmetry';

/** Every filter / adjustment layer type, in add-menu order. */
export const FILTERS: LayerDef[] = [
	blurLayer,
	bevelLayer,
	etchLayer,
	cavityLayer,
	warpLayer,
	glassLayer,
	levelsLayer,
	hsvLayer,
	heightFromDiffuseLayer,
	...SYMMETRY_FILTERS
];
