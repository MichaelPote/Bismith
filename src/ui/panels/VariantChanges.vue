<script setup lang="ts">
	// A variant's Changes dialog (docs/features/fr10-variants.md), from its right-click menu: its name and note, and
	// every setting it changes from the base — or from any other variant — as from → to rows, each with a reset to the
	// other's value. Edits apply at once (each an undo step).
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { IconArrowBackUp, IconX } from '@tabler/icons-vue';
	import type { ParamDef, ParamValue } from '@/core/params';
	import type { Project } from '@/core/project';
	import { LIGHT_DEFS } from '@/core/lights';
	import { AMBIENT_DEFS, BASE_DEFS, PROJECT_DEFS, RENDER_DEFS, SKY_DEFS } from '@/core/settingsDefs';
	import * as V from '@/core/variants';
	import { layerParamDefs } from '@/layers/registry';
	import { getPostDef } from '@/render/post/registry';
	import { useEditorStore } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';
	import SelectField from '@/ui/components/SelectField.vue';
	import { vTip } from '@/ui/tooltip';

	const store = useProjectStore();
	const editor = useEditorStore();

	const id = computed(() => editor.variantChanges ?? '');
	const variant = computed(() => store.variants.list.find((v) => v.id === id.value));
	const others = computed(() => store.variants.list.filter((v) => v.id !== id.value));
	/** Compared with: the base, or the first other variant when this is the base. */
	const against = ref('');
	watch(
		id,
		() => {
			const vs = store.variants;
			against.value = id.value === vs.baseId ? (others.value[0]?.id ?? '') : vs.baseId;
		},
		{ immediate: true }
	);
	const compareOptions = computed(() =>
		others.value.map((v) => ({ value: v.id, label: v.id === store.variants.baseId ? `${v.name} (base)` : v.name }))
	);

	// ---------------------------------------------------------------- the changes
	/** A copy of the project with its variants synced (reading it deeply, so the list follows every edit). */
	const synced = computed<Project>(() => {
		const p = JSON.parse(JSON.stringify(store.project)) as Project;
		V.syncVariants(p);
		return p;
	});

	interface Row {
		key: string;
		label: string;
		from: Shown;
		to: Shown;
		value: ParamValue;
	}
	interface Shown {
		text: string;
		swatch?: string;
	}

	function describe(p: Project, key: string): { group: string; label: string; def?: ParamDef } {
		const m = /^(layer|light|post|group)\.([^.]+)\.(?:on|p\.(.+))$/.exec(key);
		const pick = (defs: ParamDef[] | undefined, k: string) => defs?.find((d) => d.key === k);
		if (m) {
			const [, kind, itemId, param] = m;
			if (kind === 'layer') {
				const l = p.layers.find((x) => x.id === itemId);
				const def = param && l ? pick(layerParamDefs(l.type), param) : undefined;
				return { group: l?.name ?? 'Layer', label: param ? (def?.label ?? param) : 'Shown', def };
			}
			if (kind === 'light') {
				const l = p.lighting.lights.find((x) => x.id === itemId);
				const def = param && l ? pick(LIGHT_DEFS[l.type].params, param) : undefined;
				return { group: l?.name ?? 'Light', label: param ? (def?.label ?? param) : 'On', def };
			}
			if (kind === 'post') {
				const f = p.post.find((x) => x.id === itemId);
				const pd = f ? getPostDef(f.type) : undefined;
				const def = param ? pick(pd?.params, param) : undefined;
				return { group: pd?.label ?? 'Post', label: param ? (def?.label ?? param) : 'On', def };
			}
			return { group: p.groups?.find((g) => g.id === itemId)?.name ?? 'Group', label: 'Shown' };
		}
		const [head, rest] = key.split('.', 2) as [string, string | undefined];
		const table: Record<string, [string, ParamDef[]]> = {
			base: ['Base material', BASE_DEFS],
			sky: ['Sky light', SKY_DEFS],
			ambient: ['Ambient', AMBIENT_DEFS],
			render: ['Path tracer', RENDER_DEFS]
		};
		if (rest && table[head]) {
			const def = pick(table[head][1], rest);
			return { group: table[head][0], label: def?.label ?? rest, def };
		}
		const def = pick(PROJECT_DEFS, key);
		return { group: 'Canvas', label: def?.label ?? key, def };
	}

	function show(v: ParamValue | undefined, def?: ParamDef): Shown {
		if (v === undefined) return { text: '—' };
		if (typeof v === 'boolean') return { text: v ? 'on' : 'off' };
		if (typeof v === 'number') {
			const t = def?.type === 'int' || def?.type === 'seed' ? String(Math.round(v)) : String(Number(v.toFixed(3)));
			return { text: def?.unit ? `${t} ${def.unit}` : t };
		}
		if (typeof v === 'string') {
			if (/^#[0-9a-f]{6}$/i.test(v)) return { text: v.slice(1), swatch: v };
			const opt = def?.options?.find((o) => o.value === v);
			return { text: opt?.label ?? (v.length > 24 ? `${v.slice(0, 23)}…` : v || '—') };
		}
		return { text: def?.type === 'curve' ? 'curve' : 'gradient' };
	}

	const groups = computed(() => {
		const p = synced.value;
		if (!variant.value || !against.value) return [];
		const mine = V.variantSettings(p, id.value);
		const theirs = V.variantSettings(p, against.value);
		const out = new Map<string, Row[]>();
		for (const key of Object.keys(mine)) {
			if (!(key in theirs) || JSON.stringify(mine[key]) === JSON.stringify(theirs[key])) continue;
			const d = describe(p, key);
			if (!out.has(d.group)) out.set(d.group, []);
			out.get(d.group)!.push({
				key,
				label: d.label,
				from: show(theirs[key], d.def),
				to: show(mine[key], d.def),
				value: theirs[key]
			});
		}
		return [...out].map(([title, rows]) => ({ title, rows }));
	});
	const total = computed(() => groups.value.reduce((n, g) => n + g.rows.length, 0));
	const againstName = computed(() => others.value.find((v) => v.id === against.value)?.name ?? '');

	function reset(row: Row): void {
		store.setVariantValues(id.value, { [row.key]: row.value });
	}

	function resetAll(): void {
		const s: V.Settings = {};
		for (const g of groups.value) for (const r of g.rows) s[r.key] = r.value;
		store.setVariantValues(id.value, s);
	}

	// ---------------------------------------------------------------- name, note
	const nameText = ref('');
	watch(variant, (v) => v && (nameText.value = v.name), { immediate: true });
	function commitName(): void {
		if (variant.value && nameText.value.trim() && nameText.value !== variant.value.name)
			store.renameVariant(id.value, nameText.value);
		nameText.value = variant.value?.name ?? '';
	}

	// ---------------------------------------------------------------- open / close
	const dialog = ref<HTMLElement | null>(null);
	function close(): void {
		commitName();
		editor.variantChanges = null;
	}
	function onKey(e: KeyboardEvent): void {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}
	// A deleted variant closes it.
	watch(variant, (v) => !v && (editor.variantChanges = null));
	onMounted(async () => {
		window.addEventListener('keydown', onKey, true);
		await nextTick();
		dialog.value?.querySelector<HTMLElement>('textarea')?.focus();
	});
	onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
	<Teleport to="body">
		<div class="backdrop" @pointerdown.self="close">
			<div v-if="variant" ref="dialog" class="dlg" role="dialog" aria-modal="true" aria-labelledby="changes-title">
				<header class="head">
					<h2 id="changes-title">Changes</h2>
					<span class="kind">{{ variant.name }}</span>
					<span class="grow" />
					<button
						v-tip:left="{ body: 'Close', keys: 'Esc' }"
						type="button"
						class="cf-ico-btn"
						aria-label="Close"
						@click="close">
						<IconX :size="16" />
					</button>
				</header>
				<div class="fields">
					<label>
						<span class="cf-label">Name</span>
						<input
							autocomplete="off"
							data-1p-ignore
							v-model="nameText"
							class="cf-field"
							@change="commitName"
							@keydown.enter="commitName" />
					</label>
					<label>
						<span class="cf-label">Note</span>
						<textarea
							class="cf-field"
							rows="2"
							:value="variant.note ?? ''"
							placeholder="What this variant is for"
							@input="store.setVariantNote(id, ($event.target as HTMLTextAreaElement).value)" />
					</label>
					<div class="against">
						<span class="lo">Compared with</span>
						<SelectField v-model="against" :options="compareOptions" label="Compared with" />
					</div>
				</div>
				<div class="list">
					<p v-if="!total" class="empty">No settings differ from {{ againstName }}.</p>
					<section v-for="g in groups" :key="g.title">
						<div class="sec cf-label">{{ g.title }}</div>
						<div v-for="r in g.rows" :key="r.key" class="row">
							<span class="what">{{ r.label }}</span>
							<span class="vals cf-mono">
								<i v-if="r.from.swatch" class="sw" :style="{ background: r.from.swatch }" />
								<span class="from">{{ r.from.text }}</span>
								<span class="arrow">→</span>
								<i v-if="r.to.swatch" class="sw" :style="{ background: r.to.swatch }" />
								<span class="to">{{ r.to.text }}</span>
							</span>
							<button
								v-tip:left="`Back to ${againstName}'s value`"
								type="button"
								class="cf-ico-btn"
								:aria-label="`Reset ${r.label} to ${againstName}'s value`"
								@click="reset(r)">
								<IconArrowBackUp :size="14" />
							</button>
						</div>
					</section>
				</div>
				<footer class="foot">
					<span class="lo">{{ total === 1 ? '1 setting differs' : `${total} settings differ` }}</span>
					<span class="grow" />
					<button type="button" class="fk" :disabled="!total" @click="resetAll">
						<span class="fk-face">Reset all to {{ againstName }}</span>
					</button>
					<button type="button" class="fk primary" @click="close">
						<span class="fk-face">Close</span>
					</button>
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
	.dlg {
		display: flex;
		flex-direction: column;
		width: min(560px, 100%);
		max-height: 100%;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 4px;
		box-shadow: 0 18px 48px rgba(8, 9, 10, 0.6);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 14px 10px 18px;
		border-bottom: 1px solid var(--hairline);
	}
	h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 20px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-hi);
	}
	.kind {
		font-size: 12px;
		color: var(--text-lo);
	}
	.grow {
		flex: 1;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 18px;
		border-bottom: 1px solid var(--hairline);
	}
	.fields label {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		align-items: start;
		gap: 10px;
	}
	.fields .cf-label {
		padding-top: 5px;
	}
	textarea.cf-field {
		resize: vertical;
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
		padding: 4px 8px;
	}
	.against {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.lo {
		font-size: 12px;
		color: var(--text-lo);
	}
	.list {
		flex: 1;
		min-height: 120px;
		overflow-y: auto;
		padding: 6px 0 10px;
	}
	.empty {
		margin: 16px 18px;
		font-size: 12px;
		color: var(--text-lo);
	}
	.sec {
		padding: 8px 18px 2px;
	}
	.row {
		display: grid;
		grid-template-columns: 150px minmax(0, 1fr) 24px;
		align-items: center;
		gap: 8px;
		min-height: 26px;
		padding: 0 12px 0 30px;
	}
	.row:hover {
		background: var(--raised);
	}
	.what {
		font-size: 12px;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.vals {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
	}
	.sw {
		width: 9px;
		height: 9px;
		flex: none;
		border-radius: 2px;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
	}
	.from {
		color: var(--text-lo);
	}
	.arrow {
		color: var(--line-strong);
	}
	.to {
		color: var(--accent-hi);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px 12px 18px;
		border-top: 1px solid var(--hairline);
	}
</style>
