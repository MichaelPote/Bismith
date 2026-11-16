<script setup lang="ts">
	// The terms of use, on a first visit (ui/terms.ts): no close stud, Esc or click outside — the editor stays behind it
	// until I Agree. The full licence is in Help → About.
	import DialogFrame from '@/ui/components/DialogFrame.vue';

	const emit = defineEmits<{ agree: [] }>();
	const logoSrc = `${import.meta.env.BASE_URL}logo-64.png`;
</script>

<template>
	<DialogFrame title="Terms of use" width="480px" role="alertdialog" :closable="false" describedby="terms-text">
		<div id="terms-text" class="body">
			<img :src="logoSrc" width="64" height="64" alt="" />
			<p>
				<strong>Bismith is free, and its source code is open.</strong> You may not sell Bismith, or charge anyone money
				to use it.
			</p>
			<p>
				<strong>What you make with Bismith is yours.</strong> You may use, change, distribute and sell your output for
				any purpose, commercial or not, without attribution.
			</p>
		</div>
		<template #tray>
			<span>The full licence is in Help › About.</span>
			<span class="grow" />
			<button type="button" class="gk primary" @click="emit('agree')"><span class="gk-face">I Agree</span></button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 8px 28px 22px;
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-mid);
		text-align: center;
	}
	img {
		margin-bottom: 2px;
	}
	p {
		margin: 0;
	}
	strong {
		color: var(--text-hi);
		font-weight: 500;
	}
</style>
