<script setup lang="ts">
	// A question (the editor's Question) opened under the row it is about, rather than as a modal: Cancel and its
	// choices, the primary one focused so Enter picks it. Esc or a click outside cancels. With no choices it is a note
	// with OK.
	import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
	import type { Question } from '@/stores/editor';

	const props = defineProps<{ question: Question; anchor: HTMLElement }>();
	const emit = defineEmits<{ (e: 'answer', id: string | null): void }>();

	const card = ref<HTMLElement | null>(null);
	const pos = ref({ left: '0px', top: '0px', width: '240px' });

	function place(): void {
		const r = props.anchor.getBoundingClientRect();
		const width = Math.max(240, r.width - 16);
		const left = Math.min(r.left + 8, window.innerWidth - width - 8);
		pos.value = { left: `${left}px`, top: `${r.bottom + 6}px`, width: `${width}px` };
	}

	function onKey(e: KeyboardEvent): void {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		emit('answer', null);
	}

	function onPointer(e: PointerEvent): void {
		if (!card.value?.contains(e.target as Node)) emit('answer', null);
	}

	onMounted(async () => {
		place();
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('pointerdown', onPointer, true);
		window.addEventListener('resize', place);
		await nextTick();
		(card.value?.querySelector<HTMLElement>('.primary') ?? card.value?.querySelector<HTMLElement>('button'))?.focus();
	});
	onBeforeUnmount(() => {
		window.removeEventListener('keydown', onKey, true);
		window.removeEventListener('pointerdown', onPointer, true);
		window.removeEventListener('resize', place);
	});
</script>

<template>
	<Teleport to="body">
		<div
			ref="card"
			class="anchored"
			role="alertdialog"
			aria-labelledby="anchored-title"
			:aria-describedby="question.detail ? 'anchored-detail' : undefined"
			:style="pos">
			<span class="notch" aria-hidden="true" />
			<div id="anchored-title" class="title">{{ question.title }}</div>
			<p v-if="question.detail" id="anchored-detail" class="detail">{{ question.detail }}</p>
			<div class="choices">
				<template v-if="question.choices.length">
					<button type="button" class="fk" @click="emit('answer', null)">
						<span class="fk-face">Cancel</span>
					</button>
					<button
						v-for="c in question.choices"
						:key="c.id"
						type="button"
						class="fk"
						:class="{ primary: c.primary }"
						@click="emit('answer', c.id)">
						<span class="fk-face">{{ c.label }}</span>
					</button>
				</template>
				<button v-else type="button" class="fk" @click="emit('answer', null)">
					<span class="fk-face">OK</span>
				</button>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
	.anchored {
		position: fixed;
		z-index: 300;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		background: var(--panel);
		box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
	}
	.notch {
		position: absolute;
		left: 22px;
		top: -6px;
		width: 10px;
		height: 10px;
		background: var(--panel);
		border-left: 1px solid var(--line);
		border-top: 1px solid var(--line);
		transform: rotate(45deg);
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
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
</style>
