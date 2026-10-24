// The app's IndexedDB database ('bismith'): one connection, shared by every store that keeps data in this browser —
// the user's presets (src/stores/presets.ts) and run checkpoints (src/stores/runCheckpoint.ts). Adding an object store
// means listing it in STORES and bumping VERSION: an upgrade creates every store that is missing, so a browser on any
// earlier version catches up in one step.

const DB = 'bismith';
const VERSION = 2;
/** Every object store, by name, with its key path. */
const STORES: Record<string, string> = { presets: 'id', checkpoints: 'id' };

let opening: Promise<IDBDatabase> | null = null;

/** The open database (opened on first use and kept; reopened after another tab upgrades it or it closes). */
export function openDb(): Promise<IDBDatabase> {
	opening ??= new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const [name, keyPath] of Object.entries(STORES))
				if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
		};
		req.onsuccess = () => {
			const db = req.result;
			// Another tab wants a newer version: let it, and open afresh next time.
			db.onversionchange = () => {
				db.close();
				opening = null;
			};
			db.onclose = () => {
				opening = null;
			};
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	}).catch((e: unknown) => {
		// No IndexedDB here (private window, blocked site data, Node) or the open failed: try again next time.
		opening = null;
		throw e;
	});
	return opening;
}

/** One request in its own transaction on `store`; resolves with its result once the transaction commits. */
export async function idbRun<T>(
	store: string,
	mode: IDBTransactionMode,
	f: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDb();
	return new Promise<T>((resolve, reject) => {
		const tx = db.transaction(store, mode);
		const req = f(tx.objectStore(store));
		tx.oncomplete = () => resolve(req.result);
		tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
	});
}
