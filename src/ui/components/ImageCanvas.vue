<script setup lang="ts">
	// Shows 8-bit RGBA pixels scaled with nearest-neighbour sampling, fitted into its box. `pickable`: the eyedropper takes
	// the pixel under the pointer. `tiles`: the image repeated tiles × tiles (drawn by the canvas, not copied).
	import { onMounted, ref, watch } from 'vue';
	import { pixelHex, vPick } from '@/ui/eyedropper';

	const props = defineProps<{
		pixels: Uint8ClampedArray | null;
		width: number;
		height: number;
		label?: string;
		pickable?: boolean;
		tiles?: number;
	}>();
	const tiles = () => Math.max(1, Math.round(props.tiles ?? 1));
	const canvas = ref<HTMLCanvasElement | null>(null);

	/** Eyedropper: the pixel under the pointer, through the canvas's contain fit. */
	function pixelAt(e: MouseEvent): string | null {
		const c = canvas.value;
		const px = props.pixels;
		if (!c || !px) return null;
		const r = c.getBoundingClientRect();
		const n = tiles();
		const w = props.width * n;
		const h = props.height * n;
		const s = Math.min(r.width / w, r.height / h);
		const x = Math.floor((e.clientX - r.left - (r.width - w * s) / 2) / s);
		const y = Math.floor((e.clientY - r.top - (r.height - h * s) / 2) / s);
		if (x < 0 || y < 0 || x >= w || y >= h) return null;
		return pixelHex(px, ((y % props.height) * props.width + (x % props.width)) * 4);
	}

	function draw(): void {
		const c = canvas.value;
		if (!c || !props.pixels || !props.width || !props.height) return;
		const n = tiles();
		const img = new ImageData(new Uint8ClampedArray(props.pixels), props.width, props.height);
		c.width = props.width * n;
		c.height = props.height * n;
		const ctx = c.getContext('2d')!;
		if (n === 1) return ctx.putImageData(img, 0, 0);
		const tile = new OffscreenCanvas(props.width, props.height);
		tile.getContext('2d')!.putImageData(img, 0, 0);
		ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
		ctx.fillRect(0, 0, c.width, c.height);
	}

	onMounted(draw);
	watch(() => [props.pixels, props.width, props.height, props.tiles], draw);
</script>

<template>
	<div class="ic">
		<canvas
			v-show="pixels"
			ref="canvas"
			v-pick="pickable ? pixelAt : null"
			:aria-label="label"
			role="img"
			:style="{ aspectRatio: `${width * tiles()} / ${height * tiles()}` }" />
		<div v-if="!pixels" class="placeholder"><slot /></div>
	</div>
</template>

<style scoped>
	.ic {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 0;
		height: 100%;
		background-color: var(--sunken);
		background-image:
			linear-gradient(45deg, #23272b 25%, transparent 25%), linear-gradient(-45deg, #23272b 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #23272b 75%), linear-gradient(-45deg, transparent 75%, #23272b 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
	}
	canvas {
		max-width: 100%;
		max-height: 100%;
		width: auto;
		height: 100%;
		image-rendering: pixelated;
		object-fit: contain;
	}
	.placeholder {
		color: var(--text-lo);
		font-size: 12px;
		text-align: center;
		padding: 16px;
	}
</style>
