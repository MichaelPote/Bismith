<script setup lang="ts">
	// Every dialog's frame (Cinderforge dialog): a dark base holding a raised plate — a 44px head with the title,
	// a muted readout and a close stud, then the body — and, below the plate, a recessed tray for the action keys:
	// a summary on the left, then game keys (.gk) — the one primary (.gk.primary, underlit) last.
	// The frame handles the backdrop, Esc and first focus; each dialog keeps its own body and its own state.
	import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
	import { IconX } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';
	import { closeModal, isTopModal, openModal } from '@/ui/modals';

	const props = withDefaults(
		defineProps<{
			/** The head's title (or the `title` slot). */
			title?: string;
			/** A muted readout beside the title (the project, the variant…). */
			meta?: string;
			/** The dialog's width, e.g. '760px' (its height follows the content, up to the window). */
			width?: string;
			role?: 'dialog' | 'alertdialog';
			/** A close stud, Esc and a click outside close it; false for a dialog that must run its course. */
			closable?: boolean;
			/** What gets focus when it opens: selectors tried in turn; by default the tray's primary key, else its first. */
			focus?: string;
			describedby?: string;
			/** Work in progress (BusyModal): a progress cursor, and it fades in after a moment unless `instant`. */
			busy?: boolean;
			instant?: boolean;
		}>(),
		{ role: 'dialog', closable: true, focus: '.dlg-tray .gk.primary, .dlg-tray .gk' }
	);
	const emit = defineEmits<{ close: [] }>();

	const titleId = useId();
	const root = ref<HTMLElement | null>(null);
	// (Esc answers only the newest open modal: a question over the Publish dialog…)
	let self: object = {};

	function onKey(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || !isTopModal(self) || !props.closable) return;
		e.preventDefault();
		e.stopPropagation();
		emit('close');
	}
	onMounted(() => {
		self = openModal();
		window.addEventListener('keydown', onKey, true);
		const target = props.focus
			.split(',')
			.map((sel) => root.value?.querySelector<HTMLElement>(`${sel.trim()}:not(:disabled)`))
			.find(Boolean);
		(target ?? root.value)?.focus();
	});
	onBeforeUnmount(() => {
		closeModal(self);
		window.removeEventListener('keydown', onKey, true);
	});
</script>

<template>
	<Teleport to="body">
		<div class="backdrop" :class="{ busy, delayed: busy && !instant }" @pointerdown.self="closable && emit('close')">
			<div
				ref="root"
				class="dlg"
				:role="role"
				aria-modal="true"
				:aria-labelledby="titleId"
				:aria-describedby="describedby"
				:aria-busy="busy || undefined"
				tabindex="-1"
				:style="width ? { width: `min(${width}, 100%)` } : undefined">
				<div class="plate">
					<header class="plate-head">
						<h2 :id="titleId" class="title">
							<slot name="title">{{ title }}</slot>
						</h2>
						<span v-if="meta" class="meta cf-mono">{{ meta }}</span>
						<slot name="head" />
						<button
							v-if="closable"
							v-tip:left="{ body: 'Close', keys: 'Esc' }"
							type="button"
							class="cf-ico-btn close"
							aria-label="Close"
							@click="emit('close')">
							<IconX :size="14" />
						</button>
					</header>
					<div class="plate-body">
						<slot />
					</div>
				</div>
				<footer v-if="$slots.tray" class="dlg-tray">
					<slot name="tray" />
				</footer>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: rgba(17, 19, 22, 0.72);
	}
	.backdrop.busy {
		cursor: progress;
	}
	/* Quick work doesn't flash it: input is blocked at once, the dialog shows after 250 ms. */
	.backdrop.delayed {
		animation: dlg-in 160ms ease-out 250ms both;
	}
	@keyframes dlg-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	/* The base: darker than the plate, its lower part the tray. */
	.dlg {
		display: flex;
		flex-direction: column;
		max-width: 100%;
		max-height: 100%;
		border-radius: 8px;
		background: linear-gradient(180deg, #1c1f22 0%, #1a1d20 100%);
		box-shadow:
			inset 0 0 0 1px #0d0f11,
			inset 0 -1px 0 rgba(255, 255, 255, 0.04),
			0 4px 8px rgba(0, 0, 0, 0.5),
			0 1px 2px rgba(0, 0, 0, 0.4),
			0 18px 48px rgba(0, 0, 0, 0.45);
		color: var(--text);
		outline: none;
	}
	/* The plate: the dialog's face, raised over the base; its shadow falls into the tray. */
	.plate {
		position: relative;
		z-index: 1;
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-radius: 6px;
		background: linear-gradient(180deg, #252a2e 0%, #23272a 100%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			inset 0 -1px 0 rgba(0, 0, 0, 0.3),
			0 0 0 1px #0d0f11,
			0 2px 3px rgba(0, 0, 0, 0.5),
			0 1px 1px rgba(0, 0, 0, 0.4);
	}
	.plate-head {
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 8px 0 16px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		color: var(--text-hi);
		white-space: nowrap;
	}
	.meta {
		min-width: 0;
		font-size: 12px;
		color: var(--text-lo);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.close {
		margin-left: auto;
	}
	.plate-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	/* The tray: a summary, then the keys, primary last. */
	.dlg-tray {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px 12px;
		font-size: 12px;
		color: var(--text-mid);
	}
	.dlg-tray :slotted(.grow) {
		flex: 1;
	}
</style>
