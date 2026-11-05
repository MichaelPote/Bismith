<script setup lang="ts">
	// File › Publish to gallery (src/gallery): the renders of the project's variants (already made, editor.publishDialog;
	// a click picks the cover), its name, author and description, then Publish — or Update / Remove when this browser
	// holds the edit key of the gallery entry the project came from. Done shows the project's gallery link. Not teleported:
	// App.vue mounts it before the Ask modal, which Remove's question must cover.
	import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
	import { IconCopy, IconExternalLink, IconKey, IconStack2, IconTrash, IconUpload } from '@tabler/icons-vue';
	import DialogFrame from '@/ui/components/DialogFrame.vue';
	import { useEditorStore } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';
	import { useActions } from '@/ui/actions';
	import {
		editKey,
		GalleryError,
		lastAuthor,
		MAX_AUTHOR,
		MAX_DESCRIPTION,
		MAX_NAME,
		MAX_VARIANTS,
		projectPageUrl,
		publish,
		quota,
		remove,
		update,
		type Published
	} from '@/gallery/client';

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();

	const renders = editor.publishDialog?.renders ?? [];
	const urls = renders.map((r) => URL.createObjectURL(r.thumb));
	const cover = ref(0);
	const truncated = store.variants.list.length > MAX_VARIANTS;

	const name = ref(store.project.name === 'Untitled' ? '' : store.project.name);
	const author = ref(lastAuthor());
	const description = ref(store.project.description ?? '');

	// Update the gallery entry this project came from, when this browser published it (holds its key).
	const galleryId = store.project.gallery?.id;
	const held = ref(!!editKey(galleryId));
	const mode = ref<'update' | 'new'>(held.value ? 'update' : 'new');
	const updating = computed(() => held.value && mode.value === 'update');

	const used = ref<{ published: number; limit: number } | null>(null);
	const working = ref(false);
	const error = ref('');
	const duplicateOf = ref<string | null>(null);
	const done = ref<Published | null>(null);

	const quotaText = computed(() => {
		if (updating.value) return 'Updates don’t count toward your limit';
		if (!used.value) return '';
		return `${used.value.published} of ${used.value.limit} published from this browser`;
	});

	function close(): void {
		if (!working.value) editor.publishDialog = null;
	}

	async function submit(): Promise<void> {
		const n = name.value.trim();
		if (!n || working.value) return;
		working.value = true;
		error.value = '';
		duplicateOf.value = null;
		try {
			// The name and description are the project's own: the dialog edits them.
			store.project.name = n;
			const d = description.value.trim();
			if (d) store.project.description = d;
			else delete store.project.description;
			store.commitNow();
			const ordered = [renders[cover.value], ...renders.filter((_, i) => i !== cover.value)];
			const sub = {
				project: act.projectFile(),
				name: n,
				description: d,
				author: author.value.trim(),
				renders: ordered
			};
			const r = updating.value && galleryId ? await update(galleryId, sub) : await publish(sub);
			store.project.gallery = { id: r.id };
			store.commitNow();
			done.value = r;
		} catch (e) {
			if (e instanceof GalleryError) {
				error.value = e.message;
				if (e.code === 'duplicate' && e.id) duplicateOf.value = e.id;
				if (updating.value && (e.status === 404 || e.status === 403)) {
					held.value = false;
					mode.value = 'new';
					error.value = 'That gallery entry is gone, or this browser’s key no longer fits it. Publish it as new.';
				}
			} else error.value = e instanceof Error ? e.message : String(e);
		} finally {
			working.value = false;
		}
	}

	async function removeIt(): Promise<void> {
		if (!galleryId || working.value) return;
		const go = await editor.ask({
			title: 'Remove it from the gallery?',
			detail: 'Its page, renders and stars are deleted. Your project stays as it is.',
			choices: [{ id: 'remove', label: 'Remove', primary: true }]
		});
		if (go !== 'remove') return;
		working.value = true;
		error.value = '';
		try {
			await remove(galleryId);
			delete store.project.gallery;
			store.commitNow();
			editor.notify('Removed from the gallery');
			working.value = false;
			close();
		} catch (e) {
			error.value = e instanceof Error ? e.message : String(e);
			working.value = false;
		}
	}

	async function copyLink(): Promise<void> {
		if (!done.value) return;
		try {
			await navigator.clipboard.writeText(projectPageUrl(done.value.id));
			editor.notify('Link copied');
		} catch {
			editor.notify('Clipboard is not available here', 'error');
		}
	}

	/** The form's id: the tray's Publish key submits it from outside. */
	const formId = useId();
	onMounted(async () => {
		used.value = await quota().catch(() => null);
	});
	onBeforeUnmount(() => urls.forEach((u) => URL.revokeObjectURL(u)));
