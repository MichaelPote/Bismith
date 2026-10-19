<script setup lang="ts">
	// The open question (editor.ask) as a modal: Cancel and its choices, the primary one focused so Enter picks it.
	// Esc or a click outside the card cancels.
	import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { useEditorStore } from '@/stores/editor';

	const editor = useEditorStore();
	const card = ref<HTMLElement | null>(null);

	function onKey(e: KeyboardEvent): void {
		if (!editor.question || e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		editor.question.answer(null);
	}

	watch(
		() => editor.question,
		async (q) => {
			if (!q) return;
			await nextTick();
			(card.value?.querySelector<HTMLElement>('.primary') ?? card.value?.querySelector<HTMLElement>('button'))?.focus();
		}
	);
	onMounted(() => window.addEventListener('keydown', onKey, true));
	onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
	<div v-if="editor.question" class="ask" @pointerdown.self="editor.question.answer(null)">
		<div
			ref="card"
			class="card"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="ask-title"
			:aria-describedby="editor.question.detail ? 'ask-detail' : undefined">
			<div id="ask-title" class="title">{{ editor.question.title }}</div>
			<p v-if="editor.question.detail" id="ask-detail" class="detail">{{ editor.question.detail }}</p>
			<div class="choices">
				<button type="button" class="fk" @click="editor.question.answer(null)">
					<span class="fk-face">Cancel</span>
				</button>
				<button
					v-for="c in editor.question.choices"
					:key="c.id"
					type="button"
					class="fk"
					:class="{ primary: c.primary }"
					@click="editor.question.answer(c.id)">
					<span class="fk-face">{{ c.label }}</span>
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
	.ask {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: rgba(8, 9, 10, 0.45);
	}
	.card {
		max-width: 420px;
		padding: 16px 18px;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		background: var(--panel);
		box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
	}
	.title {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-hi);
	}
	.detail {
		margin: 6px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-mid);
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}
</style>
