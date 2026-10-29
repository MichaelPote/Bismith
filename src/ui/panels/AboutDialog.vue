<script setup lang="ts">
	// Help → About: the logo at full size, the app's name and version. Esc, Close or a click outside closes it.
	import { onBeforeUnmount, onMounted, ref } from 'vue';
	import { useEditorStore } from '@/stores/editor';

	const editor = useEditorStore();
	const closeBtn = ref<HTMLButtonElement | null>(null);
	const logoSrc = `${import.meta.env.BASE_URL}logo.png`;
	const version = __APP_VERSION__;

	function close(): void {
		editor.about = false;
	}

	function onKey(e: KeyboardEvent): void {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}

	onMounted(() => {
		window.addEventListener('keydown', onKey, true);
		closeBtn.value?.focus();
	});
	onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
	<div class="about" @pointerdown.self="close">
		<div class="card" role="dialog" aria-modal="true" aria-labelledby="about-name">
			<img :src="logoSrc" width="416" height="416" alt="Bismith logo" />
			<div id="about-name" class="name">Bismith</div>
			<div class="version">Version {{ version }}</div>
			<button ref="closeBtn" type="button" class="fk primary" @click="close">
				<span class="fk-face">Close</span>
			</button>
		</div>
	</div>
</template>

<style scoped>
	.about {
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
		display: flex;
		flex-direction: column;
		align-items: center;
		max-width: 100%;
		max-height: 100%;
		overflow: auto;
		padding: 20px 24px 18px;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		background: var(--panel);
		box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
	}
	img {
		max-width: 100%;
		height: auto;
	}
	.name {
		margin-top: 12px;
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 22px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-hi);
	}
	.version {
		margin-top: 4px;
		font-size: 12px;
		color: var(--text-mid);
	}
	.fk {
		margin-top: 16px;
	}
</style>
