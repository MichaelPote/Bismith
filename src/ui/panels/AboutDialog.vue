<script setup lang="ts">
	// Help → About: the logo, the app's name and version, what the licence allows (in plain words, with the full
	// LICENSE text folded away below) and the credits for the palettes, model weights, fonts and libraries Bismith ships.
	// Esc, Close or a click outside closes it.
	import { IconChevronRight } from '@tabler/icons-vue';
	import { useEditorStore } from '@/stores/editor';
	import DialogFrame from '@/ui/components/DialogFrame.vue';
	import licenceText from '../../../LICENSE?raw';

	const editor = useEditorStore();
	const logoSrc = `${import.meta.env.BASE_URL}logo.png`;
	const version = __APP_VERSION__;
	// The LICENSE file is wrapped for a terminal; the dialog reflows each paragraph. Only a long line was wrapped: a
	// short one keeps its break (the Software / License / Licensor lines).
	const licence = licenceText
		.trim()
		.split(/\n\s*\n/)
		.map((p) => p.replace(/([^\n]{60,})\n\s*/g, '$1 '));

	function close(): void {
		editor.about = false;
	}
</script>

<template>
	<DialogFrame title="About" width="520px" @close="close">
		<div class="body">
			<img :src="logoSrc" width="240" height="240" alt="Bismith logo" />
			<div class="name">Bismith</div>
			<div class="cf-mono copy">© 2026 Michael Pote</div>

			<section>
				<h3 class="cf-label">Licence</h3>
				<p>
					<strong>Textures you make with Bismith are yours.</strong> Use them in anything (games, mods, films,
					products), commercial or not, with no fee and no credit needed.
				</p>
				<p>
					Bismith itself is free. Its source code may be used, copied, changed and shared under the MIT licence with the
					Commons Clause, so Bismith may not be sold or offered as a paid service.
				</p>
				<details>
					<summary><IconChevronRight :size="13" class="chev" />Full licence</summary>
					<div class="licence">
						<p v-for="(para, i) in licence" :key="i">{{ para }}</p>
					</div>
				</details>
			</section>

			<section>
				<h3 class="cf-label">Credits</h3>
				<ul>
					<li>
						<strong>Quake palette</strong>: id Software's <span class="cf-mono">gfx/palette.lmp</span>, which John
						Carmack has said can be considered public domain.
					</li>
					<li><strong>Doom palette</strong>: the first PLAYPAL palette of Doom (1993) by id Software.</li>
					<li>
						<strong>Other palettes</strong>: PICO-8 (Lexaloffle), Commodore 64 (Philip “Pepto” Timmermann), Sweetie 16
						by GrafxKid.
					</li>
					<li>
						<strong>VGG-19</strong> weights for the texture metric: K. Simonyan and A. Zisserman, Visual Geometry Group,
						University of Oxford,
						<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
					</li>
					<li>
						<strong>Fonts</strong>: IBM Plex Sans, IBM Plex Mono and Cormorant Garamond, under the SIL Open Font
						License.
					</li>
					<li>
						<strong>Libraries</strong>: Vue, Pinia, three.js, Tippy.js, Tabler Icons and gainmap-js, under the MIT
						licence.
					</li>
				</ul>
				<p class="fine">
					Quake and Doom are trademarks of id Software. Bismith is not affiliated with or endorsed by id Software.
				</p>
			</section>
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
		padding: 4px 24px 20px;
	}
	img {
		max-width: 100%;
		height: auto;
	}
	.name {
		margin-top: 8px;
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 22px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-hi);
	}
	.copy {
		margin-top: 2px;
		font-size: 11px;
		color: var(--readout);
	}
	section {
		align-self: stretch;
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--hairline);
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-mid);
	}
	h3 {
		margin: 0 0 8px;
	}
	p {
		margin: 0 0 8px;
	}
	strong {
		color: var(--text-hi);
		font-weight: 500;
	}
	ul {
		margin: 0 0 8px;
		padding-left: 16px;
	}
	li {
		margin-bottom: 4px;
	}
	.fine {
		margin: 0;
		font-size: 11px;
		color: var(--text-lo);
	}
	summary {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		list-style: none;
		cursor: pointer;
		color: var(--text-mid);
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		color: var(--text-hi);
	}
	.chev {
		transition: transform 120ms ease-out;
	}
	details[open] .chev {
		transform: rotate(90deg);
	}
	.licence {
		margin-top: 8px;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: 3px;
		background: var(--sunken);
		font-size: 11px;
		color: var(--text-lo);
	}
	.licence p {
		white-space: pre-line;
	}
	.licence p:last-child {
		margin-bottom: 0;
	}
	.version {
		color: var(--readout);
	}
</style>
