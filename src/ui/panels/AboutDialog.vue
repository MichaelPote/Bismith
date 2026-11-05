<script setup lang="ts">
	// Help → About: the logo at full size, the app's name and version. Esc, Close or a click outside closes it.
	import { useEditorStore } from '@/stores/editor';
	import DialogFrame from '@/ui/components/DialogFrame.vue';

	const editor = useEditorStore();
	const logoSrc = `${import.meta.env.BASE_URL}logo.png`;
	const version = __APP_VERSION__;

	function close(): void {
		editor.about = false;
	}
</script>

<template>
	<DialogFrame title="About" width="464px" @close="close">
		<div class="body">
			<img :src="logoSrc" width="416" height="416" alt="Bismith logo" />
			<div class="name">Bismith</div>
		</div>
		<template #tray>
			<span class="cf-mono version">Version {{ version }}</span>
			<span class="grow" />
			<button type="button" class="gk primary" @click="close"><span class="gk-face">Close</span></button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.body {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 0;
		overflow: auto;
		padding: 0 24px 18px;
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
		color: var(--readout);
	}
</style>
