<script setup lang="ts">
	// A mask name (FR8.23): a dropdown of the masks there are — None, then the names — and "New mask…", which turns the
	// field into a name input (Enter or leaving it keeps the name, Escape goes back). A name nothing writes yet (read
	// fields: nothing above writes it) stays listed, marked as empty. Each mask shows in its colour (a ring before the
	// name, the names in the list), as everywhere the UI shows a mask.
	import { computed, nextTick, ref } from 'vue';
	import { IconChevronDown } from '@tabler/icons-vue';
	import { useProjectStore } from '@/stores/project';
	import { maskColour } from '@/ui/meta';

	const props = defineProps<{
		modelValue: string;
		/** The masks to offer, in order. */
		choices: string[];
		/** 'read': masks layers above write (an unknown one is empty here); 'write': any mask. */
		kind: 'read' | 'write';
		label?: string;
	}>();
	const emit = defineEmits<{
		(e: 'update:modelValue', v: string): void;
	}>();

	const store = useProjectStore();
	const colour = (name: string) => (name ? maskColour(store.project, name) : undefined);

	const NEW = '\u0000new';
	const editing = ref(false);
	const draft = ref('');
	const input = ref<HTMLInputElement | null>(null);

	const options = computed(() => {
		const list = [{ value: '', label: 'None' }, ...props.choices.map((n) => ({ value: n, label: n }))];
		const v = props.modelValue.trim();
		if (v && !props.choices.includes(v))
			list.push({ value: v, label: props.kind === 'read' ? `${v} (empty here)` : v });
		list.push({ value: NEW, label: 'New mask…' });
		return list;
	});

	function choose(v: string): void {
		emit('update:modelValue', v);
	}

	async function onChange(e: Event): Promise<void> {
		const v = (e.target as HTMLSelectElement).value;
		if (v !== NEW) return choose(v);
		(e.target as HTMLSelectElement).value = props.modelValue;
		draft.value = '';
		editing.value = true;
		await nextTick();
		input.value?.focus();
	}

	const select = ref<HTMLSelectElement | null>(null);
	/** Drops the list open (Write to › Add mask); a browser without showPicker, or no user gesture, just focuses it. */
	function open(): void {
		const s = select.value;
		if (!s) return;
		s.focus();
		try {
			s.showPicker();
		} catch {
			// focus is enough
		}
	}
	defineExpose({ open });

	function finish(keep: boolean): void {
		if (!editing.value) return;
		editing.value = false;
		const name = draft.value.trim();
		if (keep && name && name !== props.modelValue) choose(name);
	}
</script>

<template>
	<div class="cf-select">
		<input
			autocomplete="off"
			data-1p-ignore
			v-if="editing"
			ref="input"
			v-model="draft"
			class="name"
			spellcheck="false"
			placeholder="Mask name"
			:aria-label="label ? `${label}: new mask` : 'New mask'"
			@keydown.enter.prevent="finish(true)"
			@keydown.escape.prevent="finish(false)"
			@blur="finish(true)" />
		<template v-else>
			<select
				ref="select"
				:class="{ ringed: modelValue.trim() }"
				:value="modelValue.trim()"
				:aria-label="label"
				@change="onChange">
				<option
					v-for="o in options"
					:key="o.value"
					:value="o.value"
					:style="o.value !== NEW ? { color: colour(o.value) } : undefined">
					{{ o.label }}
				</option>
			</select>
			<span v-if="modelValue.trim()" class="cf-ring" :style="{ color: colour(modelValue.trim()) }" />
			<IconChevronDown class="caret" :size="12" />
		</template>
	</div>
</template>

<style scoped>
	.cf-select {
		position: relative;
		min-width: 0;
	}
	select,
	.name {
		width: 100%;
		height: 22px;
		padding: 0 22px 0 8px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--raised);
		color: var(--text-hi);
		font-size: 12px;
		text-overflow: ellipsis;
	}
	select {
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
	}
	.name {
		padding-right: 8px;
	}
	select:hover,
	.name:hover {
		border-color: var(--line);
	}
	select:focus,
	.name:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--halo);
	}
	option {
		background: var(--panel);
		color: var(--text);
	}
	select.ringed {
		padding-left: 20px;
	}
	.caret {
		position: absolute;
		right: 6px;
		top: 5px;
		pointer-events: none;
		color: var(--text-lo);
	}
</style>
