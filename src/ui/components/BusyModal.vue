<script setup lang="ts">
	// Modal over the app while blocking work runs (editor.busy), e.g. a generator's first shader compile. It blocks input
	// at once but fades in after a short delay (unless `instant`), so quick work doesn't flash it. The spinner animates
	// only transform, which browsers can run off the main thread, so it may keep turning while a compile stalls the page.
	// With `progress` set, a bar shows the share of the steps done (e.g. 1 of 4 shaders compiled: 25%); with `cancel`, a
	// Cancel key in the tray calls it (an export render).
	import { computed } from 'vue';
	import { useEditorStore } from '@/stores/editor';
	import DialogFrame from '@/ui/components/DialogFrame.vue';

	const editor = useEditorStore();
	const pct = computed(() =>
		editor.busy?.progress === undefined ? null : Math.round(Math.min(1, Math.max(0, editor.busy.progress)) * 100)
	);
</script>

<template>
	<DialogFrame
		v-if="editor.busy"
		busy
		:instant="editor.busy.instant"
		:closable="false"
		width="380px"
		:describedby="editor.busy.detail ? 'busy-detail' : undefined">
		<template #title><span class="spinner" aria-hidden="true" />{{ editor.busy.title }}</template>
		<div class="body">
			<div v-if="editor.busy.detail" id="busy-detail" class="detail">{{ editor.busy.detail }}</div>
			<div v-if="pct !== null" class="progress">
				<div
					class="bar"
					role="progressbar"
					aria-label="Progress"
					:aria-valuenow="pct"
					aria-valuemin="0"
					aria-valuemax="100">
					<span class="fill" :style="{ transform: `scaleX(${pct / 100})` }" />
				</div>
				<span class="pct cf-mono">{{ pct }}%</span>
			</div>
		</div>
		<template v-if="editor.busy.cancel" #tray>
			<span class="grow" />
			<button type="button" class="gk" @click="editor.busy.cancel()"><span class="gk-face">Cancel</span></button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.spinner {
		width: 16px;
		height: 16px;
		flex: none;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: busy-spin 0.8s linear infinite;
	}
	.body {
		padding: 0 16px 16px;
	}
	.detail {
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-mid);
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}
	.bar {
		flex: 1;
		height: 6px;
		overflow: hidden;
		border-radius: 3px;
		background: #1e2124;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.4),
			inset 0 0 0 1px #0d0f11;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
		transform-origin: left;
		transition: transform 200ms ease-out;
	}
	.pct {
		min-width: 3ch;
		font-size: 11px;
		text-align: right;
		color: var(--readout);
	}
	@keyframes busy-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2.4s;
		}
	}
</style>
