<script setup lang="ts">
	// Properties of the current selection, generated from ParamDefs and grouped into collapsible cards.
	import { computed } from 'vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry';
	import { SHAPE_MASK, layerLimit, limitParams, maskChain, maskChainLabel, masksAbove } from '@/layers/masks';
	import { LIMIT_PARAMS } from '@/layers/commonParams';
	import { getPostDef } from '@/render/post/registry';
	import { LIGHT_DEFS, POINT_LIGHT_REF_DIST } from '@/core/lights';
	import { BASE_DEFS, PROJECT_DEFS, RENDER_DEFS } from '@/core/settingsDefs';
	import { P, type ParamDef, type ParamValue, type ParamValues } from '@/core/params';
	import { layerUnits, SIZE_PRESETS } from '@/core/project';
	import { cardIcon, layerHue, layerIcon, LIGHT_HUE, POST_HUE } from '@/ui/meta';
	import { useActions } from '@/ui/actions';
	import PanelCard from '@/ui/components/PanelCard.vue';
	import ParamList from '@/ui/components/ParamList.vue';
	import ShapingGraph from '@/ui/components/ShapingGraph.vue';
	import {
		IconArrowDown,
		IconArrowUp,
		IconBox,
		IconBulb,
		IconCopy,
		IconLock,
		IconLockOpen,
		IconSparkles,
		IconSquareRotated,
		IconStack2,
		IconSun,
		IconTrash
	} from '@tabler/icons-vue';
	import PostExtras from '@/ui/panels/PostExtras.vue';
	import { getRecipe } from '@/recipes';
	import LightingPresets from '@/ui/panels/LightingPresets.vue';
	import PresetMenu from '@/ui/components/PresetMenu.vue';
	import { vTip } from '@/ui/tooltip';

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();

	const sel = computed(() => editor.selection);
	const layer = computed(() => (sel.value.kind === 'layer' && sel.value.id ? store.getLayer(sel.value.id) : undefined));
	const layerDef = computed(() => (layer.value ? getLayerDef(layer.value.type) : undefined));
	const layerDefs = computed(() => (layer.value ? layerParamDefs(layer.value.type) : []));
	/** Height › Amount and Offset, mirrored under the Shaping › Value graph (the same params, edited from either card). */
	const heightMirror = computed<ParamDef[]>(() =>
		['h_amount', 'h_offset'].flatMap((k) => {
			const d = layerDefs.value.find((x) => x.key === k);
			if (!d) return [];
			return [
				{
					...d,
					label: k === 'h_amount' ? 'Height' : d.label,
					hint: `${d.hint} (the same control as in the Height card)`
				}
			];
		})
	);
	const light = computed(() => (sel.value.kind === 'light' && sel.value.id ? store.getLight(sel.value.id) : undefined));
	const post = computed(() => (sel.value.kind === 'post' && sel.value.id ? store.getPost(sel.value.id) : undefined));
	const postDef = computed(() => (post.value ? getPostDef(post.value.type) : undefined));

	// Smart materials (recipes as a few controls over ordinary layers).
	const material = computed(() =>
		sel.value.kind === 'material' && sel.value.id ? store.getMaterial(sel.value.id) : undefined
	);
	const recipe = computed(() => (material.value ? getRecipe(material.value.recipe) : undefined));
	const materialCards = computed(() => {
		const r = recipe.value;
		if (!r) return [];
		const first = Object.values(material.value!.members)[0];
		return r.groups
			.map((g) => ({
				group: g,
				defs: r.params.filter((d) => (d.group ?? r.groups[0].id) === g.id).map((d) => withMasks(d, first))
			}))
			.filter((c) => c.defs.length > 0);
	});
	const layerMaterial = computed(() =>
		layer.value
			? (store.project.materials ?? []).find((m) => Object.values(m.members).includes(layer.value!.id))
			: undefined
	);

	// A material's limit (FR8.23): the same controls as a layer's Limit to, applied to every member on top of its own.
	const materialLimitDefs = computed<ParamDef[]>(() => {
		const first = Object.values(material.value?.members ?? {})[0];
		return LIMIT_PARAMS.map((d) => withMasks({ ...d, group: undefined, section: undefined }, first));
	});
	const materialLimit = computed<ParamValues>(() => limitParams(material.value?.limit ?? null));
	function setMaterialLimit(key: string, value: ParamValue): void {
		const m = material.value;
		if (!m) return;
		store.setMaterialLimit(m.id, layerLimit({ ...materialLimit.value, [key]: value }));
	}

	function unpackMaterial(): void {
		const m = material.value;
		if (!m) return;
		const first = Object.values(m.members)[0];
		store.unpackMaterial(m.id);
		editor.select(first ? 'layer' : 'project', first);
	}

	/**
	 * Mask-name fields (FR8.23) at a layer: the masks to offer — for reading, those the layers above write; for writing,
	 * every mask the project has (and Shape) — and, reading, a note on what the mask holds here ("Shape here: Panel −
	 * Vent") or that it's empty.
	 */
	function withMasks(d: ParamDef, layerId: string | undefined): ParamDef {
		if (!d.mask) return d;
		if (d.mask === 'write') return { ...d, maskChoices: [...new Set([SHAPE_MASK, ...masksAbove(store.project)])] };
		return {
			...d,
			maskChoices: layerId ? masksAbove(store.project, layerId) : [],
			note: (p) => {
				const name = String(p[d.key] ?? '').trim();
				if (!name || !layerId) return undefined;
				const chain = maskChain(store.project, layerId, name);
				return chain.length ? `${name} here: ${maskChainLabel(chain)}` : `No layer above writes ${name}: empty here`;
			}
		};
	}

	const layerCards = computed(() => {
		const l = layer.value;
		const def = layerDef.value;
		if (!l || !def) return [];
		const defs = layerParamDefs(l.type).map((d) => withMasks(d, l.id));
		const shown = (d: ParamDef) => !d.showIf || d.showIf(l.params);
		return (
			layerGroups(def)
				.map((g) => ({
					group: g,
					defs: defs.filter((d) => (d.group ?? 'params') === g.id && d.key !== g.toggleKey),
					toggle: defs.find((d) => d.key === g.toggleKey)
				}))
				// A card whose params (and header tick) are all hidden for these settings goes too.
				.filter((c) => c.defs.length > 0 && (c.defs.some(shown) || (c.toggle !== undefined && shown(c.toggle))))
		);
	});

	/** Position in the layer list (top = applied first), or within its material. */
	function layerIndexLabel(): string {
		const l = layer.value;
		const at = l ? store.unitOf(l.id) : undefined;
		if (!l || !at) return '';
		if (at.unit.material) return `${at.unit.layers.findIndex((x) => x.id === l.id) + 1} of ${at.unit.layers.length}`;
		return `${store.layerIndex(l.id) + 1} of ${store.project.layers.length}`;
	}

	/** Can the selected layer / material move one step earlier (−1) or later (+1)? */
	function canStep(id: string, dir: number): boolean {
		const at = store.unitOf(id);
		if (!at) return false;
		if (at.unit.material && at.unit.material.id !== id) {
			const i = at.unit.layers.findIndex((x) => x.id === id) + dir;
			return i >= 0 && i < at.unit.layers.length;
		}
		const j = at.index + dir;
		return j >= 0 && j < layerUnits(store.project.layers, store.project.materials).length;
	}

	// ---------------------------------------------------------------- project / world param tables
	const hasEnv = (p: ParamValues) => Boolean(p.image);
	const SKY_DEFS: ParamDef[] = [
		P.bool('enabled', 'Sky light', true),
		P.enum(
			'plane',
			'Plane',
			'floor',
			[
				[
					'floor',
					'Floor',
					'lying flat under the sky: the zenith straight out of it, read as a map (top north, right east)'
				],
				[
					'wall',
					'Wall',
					'standing upright, the floor stood up on its bottom edge: the sky above its top, the ground below, east still to its right and its face looking south'
				]
			],
			{
				segmented: true,
				hint: 'Where the sky (its gradient or environment image) sits round the texture. The lights keep their own directions, relative to the texture'
			}
		),
		P.image('image', 'Environment', {
			environment: true,
			hint: 'A panorama (equirectangular, 2:1: its top row straight up, its left edge facing the top of the texture) in place of the zenith → horizon gradient: what metals reflect, coloured by direction, and the light rough surfaces get from the sky. OpenEXR, Radiance HDR and Ultra HDR JPEG keep their full range (a sun lights the scene); PNG, JPEG and WebP work too. Kept as a 512 px Ultra HDR JPEG; the project saves its file name and a lighting preset the image'
		}),
		P.color('zenith', 'Zenith', '#9fb4c8', { showIf: (p) => !hasEnv(p) }),
		P.color('horizon', 'Horizon', '#c8c2b8', { showIf: (p) => !hasEnv(p) }),
		P.float('rotation', 'Rotation', 0, -180, 180, {
			step: 1,
			showIf: hasEnv,
			hint: 'Turns the environment about the vertical, in degrees: where its features sit in the reflections'
		}),
		P.float('intensity', 'Intensity', 0.35, 0, 1000, {
			softMax: 4,
			step: 0.001,
			hint: 'Brightness of the sky (the gradient, or the environment image)'
		})
	];
	const AMBIENT_DEFS: ParamDef[] = [
		P.color('color', 'Colour', '#ffffff'),
		P.float('intensity', 'Strength', 0.02, 0, 1000, { softMax: 1, step: 0.001, hint: 'Un-shadowed fill light' })
	];

	function assign(obj: object, key: string, v: ParamValue): void {
		(obj as Record<string, ParamValue>)[key] = v;
	}
	const asValues = (o: object) => o as unknown as ParamValues;

	/** Width and height resize the canvas, scaling every pixel-measured value with it; the rest are plain fields. */
	function setProject(key: string, v: ParamValue): void {
		const p = store.project;
		if (key === 'width') store.resize(Number(v), p.height);
		else if (key === 'height') store.resize(p.width, Number(v));
		else assign(p, key, v);
	}

	function setDescription(text: string): void {
		const t = text.trim();
		if (t) store.project.description = t;
		else delete store.project.description;
	}