</script>

<template>
	<DialogFrame
		:title="done ? 'Published' : updating ? 'Update in gallery' : 'Publish to gallery'"
		meta="bismith gallery"
		width="820px"
		:closable="!working"
		focus="input"
		@close="close">
		<div v-if="done" class="done">
			<p>
				<strong>{{ name }}</strong> is in the gallery. This browser keeps its edit key: publish again from here to
				update it.
			</p>
			<div class="link">
				<span class="cf-mono">{{ projectPageUrl(done.id) }}</span>
				<button type="button" class="cf-ico-btn" aria-label="Copy link" @click="copyLink">
					<IconCopy :size="14" />
				</button>
			</div>
		</div>

		<form v-else :id="formId" class="body" @submit.prevent="submit">
			<div class="renders plate-well">
				<div class="sub">
					<span class="cf-label">{{ renders.length > 1 ? 'Variants' : 'Gallery image' }}</span>
					<span class="n cf-mono">{{ renders.length > 1 ? `${renders.length} · cover first` : '1024 px' }}</span>
				</div>
				<img class="cover" :src="urls[cover]" alt="The cover render" />
				<div v-if="renders.length > 1" class="strip" role="group" aria-label="Choose the cover">
					<button
						v-for="(r, i) in renders"
						:key="i"
						type="button"
						class="pick"
						:class="{ on: i === cover }"
						:aria-pressed="i === cover"
						:title="`Use ${r.name} as the cover`"
						@click="cover = i">
						<img :src="urls[i]" alt="" />
						<span>{{ r.name }}</span>
					</button>
				</div>
				<p v-if="truncated" class="lo">The gallery shows the first {{ MAX_VARIANTS }} variants.</p>
			</div>

			<div class="fields">
				<div v-if="held" class="modes" role="group" aria-label="Publish as">
					<button type="button" class="fk" :class="{ lit: mode === 'update' }" @click="mode = 'update'">
						<span class="fk-face">Update the published one</span>
					</button>
					<button type="button" class="fk" :class="{ lit: mode === 'new' }" @click="mode = 'new'">
						<span class="fk-face">Publish as new</span>
					</button>
				</div>
				<label>
					<span class="cf-label">Name</span>
					<input v-model="name" class="cf-field" :maxlength="MAX_NAME" required autocomplete="off" data-1p-ignore />
				</label>
				<label>
					<span class="cf-label">Author <span class="hint">optional, shown publicly</span></span>
					<input v-model="author" class="cf-field" :maxlength="MAX_AUTHOR" autocomplete="off" data-1p-ignore />
				</label>
				<label>
					<span class="cf-label">Description</span>
					<textarea
						v-model="description"
						class="cf-field"
						rows="5"
						:maxlength="MAX_DESCRIPTION"
						autocomplete="off"
						data-1p-ignore />
				</label>
				<div class="note">
					<IconKey :size="14" class="note-ico" />
					<span v-if="updating">
						This browser holds the edit key for this project. Updating replaces its file, renders and text; its stars
						are kept.
					</span>
					<span v-else>
						Anyone can open the project and copy it. The gallery gives this browser an edit key so you can update or
						remove it later. The same layer stack can only be published once.
					</span>
				</div>
				<p v-if="error" class="err" role="alert">
					{{ error }}
					<a v-if="duplicateOf" :href="projectPageUrl(duplicateOf)" target="_blank" rel="noopener">See it</a>
				</p>
			</div>
		</form>

		<template v-if="done" #tray>
			<span class="grow" />
			<button type="button" class="gk" @click="close"><span class="gk-face">Close</span></button>
			<a :href="projectPageUrl(done.id)" target="_blank" rel="noopener" class="gk primary"
				><span class="gk-face"><IconExternalLink :size="13" />View in gallery</span></a
			>
		</template>
		<template v-else #tray>
			<span>{{ quotaText }}</span>
			<span class="grow" />
			<button v-if="held" type="button" class="gk danger" :disabled="working" @click="removeIt">
				<span class="gk-face"><IconTrash :size="13" />Remove</span>
			</button>
			<button type="button" class="gk" :disabled="working" @click="close">
				<span class="gk-face">Cancel</span>
			</button>
			<button type="submit" :form="formId" class="gk primary" :disabled="working || !name.trim()">
				<span class="gk-face"
					><component :is="updating ? IconStack2 : IconUpload" :size="13" />{{
						working ? 'Uploading…' : updating ? 'Update' : 'Publish'
					}}</span
				>
			</button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.grow {
		flex: 1;
	}
	.body {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		gap: 16px;
		min-height: 0;
		overflow: auto;
		padding: 2px 16px 16px;
	}
	.renders {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 12px 12px;
	}
	.sub {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.n {
		font-size: 11px;
		color: var(--readout);
	}
	.cover {
		display: block;
		width: 100%;
		aspect-ratio: 1 / 1;
		object-fit: contain;
		background: var(--deep);
		border: 1px solid var(--hairline);
	}
	.strip {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 6px;
	}
	.pick {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 2px;
		border: 1px solid var(--hairline);
		border-radius: 3px;
		background: transparent;
		color: var(--text-mid);
		font-size: 11px;
		cursor: pointer;
	}
	.pick:hover {
		border-color: var(--line-strong);
		color: var(--text-hi);
	}
	.pick.on {
		border-color: var(--accent);
		color: var(--text-hi);
		box-shadow: var(--glow);
	}
	.pick img {
		display: block;
		width: 100%;
		aspect-ratio: 1 / 1;
		object-fit: cover;
	}
	.pick span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 4px;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fields .cf-field {
		width: 100%;
	}
	textarea.cf-field {
		height: auto;
		padding: 4px 8px;
		resize: vertical;
		font: inherit;
		font-size: 12px;
		line-height: 1.45;
	}
	.hint {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.modes {
		display: flex;
		gap: 3px;
	}
	.modes .fk-face {
		padding: 0 10px;
		font-size: 12px;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid var(--hairline);
		border-radius: 3px;
		background: var(--base);
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-mid);
	}
	.note-ico {
		flex: none;
		margin-top: 1px;
		color: var(--pill);
	}
	.err {
		margin: 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--blood);
	}
	.lo {
		margin: 0;
		font-size: 12px;
		color: var(--text-mid);
	}
	.done {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 28px 24px 24px;
		text-align: center;
	}
	.done p {
		margin: 0;
		max-width: 460px;
		line-height: 1.5;
		color: var(--text-mid);
	}
	.done strong {
		color: var(--text-hi);
		font-weight: 500;
	}
	.link {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 4px 0 10px;
		border: 1px solid var(--hairline);
		border-radius: 3px;
		background: var(--sunken);
		font-size: 12px;
		color: var(--readout);
	}
	@media (max-width: 640px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
		.renders {
			border-right: 0;
			border-bottom: 1px solid var(--hairline);
		}
	}
</style>
