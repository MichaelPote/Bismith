<script setup lang="ts">
// Shows 8-bit RGBA pixels scaled with nearest-neighbour sampling, fitted into its box. `pickable`: the eyedropper takes
// the pixel under the pointer.
import { onMounted, ref, watch } from 'vue'
import { pixelHex, vPick } from '@/ui/eyedropper'

const props = defineProps<{ pixels: Uint8ClampedArray | null; width: number; height: number; label?: string; pickable?: boolean }>()
const canvas = ref<HTMLCanvasElement | null>(null)

/** Eyedropper: the pixel under the pointer, through the canvas's contain fit. */
function pixelAt(e: MouseEvent): string | null {
  const c = canvas.value
  const px = props.pixels
  if (!c || !px) return null
  const r = c.getBoundingClientRect()
  const s = Math.min(r.width / props.width, r.height / props.height)
  const x = Math.floor((e.clientX - r.left - (r.width - props.width * s) / 2) / s)
  const y = Math.floor((e.clientY - r.top - (r.height - props.height * s) / 2) / s)
  if (x < 0 || y < 0 || x >= props.width || y >= props.height) return null
  return pixelHex(px, (y * props.width + x) * 4)
}

function draw(): void {
  const c = canvas.value
  if (!c || !props.pixels || !props.width || !props.height) return
  c.width = props.width
  c.height = props.height
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(props.pixels), props.width, props.height), 0, 0)
}

onMounted(draw)
watch(() => [props.pixels, props.width, props.height], draw)
</script>

<template>
  <div class="ic">
    <canvas v-show="pixels" ref="canvas" v-pick="pickable ? pixelAt : null" :aria-label="label" role="img" :style="{ aspectRatio: `${width} / ${height}` }" />
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
  background-image: linear-gradient(45deg, #23272b 25%, transparent 25%), linear-gradient(-45deg, #23272b 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #23272b 75%), linear-gradient(-45deg, transparent 75%, #23272b 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
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
