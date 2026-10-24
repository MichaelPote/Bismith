// Offering to resume a run its page lost (src/stores/runCheckpoint.ts): at start-up, once the engine is up, a workspace
// whose run left a checkpoint — and isn't still running in another tab — asks Resume / Discard (Reopen for a run that
// had stopped with its best unapplied). Resume reopens the run's project if another one is open now, switches to the
// workspace and hands it the checkpoint as a `bismith:resume-run` event (detail: { workspace, checkpoint }); the
// workspace restores its state and carries on (or, paused, shows it as it was).
// Cancel leaves the checkpoint for next time. A workspace that keeps checkpoints is listed in RESUMABLE.

import { nextTick, toRaw, watch } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useProjectStore } from '@/stores/project';
import { projectFromJSON } from '@/core/serialize';
import { runCheckpoints, runLockHeld, timeAgo, type Checkpoint, type RunWorkspace } from '@/stores/runCheckpoint';

const RESUMABLE: { workspace: RunWorkspace; label: string }[] = [
	{ workspace: 'match', label: 'Match' },
	{ workspace: 'tiling', label: 'Tiling fix' }
];

export interface ResumeRunEvent {
	workspace: RunWorkspace;
	checkpoint: Checkpoint<unknown>;
}

/** Resolves true once the engine is ready, false if it failed to start. */
function engineReady(): Promise<boolean> {
	const editor = useEditorStore();
	return new Promise((resolve) => {
		const stop = watch(
			() => [editor.engine, editor.engineError] as const,
			([engine, error]) => {
				if (!engine && !error) return;
				queueMicrotask(() => stop());
				resolve(!!engine);
			},
			{ immediate: true }
		);
	});
}

/** At start-up: offer to resume the first interrupted run found. */
export async function offerResume(): Promise<void> {
	const editor = useEditorStore();
	const store = useProjectStore();
	for (const { workspace, label } of RESUMABLE) {
		const checkpoints = runCheckpoints<unknown>(workspace);
		const cp = await checkpoints.load();
		// A checkpoint whose lock is held belongs to a run still going in another tab.
		if (!cp || (await runLockHeld(workspace))) continue;
		if (!(await engineReady())) return;
		let theirs: string | null = null;
		let name = '';
		try {
			const p = projectFromJSON(cp.project);
			name = p.name;
			theirs = JSON.stringify(p);
		} catch {
			/* unreadable: resume in the open project */
		}
		const mine = toRaw(store.project);
		const other = theirs !== null && theirs !== JSON.stringify(mine);
		const where = !other
			? ''
			: name !== mine.name
				? ` It was working on “${name}”, not the open “${mine.name}”: resuming reopens “${name}” (Ctrl+Z brings “${mine.name}” back).`
				: ` The open project has changed since: resuming puts back the run's version (Ctrl+Z brings yours back).`;
		const loss = cp.loss !== null && Number.isFinite(cp.loss) ? ` (loss ${cp.loss.toFixed(4)})` : '';
		const ago = timeAgo(Date.now() - cp.savedAt);
		const at = `step ${cp.step}${loss}`;
		const discarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded;
		const what = cp.paused
			? `A ${label} run stopped ${ago} ago at ${at} without its best being applied.`
			: discarded
				? `The browser unloaded this tab in the background ${ago} ago, during a ${label} run at ${at}.`
				: `A ${label} run was interrupted ${ago} ago at ${at}.`;
		const verb = cp.paused ? 'Reopen' : 'Resume';
		const choice = await editor.ask({
			title: cp.paused ? `Reopen the unapplied ${label} run?` : `Resume the interrupted ${label} run?`,
			detail: `${what}${where} ${verb} it?`,
			choices: [
				{ id: 'discard', label: 'Discard' },
				{ id: 'resume', label: verb, primary: true }
			]
		});
		if (choice === 'discard') await checkpoints.clear();
		if (choice !== 'resume') return;
		if (other) store.load(projectFromJSON(cp.project));
		editor.workspace = workspace;
		// After the workspace has mounted (a first visit), so it hears the event.
		await nextTick();
		window.dispatchEvent(
			new CustomEvent<ResumeRunEvent>('bismith:resume-run', { detail: { workspace, checkpoint: cp } })
		);
		return;
	}
}