</script>

<template>
	<aside class="props cf-panel">
		<!-- Layer -->
		<template v-if="layer && layerDef">
			<div class="title">
				<component :is="layerIcon(layer.type)" :size="15" :color="layerHue(layer.type)" />
				<input
					class="name"
					:value="layer.name"
					aria-label="Layer name"
					@change="store.updateLayer(layer.id, { name: ($event.target as HTMLInputElement).value })" />
				<PresetMenu kind="layer" :target="layer.type" :source="{ kind: 'layer', id: layer.id }" />
				<label class="en" title="Enabled">
					<input
						type="checkbox"
						:checked="layer.enabled"
						aria-label="Layer enabled"
						@change="store.updateLayer(layer.id, { enabled: ($event.target as HTMLInputElement).checked })" />
				</label>
			</div>
			<div class="sub">
				<span class="type">{{ layerDef.label }}</span>
				<span
					v-tip="
						layerMaterial
							? `Position within ${layerMaterial.name} (top = applied first)`
							: 'Position in the layer list (top = applied first)'
					"
					class="cf-mono lo"
					>{{ layerIndexLabel() }}</span
				>
				<span class="grow" />
				<button
					v-tip="
						layer.locked
							? 'Locked: the optimiser leaves this layer alone. Click to unlock'
							: 'Lock from the optimiser: it will not change this layer'
					"
					type="button"
					class="cf-ico-btn"
					:class="{ latched: layer.locked }"
					:aria-pressed="!!layer.locked"
					aria-label="Lock from the optimiser"
					@click="store.updateLayer(layer.id, { locked: !layer.locked })">
					<component :is="layer.locked ? IconLock : IconLockOpen" :size="13" />
				</button>
				<span class="vsep" />
				<button
					v-tip="'Move up: applied earlier'"
					type="button"
					class="cf-ico-btn"
					aria-label="Move layer up"
					:disabled="!canStep(layer.id, -1)"
					@click="store.stepLayer(layer.id, -1)">
					<IconArrowUp :size="13" />
				</button>
				<button
					v-tip="'Move down: applied later, over more'"
					type="button"
					class="cf-ico-btn"
					aria-label="Move layer down"
					:disabled="!canStep(layer.id, 1)"
					@click="store.stepLayer(layer.id, 1)">
					<IconArrowDown :size="13" />
				</button>
				<button
					v-tip="'Duplicate (Ctrl+D)'"
					type="button"
					class="cf-ico-btn"
					aria-label="Duplicate layer"
					@click="act.duplicateSelection">
					<IconCopy :size="13" />
				</button>
				<button
					v-tip="'Delete (Del)'"
					type="button"
					class="cf-ico-btn"
					aria-label="Delete layer"
					@click="act.deleteSelection">
					<IconTrash :size="13" />
				</button>
			</div>
			<p v-if="layerDef.description" class="desc">{{ layerDef.description }}</p>
			<div v-if="layerMaterial" class="links">
				<button
					v-tip="`Part of the smart material ${layerMaterial.name} — select it`"
					type="button"
					class="chip"
					@click="editor.select('material', layerMaterial.id)">
					<IconSquareRotated :size="11" />{{ layerMaterial.name }}
				</button>
			</div>
			<div class="scroll">
				<PanelCard
					v-for="c in layerCards"
					:key="`${layer.id}:${c.group.id}`"
					:title="c.group.label === 'Pattern' ? layerDef.label : c.group.label"
					:icon="c.group.id === 'params' ? layerIcon(layer.type) : cardIcon(c.group.id)"
					:icon-color="c.group.id === 'params' ? layerHue(layer.type) : undefined"
					:collapsed="c.group.collapsed"
					:storage-key="`${layer.type}:${c.group.id}`"
					:toggle="c.group.toggleKey ? Boolean(layer.params[c.group.toggleKey]) : null"
					@update:toggle="store.setLayerParam(layer.id, c.group.toggleKey!, $event)">
					<ParamList :defs="c.defs" :values="layer.params" @change="(k, v) => store.setLayerParam(layer!.id, k, v)">
						<template #section="{ section }">
							<template v-if="c.group.id === 'shaping' && section === 'Value'">
								<ShapingGraph :defs="layerDefs" :values="layer.params" :sdf="layerDef.sdf === true" />
								<ParamList
									v-if="layer.params.h_on === true"
									:defs="heightMirror"
									:values="layer.params"
									class="mirror"
									@change="(k, v) => store.setLayerParam(layer!.id, k, v)" />
							</template>
						</template>
					</ParamList>
				</PanelCard>
			</div>
		</template>

		<!-- Smart material -->
		<template v-else-if="material && recipe">
			<div class="title">
				<IconSquareRotated :size="15" color="var(--accent-hi)" />
				<input
					class="name"
					:value="material.name"
					aria-label="Material name"
					@change="store.renameMaterial(material.id, ($event.target as HTMLInputElement).value)" />
				<PresetMenu kind="material" :target="material.recipe" :source="{ kind: 'material', id: material.id }" />
				<label v-tip="'Shown'" class="en">
					<input
						type="checkbox"
						:checked="material.enabled !== false"
						aria-label="Material shown"
						@change="store.setMaterialEnabled(material.id, ($event.target as HTMLInputElement).checked)" />
				</label>
			</div>
			<div class="sub">
				<span class="type">{{ recipe.label }}</span>
				<span class="cf-mono lo">{{ Object.keys(material.members).length }} layers</span>
				<span class="grow" />
				<button
					v-tip="'Move up: applied earlier'"
					type="button"
					class="cf-ico-btn"
					aria-label="Move material up"
					:disabled="!canStep(material.id, -1)"
					@click="store.stepLayer(material.id, -1)">
					<IconArrowUp :size="13" />
				</button>
				<button
					v-tip="'Move down: applied later, over more'"
					type="button"
					class="cf-ico-btn"
					aria-label="Move material down"
					:disabled="!canStep(material.id, 1)"
					@click="store.stepLayer(material.id, 1)">
					<IconArrowDown :size="13" />
				</button>
				<button
					v-tip="'Unpack: keep the layers, drop the controls'"
					type="button"
					class="cf-ico-btn"
					aria-label="Unpack material"
					@click="unpackMaterial">
					<IconStack2 :size="13" />
				</button>
				<button
					v-tip="'Delete the material and its layers (Del)'"
					type="button"
					class="cf-ico-btn"
					aria-label="Delete material"
					@click="act.deleteSelection">
					<IconTrash :size="13" />
				</button>
			</div>
			<p class="desc">
				{{ recipe.description }} Its layers are ordinary layers — open it in the outliner to edit one; a control here
				rewrites only the settings it governs.
			</p>
			<div class="scroll">
				<PanelCard
					v-for="c in materialCards"
					:key="`${material.id}:${c.group.id}`"
					:title="c.group.label"
					:icon="cardIcon(c.group.id)"
					:storage-key="`material:${recipe.id}:${c.group.id}`">
					<ParamList
						:defs="c.defs"
						:values="material.params"
						@change="(k, v) => store.setMaterialParam(material!.id, k, v)" />
				</PanelCard>
				<PanelCard title="Mask" :icon="cardIcon('Mask')" storage-key="material:mask">
					<p class="hint">
						Limit every layer of this material to masks written by layers above it (e.g. a Cut-out's opening), on top of
						each layer's own Limit to. Cutting a hole: the material in front limited to the mask with Invert, the one
						behind to the mask — otherwise the hidden one's glow and relief show through.
					</p>
					<ParamList :defs="materialLimitDefs" :values="materialLimit" @change="setMaterialLimit" />
				</PanelCard>
			</div>
		</template>

		<!-- Light -->
		<template v-else-if="light">
			<div class="title">
				<component :is="light.type === 'point' ? IconBulb : IconSun" :size="15" :color="LIGHT_HUE" />
				<input
					class="name"
					:value="light.name"
					aria-label="Light name"
					@change="store.updateLight(light.id, { name: ($event.target as HTMLInputElement).value })" />
				<PresetMenu kind="light" :target="light.type" :source="{ kind: 'light', id: light.id }" />
				<label class="en" title="Enabled">
					<input
						type="checkbox"
						:checked="light.enabled"
						aria-label="Light enabled"
						@change="store.updateLight(light.id, { enabled: ($event.target as HTMLInputElement).checked })" />
				</label>
			</div>
			<div class="sub">
				<span class="type">{{ LIGHT_DEFS[light.type].label }} light</span>
				<span class="grow" />
				<button
					v-tip="'Duplicate (Ctrl+D)'"
					type="button"
					class="cf-ico-btn"
					aria-label="Duplicate light"
					@click="act.duplicateSelection">
					<IconCopy :size="13" />
				</button>
				<button
					v-tip="'Delete (Del)'"
					type="button"
					class="cf-ico-btn"
					aria-label="Delete light"
					@click="act.deleteSelection">
					<IconTrash :size="13" />
				</button>
			</div>
			<p class="desc">
				{{
					light.type === 'point'
						? `Drag the gizmo in the viewport to move it. Intensity 1 lights a white surface to 1.0 at ${Number((light.refDist ?? POINT_LIGHT_REF_DIST).toPrecision(4))} px.`
						: 'Drag the sun gizmo around the texture to set the azimuth. Hold Shift to place it under the cursor, setting the elevation too (the centre is overhead, the dashed ring the horizon); hold Ctrl to snap to 15° steps.'
				}}
			</p>
			<div class="scroll">
				<PanelCard title="Light" :icon="light.type === 'point' ? IconBulb : IconSun" :icon-color="LIGHT_HUE">
					<ParamList
						:defs="LIGHT_DEFS[light.type].params"
						:values="light.params"
						@change="(k, v) => store.setLightParam(light!.id, k, v)" />
				</PanelCard>
			</div>
		</template>

		<!-- Post filter -->
		<template v-else-if="post && postDef">
			<div class="title">
				<IconSparkles :size="15" :color="POST_HUE" />
				<span class="name static">{{ postDef.label }}</span>
				<PresetMenu kind="post" :target="post.type" :source="{ kind: 'post', id: post.id }" />
				<label class="en" title="Enabled">
					<input
						type="checkbox"
						:checked="post.enabled"
						aria-label="Filter enabled"
						@change="store.updatePost(post.id, { enabled: ($event.target as HTMLInputElement).checked })" />
				</label>
			</div>
			<div class="sub">
				<span class="type"
					>Post filter · {{ store.project.post.findIndex((f) => f.id === post!.id) + 1 }} of
					{{ store.project.post.length }}</span
				>
				<span class="grow" />
				<button
					v-tip="'Move up: applied earlier'"
					type="button"
					class="cf-ico-btn"
					aria-label="Move filter earlier"
					@click="store.movePost(post.id, store.project.post.findIndex((f) => f.id === post!.id) - 1)">
					<IconArrowUp :size="13" />
				</button>
				<button
					v-tip="'Move down: applied later'"
					type="button"
					class="cf-ico-btn"
					aria-label="Move filter later"
					@click="store.movePost(post.id, store.project.post.findIndex((f) => f.id === post!.id) + 1)">
					<IconArrowDown :size="13" />
				</button>
				<button
					v-tip="'Delete (Del)'"
					type="button"
					class="cf-ico-btn"
					aria-label="Delete filter"
					@click="act.deleteSelection">
					<IconTrash :size="13" />
				</button>
			</div>
			<p v-if="postDef.description" class="desc">{{ postDef.description }}</p>
			<div class="scroll">
				<PanelCard :title="postDef.label" :icon="IconSparkles" :icon-color="POST_HUE">
					<ParamList
						:defs="postDef.params"
						:values="post.params"
						@change="(k, v) => store.setPostParam(post!.id, k, v)" />
					<PostExtras :filter="post" />
				</PanelCard>
			</div>
		</template>

		<!-- Project -->
		<template v-else>
			<div class="title">
				<IconBox :size="15" color="var(--text-lo)" />
				<input
					class="name"
					:value="store.project.name"
					aria-label="Project name"
					@change="store.project.name = ($event.target as HTMLInputElement).value" />
			</div>
			<div v-if="sel.kind === 'base'" class="sub"><span class="type">Base</span></div>
			<textarea
				class="proj-desc"
				rows="2"
				placeholder="Description"
				aria-label="Project description"
				:value="store.project.description ?? ''"
				@change="setDescription(($event.target as HTMLTextAreaElement).value)" />
			<p class="desc">
				Texture size and tiling, the base material every layer builds on, world lighting and the path tracer.
			</p>
			<div class="scroll">
				<PanelCard title="Texture" :icon="cardIcon('Texture')">
					<div class="sizes">
						<button
							v-for="s in SIZE_PRESETS"
							:key="s"
							type="button"
							class="cf-toggle size"
							:class="{ on: store.project.width === s && store.project.height === s }"
							@click="store.resize(s, s)">
							{{ s }}
						</button>
					</div>
					<ParamList :defs="PROJECT_DEFS" :values="asValues(store.project)" @change="setProject" />
				</PanelCard>
				<PanelCard title="Path tracer" :icon="cardIcon('Path tracer')" storage-key="world:tracer">
					<ParamList
						:defs="RENDER_DEFS"
						:values="asValues(store.project.render)"
						@change="(k, v) => assign(store.project.render, k, v)" />
				</PanelCard>
				<PanelCard title="Base material" :icon="cardIcon('Base material')">
					<ParamList
						:defs="BASE_DEFS"
						:values="asValues(store.project.base)"
						@change="(k, v) => assign(store.project.base, k, v)" />
				</PanelCard>
				<PanelCard title="Lighting presets" :icon="cardIcon('Lighting presets')" storage-key="world:presets">
					<LightingPresets />
				</PanelCard>
				<PanelCard title="Sky light" :icon="cardIcon('Sky light')" storage-key="world:sky">
					<ParamList
						:defs="SKY_DEFS"
						:values="asValues(store.project.lighting.sky)"
						@change="(k, v) => assign(store.project.lighting.sky, k, v)" />
				</PanelCard>
				<PanelCard title="Ambient" :icon="cardIcon('Ambient')" storage-key="world:ambient">
					<ParamList
						:defs="AMBIENT_DEFS"
						:values="asValues(store.project.lighting.ambient)"
						@change="(k, v) => assign(store.project.lighting.ambient, k, v)" />
				</PanelCard>
			</div>
		</template>
	</aside>
</template>

<style scoped>
	.links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: 0 12px 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--sunken);
		color: var(--accent-hi);
		cursor: pointer;
	}
	.chip.lo {
		color: var(--text-lo);
		cursor: default;
	}
	.cf-btn.small {
		font-size: 11px;
		padding: 1px 8px;
		height: auto;
	}
	.hint {
		margin: 0 0 6px;
		font-size: 11px;
		color: var(--text-lo);
	}
	.props {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		/* Width-aware contents (ShapingGraph goes full width when the sidebar is narrow). */
		container: props / inline-size;
	}
	/* Height › Amount and Offset under the Shaping › Value graph, set off from the value controls below. */
	.mirror {
		padding-bottom: 6px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--hairline);
	}
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
		height: 28px;
		padding: 0 6px 0 10px;
		flex: none;
	}
	.type {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-lo);
	}
	.lo {
		font-size: 11px;
		color: var(--line-strong);
		white-space: nowrap;
	}
	.grow {
		flex: 1;
	}
	.vsep {
		width: 1px;
		height: 14px;
		margin: 0 3px;
		background: var(--hairline);
	}
	.proj-desc {
		flex: none;
		margin: 8px 10px 6px;
		min-height: 24px;
		resize: vertical;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		padding: 4px 8px;
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
	}
	.proj-desc:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--halo);
	}
	.desc {
		margin: 0;
		padding: 0 10px 8px;
		font-size: 12px;
		color: var(--text-lo);
		line-height: 1.4;
		flex: none;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 0 6px 12px;
	}
	.sizes {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 0 0 4px 96px;
	}
	.size {
		font-family: var(--font-mono);
		font-size: 11px;
	}
</style>
