import type { LayerDef } from '../types';
import { noiseLayer } from './noise';
import { SHAPE_LAYERS } from './shapes';
import { PATTERN_LAYERS } from './patterns';
import { cloudsLayer } from './patternsFill';
import { ORGANIC_LAYERS } from './organic';
import { GEOMETRIC_LAYERS } from './geometric';
import { MOTIF_LAYERS } from './motif';
import { GREEBLE_LAYERS } from './greeble';
import { STAMP_LAYERS } from './stamp';
import { PATH_LAYERS } from './paths';
import { cableLayer } from './cable';
import { dripsLayer } from './drips';
import { blistersLayer } from './blisters';
import { splatsLayer } from './splats';
import { hammeredLayer } from './hammered';
import { tabsLayer } from './tabs';
import { tracesLayer } from './traces';
import { causticLightLayer } from './causticLight';
import { settsLayer } from './setts';
import { pipeworkLayer } from './pipes';
import { surfaceMaskLayer } from './surfaceMask';
import { cracksLayer } from './cracks';
import { rockLayer } from './rock';
import { stoneBlocksLayer } from './stoneBlocks';
import { grassLayer } from './grass';
import { bismuthLayer } from './bismuth';
import { crystalLayer } from './crystal';
import { iceLayer } from './ice';
import { snowLayer } from './snow';

/** Every generator layer type (the New Layer menu orders them by MENU_ORDER in ui/meta.ts). */
export const GENERATORS: LayerDef[] = [
	noiseLayer,
	cloudsLayer,
	...SHAPE_LAYERS,
	...PATTERN_LAYERS,
	...ORGANIC_LAYERS,
	...GEOMETRIC_LAYERS,
	...MOTIF_LAYERS,
	...GREEBLE_LAYERS,
	...STAMP_LAYERS,
	...PATH_LAYERS,
	cableLayer,
	dripsLayer,
	blistersLayer,
	splatsLayer,
	hammeredLayer,
	tabsLayer,
	tracesLayer,
	causticLightLayer,
	settsLayer,
	pipeworkLayer,
	surfaceMaskLayer,
	cracksLayer,
	rockLayer,
	stoneBlocksLayer,
	grassLayer,
	bismuthLayer,
	crystalLayer,
	iceLayer,
	snowLayer
];
