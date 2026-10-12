<script setup lang="ts">
// Inline stroke icons in the Cinderforge editor style: 18×18 grid, 1.5 stroke, square-ish joins.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number; stroke?: string }>(), {
  size: 16,
  stroke: 'currentColor',
})

const PATHS: Record<string, string> = {
  diamond: 'M9 2 16 9 9 16 2 9z M9 6 12 9 9 12 6 9z',
  link: 'M7.5 10.5l3-3M8 5.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L11.5 9M6.5 9 5 10.5a2.5 2.5 0 0 0 3.5 3.5L10 12.5',
  layers: 'M9 2 16 6 9 10 2 6z M2 9.5 9 13.5 16 9.5 M2 13 9 17 16 13',
  noise: 'M3 3h2v2H3zM9 3h2v2H9zM6 6h2v2H6zM13 6h2v2h-2zM3 9h2v2H3zM10 10h2v2h-2zM6 13h2v2H6zM13 13h2v2h-2z',
  shape: 'M3 3h12v12H3z',
  circle: 'M9 2.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z',
  pattern: 'M2 2h14v14H2zM2 9h14M9 2v14',
  bricks: 'M2 3h14v12H2zM2 7h14M2 11h14M8 3v4M12 7v4M6 7v4M9 11v4',
  filter: 'M2 5c2.5-2 4.5 2 7 0s4.5-2 7 0M2 9c2.5-2 4.5 2 7 0s4.5-2 7 0M2 13c2.5-2 4.5 2 7 0s4.5-2 7 0',
  adjust: 'M3 4h12M3 9h12M3 14h12M6 2.5v3M12 7.5v3M8 12.5v3',
  light: 'M6 13h6M7 16h4M9 2a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z',
  sun: 'M9 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM9 1v2.5M9 14.5V17M1 9h2.5M14.5 9H17M3.3 3.3l1.8 1.8M12.9 12.9l1.8 1.8M3.3 14.7l1.8-1.8M12.9 5.1l1.8-1.8',
  point: 'M9 5a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2',
  sky: 'M2 13a7 7 0 0 1 14 0zM1 13h16',
  post: 'M9 2l1.6 4.4L15 8l-4.4 1.6L9 14l-1.6-4.4L3 8l4.4-1.6z',
  eye: 'M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z M9 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  'eye-off': 'M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z M3 15 15 3',
  lock: 'M4 8h10v8H4zM6 8V5.5a3 3 0 0 1 6 0V8',
  unlock: 'M4 8h10v8H4zM6 8V5.5a3 3 0 0 1 5.8-1',
  plus: 'M9 3v12M3 9h12',
  minus: 'M3 9h12',
  close: 'M4 4l10 10M14 4 4 14',
  trash: 'M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11',
  copy: 'M6 6h9v9H6zM3 12V3h9',
  'chev-down': 'M5 7l4 4 4-4',
  'chev-right': 'M7 5l4 4-4 4',
  'chev-left': 'M11 5 7 9l4 4',
  up: 'M9 14V4M5 8l4-4 4 4',
  down: 'M9 4v10M5 10l4 4 4-4',
  play: 'M5 3l10 6-10 6z',
  pause: 'M5 3h3v12H5zM10 3h3v12h-3z',
  refresh: 'M15 9a6 6 0 1 1-2-4.5M13 2v3h-3',
  download: 'M9 2v10M5 8l4 4 4-4M3 15h12',
  upload: 'M9 12V2M5 6l4-4 4 4M3 15h12',
  folder: 'M2 4h5l2 2h7v9H2z',
  save: 'M3 3h10l2 2v10H3zM6 3v4h6V3M6 15v-5h6v5',
  grid: 'M2 2h14v14H2zM2 9h14M9 2v14',
  tile: 'M1 1h5v5H1zM6.5 1h5v5h-5zM12 1h5v5h-5zM1 6.5h5v5H1zM12 6.5h5v5h-5zM1 12h5v5H1zM6.5 12h5v5h-5zM12 12h5v5h-5zM7 7h4v4H7z',
  checker: 'M2 2h7v7H2zM9 9h7v7H9z M2 2h14v14H2z',
  fit: 'M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4',
  target: 'M9 2a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM9 5.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM9 8.5v1',
  image: 'M2 3h14v12H2zM2 12l4-4 3 3 2-2 5 5M12 6.5a1 1 0 1 0 0 .1',
  project: 'M9 1.5 16 5.25v7.5L9 16.5 2 12.75v-7.5z M2 5.25 9 9l7-3.75M9 9v7.5',
  settings: 'M9 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM9 1v3M9 14v3M1 9h3M14 9h3M3.3 3.3l2.1 2.1M12.6 12.6l2.1 2.1M3.3 14.7l2.1-2.1M12.6 5.4l2.1-2.1',
  undo: 'M6 4 2 8l4 4M2 8h9a5 5 0 0 1 0 10',
  redo: 'M12 4l4 4-4 4M16 8H7a5 5 0 0 0 0 10',
  wand: 'M3 15 12 6M10 4l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM14 10l.6-1.2L16 8.2l-1.4-.6L14 6l-.6 1.6-1.4.6 1.4.6z',
  bolt: 'M10 2 4 10h5l-1 6 6-8h-5z',
  dots: 'M4 9h.01M9 9h.01M14 9h.01',
  curve: 'M2 14C5 3 13 3 16 14',
  line: 'M3 15 15 3',
  polygon: 'M9 2l6.5 4.7-2.5 7.8H5L2.5 6.7z',
  cross: 'M7 2h4v5h5v4h-5v5H7v-5H2V7h5z',
}

const d = computed(() => PATHS[props.name] ?? PATHS.diamond)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 18 18"
    fill="none"
    :stroke="stroke"
    stroke-width="1.5"
    stroke-linejoin="round"
    stroke-linecap="square"
    aria-hidden="true"
  >
    <path :d="d" />
  </svg>
</template>
