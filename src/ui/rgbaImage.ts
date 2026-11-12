import { toRgba8, type MatchImage } from '@/match/image';

/** 8-bit RGBA pixels and their size: what ImageCanvas shows. */
export interface RgbaImage {
	pixels: Uint8ClampedArray;
	width: number;
	height: number;
}

/** A linear image's pixels for ImageCanvas. */
export const rgbaImage = (img: MatchImage): RgbaImage => ({
	pixels: toRgba8(img),
	width: img.width,
	height: img.height
});
