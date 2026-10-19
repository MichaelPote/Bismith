<script setup lang="ts">
	// Modal over the app while blocking work runs (editor.busy), e.g. a generator's first shader compile. It blocks input
	// at once but fades in after a short delay (unless `instant`), so quick work doesn't flash it. The spinner animates
	// only transform, which browsers can run off the main thread, so it may keep turning while a compile stalls the page.
	// With `progress` set, a bar shows the share of the steps done (e.g. 1 of 4 shaders compiled: 25%).
	import { computed } from 'vue';
	import { useEditorStore } from '@/stores/editor';

	const editor = useEditorStore();
	const pct = computed(() =>
		editor.busy?.progress === undefined ? null : Math.round(Math.min(1, Math.max(0, editor.busy.progress)) * 100)
	);
</script>

<template>
	<div
		v-if="editor.busy"
		class="busy"
		:class="{ instant: editor.busy.instant }"
		role="dialog"
		aria-modal="true"
		aria-busy="true"
		aria-labelledby="busy-title"
		aria-describedby="busy-detail">
		<div class="card">
			<span class="spinner" aria-hidden="true" />
			<div class="body">
				<div id="busy-title" class="title">{{ editor.busy.title }}</div>
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
		</div>
	</div>
</template>

<style scoped>
	.busy {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: rgba(8, 9, 10, 0.45);
		cursor: progress;
		animation: busy-in 160ms ease-out 250ms both;
	}
	.busy.instant {
		animation: none;
	}
	.card {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		width: 360px;
		max-width: 100%;
		padding: 16px 18px;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		background: var(--panel);
		box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
	}
	.spinner {
		width: 20px;
		height: 20px;
		flex: none;
		margin-top: 1px;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: busy-spin 0.8s linear infinite;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-hi);
	}
	.detail {
		margin-top: 4px;
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
		height: 4px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--sunken);
		border: 1px solid var(--hairline);
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
		color: var(--text-mid);
	}
	@keyframes busy-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
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
