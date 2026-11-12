<script setup lang="ts">
	// The Properties panel's heading for the selection: its icon (or the `icon` slot), its name — a field when
	// `nameLabel` is given — and its on / off tick; for a layer, group, light or post filter (`item`) a line of its type
	// (the `sub` slot) and its action studs, and its Presets key beside the description.
	import { nextTick, type Component } from 'vue';
	import type { ItemKind } from '@/ui/itemActions';
	import ItemStuds from '@/ui/components/ItemStuds.vue';
	import PresetMenu from '@/ui/components/PresetMenu.vue';
	import { vTip } from '@/ui/tooltip';

	const props = defineProps<{
		name: string;
		/** The name field's label; without one the name is plain text. */
		nameLabel?: string;
		icon?: Component;
		iconColor?: string;
		/** The on / off tick: its state, label and tooltip (without one, its title says Enabled). */
		toggle?: { on: boolean; label: string; tip?: string };
		item?: { kind: ItemKind; id: string };
		/** The presets offered (PresetMenu's target): the item's type. */
		presetTarget?: string;
		description?: string;
	}>();
	const emit = defineEmits<{ rename: [name: string]; toggle: [on: boolean] }>();

	/** The store may keep another name than the one typed (an empty one goes back to the type's): the field shows it. */
	async function onRename(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		emit('rename', input.value);
		await nextTick();
		input.value = props.name;
	}
</script>

<template>
	<div class="title">
		<slot name="icon"><component :is="icon" v-if="icon" :size="15" :color="iconColor" /></slot>
		<input
			v-if="nameLabel"
			autocomplete="off"
			data-1p-ignore
			class="name"
			:value="name"
			:aria-label="nameLabel"
			@change="onRename" />
		<span v-else class="name static">{{ name }}</span>
		<label v-if="toggle" v-tip="toggle.tip" class="en" :title="toggle.tip ? undefined : 'Enabled'">
			<input
				type="checkbox"
				:checked="toggle.on"
				:aria-label="toggle.label"
				@change="emit('toggle', ($event.target as HTMLInputElement).checked)" />
		</label>
	</div>
	<template v-if="item">
		<div class="sub">
			<slot name="sub" />
			<span class="grow" />
			<ItemStuds :kind="item.kind" :id="item.id" />
		</div>
		<div class="desc-row">
			<p class="desc">{{ description }}</p>
			<PresetMenu :kind="item.kind" :target="presetTarget" :source="item" />
		</div>
	</template>
	<p v-else class="desc">{{ description }}</p>
</template>

<style scoped>
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 8px 0 10px;
		border-bottom: 1px solid var(--hairline);
		flex: none;
	}
	.name {
		flex: 1;
		min-width: 0;
		height: 24px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		padding: 0 8px;
		font-size: 13px;
		font-weight: 500;
	}
	.name:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--halo);
	}
	.name.static {
		border-color: transparent;
		background: transparent;
		display: flex;
		align-items: center;
	}
	.en input {
		width: 14px;
		height: 14px;
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 6px 0 10px;
		flex: none;
	}
	.grow {
		flex: 1;
	}
	.desc {
		margin: 0;
		padding: 0 10px 8px;
		font-size: 12px;
		color: var(--text-lo);
		line-height: 1.4;
		flex: none;
	}
	.title + .desc {
		padding-top: 8px;
	}
	/* The description, with the item's Presets key at its bottom right. */
	.desc-row {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		padding: 0 10px 8px;
		flex: none;
	}
	.desc-row .desc {
		flex: 1;
		min-width: 0;
		padding: 0;
	}
</style>
