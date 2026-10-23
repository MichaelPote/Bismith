// Blur post filter: separable Gaussian (docs/features/fr4.1-post-stack.md).

import { P } from '@/core/params';
import { gaussianBlur } from './gaussian';
import type { PostDef } from './types';

export const blurPost: PostDef = {
	type: 'blur',
	label: 'Blur',
	description: 'Separable Gaussian blur. Wraps across the edges when the project is tileable.',
	params: [
		P.float('radius', 'Sigma (σ)', 1, 0, 40, {
			softMax: 8,
			step: 0.01,
			unit: 'px',
			hint: 'Gaussian standard deviation in px; the kernel reaches about 3× further. The same blur as a Blur layer of twice this Radius.'
		})
	],
	run(ctx, input, output) {
		gaussianBlur(ctx, input, output, Number(ctx.filter.params.radius ?? 1));
	}
};
