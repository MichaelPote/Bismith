<script setup lang="ts">
	// A question (the editor's Question) opened under the row it is about, rather than as a modal: Cancel and its
	// choices, the primary one focused so Enter picks it. Esc or a click outside cancels. With no choices it is a note
	// with OK.
	import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
	import type { Question } from '@/stores/editor';
	import { closeModal, isTopModal, openModal } from '@/ui/modals';
	import { inViewport, usePopover } from '@/ui/popover';

	const props = defineProps<{ question: Question; anchor: HTMLElement }>();
	const emit = defineEmits<{ (e: 'answer', id: string | null): void }>();

	const card = ref<HTMLElement | null>(null);
	const pos = ref({ left: '0px', top: '0px', width: '240px' });
	const titleId = useId();
	const detailId = useId();

	function place(): void {
		const r = props.anchor.getBoundingClientRect();
		const width = Math.max(240, r.width - 16);
		const left = inViewport(r.left + 8, width, 'x');
		pos.value = { left: `${left}px`, top: `${r.bottom + 6}px`, width: `${width}px` };
	}

	// Modal while open: the editor's shortcuts wait (App's onKey).
	let self: object = {};

	const popover = usePopover({
		popover: card,
		onOutside: () => emit('answer', null),
		onEscape(e) {
			if (!isTopModal(self)) return;
			e.preventDefault();
			e.stopPropagation();
			emit('answer', null);
		},
		onResize: place
	});

	onMounted(async () => {
		self = openModal();
		place();
		popover.listen();
		await nextTick();
		(card.value?.querySelector<HTMLElement>('.primary') ?? card.value?.querySelector<HTMLElement>('button'))?.focus();
	});
	onBeforeUnmount(() => closeModal(self));
</script>

<template>
	<Teleport to="body">
		<div
			ref="card"
			class="anchored"
			role="alertdialog"
			:aria-labelledby="titleId"
			:aria-describedby="question.detail ? detailId : undefined"
			:style="pos">
			<span class="notch" aria-hidden="true" />
			<div :id="titleId" class="title">{{ question.title }}</div>
			<p v-if="question.detail" :id="detailId" class="detail">{{ question.detail }}</p>
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
