<script setup lang="ts">
	// The open question (editor.ask) as a modal: Cancel and its choices in the tray, the primary one a game key, focused
	// so Enter picks it. Esc or a click outside cancels.
	import { useEditorStore } from '@/stores/editor';
	import DialogFrame from '@/ui/components/DialogFrame.vue';

	const editor = useEditorStore();
</script>

<template>
	<DialogFrame
		v-if="editor.question"
		:key="editor.question.title"
		role="alertdialog"
		:title="editor.question.title"
		width="440px"
		:describedby="editor.question.detail ? 'ask-detail' : undefined"
		@close="editor.question.answer(null)">
		<p v-if="editor.question.detail" id="ask-detail" class="detail">{{ editor.question.detail }}</p>
		<template #tray>
			<span class="grow" />
			<button type="button" class="gk" @click="editor.question.answer(null)">
				<span class="gk-face">Cancel</span>
			</button>
			<button
				v-for="c in editor.question.choices"
				:key="c.id"
				type="button"
				class="gk"
				:class="{ primary: c.primary }"
				@click="editor.question.answer(c.id)">
				<span class="gk-face">{{ c.label }}</span>
			</button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.detail {
		margin: 0;
		padding: 0 16px 16px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-mid);
	}
</style>
