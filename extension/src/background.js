// Morse's extension, behind its pages: it runs Morse's exporter (cai-exporter.js) in a character.ai
// page when Save for Morse asks, keeps the file the exporter saved once Open in Morse sends it, opens
// Morse's /import beside the page, and gives the file to Morse's page there when it asks, until the
// page has it. Chrome runs this as a service worker (worker.js) and Firefox as a background script,
// and either may stop it between messages, so the file is kept in the extension's own IndexedDB,
// never only in memory. The file never leaves the browser.
(() => {
	const CHARACTER_AI = "https://character.ai";
	const MORSE = relay.morseOf(chrome.runtime.getManifest());
	/** How long a file waits for Morse to take it: after that the download is the way. */
	const WAIT_MS = 60 * 60 * 1000;
	/** The largest file kept: as much as Morse's import reads from one. */
	const LARGEST = 1024 ** 3;

	/** The file waiting for Morse, as it's kept. Only one waits: a newer one takes its place.
	 * @typedef {{ id: string, name: string, partial: boolean, at: number, file: Blob }} Waiting */

	/** @returns {Promise<IDBDatabase>} */
	const database = () =>
		new Promise((done, fail) => {
			const opening = indexedDB.open("morse", 1);
			opening.onupgradeneeded = () => opening.result.createObjectStore("files");
			opening.onsuccess = () => done(opening.result);
			opening.onerror = () => fail(opening.error);
		});

	/**
	 * Runs `use` on the store of files in a transaction of `mode`, and gives what its request came
	 * to once the transaction is done.
	 * @param {IDBTransactionMode} mode
	 * @param {(files: IDBObjectStore) => IDBRequest} use
	 */
	async function stored(mode, use) {
		const db = await database();
		try {
			return await new Promise((done, fail) => {
				const tx = db.transaction("files", mode);
				const request = use(tx.objectStore("files"));
				tx.oncomplete = () => done(request.result);
				tx.onerror = () => fail(tx.error);
				tx.onabort = () => fail(tx.error);
			});
		} finally {
			db.close();
		}
	}
	/** @param {Waiting} file */
	const put = (file) =>
		stored("readwrite", (files) => files.put(file, "waiting"));
	/** @returns {Promise<Waiting | undefined>} */
	const get = () => stored("readonly", (files) => files.get("waiting"));
	/** Lets the file waiting go where `which` says, read and let go in one transaction, so a file
	 * kept meanwhile never goes in its place.
	 * @param {(waiting: Waiting) => boolean} which */
	const removeIf = (which) =>
		stored("readwrite", (files) => {
			const asked = files.get("waiting");
			asked.onsuccess = () => {
				if (asked.result && which(asked.result)) files.delete("waiting");
			};
			return asked;
		});
	/** @param {Waiting} waiting */
	const stale = (waiting) => Date.now() - waiting.at > WAIT_MS;

	// A file Morse didn't take in time goes whenever the background starts: on the next message, and
	// as the browser starts, if not sooner.
	void removeIf(stale);
	chrome.runtime.onStartup.addListener(() => void removeIf(stale));

	/**
	 * Keeps the file Open in Morse sends on `port`, then opens Morse's /import beside the page it
	 * came from.
	 * @param {chrome.runtime.Port} port
	 */
	async function keepFrom(port) {
		try {
			const sent = await relay.receive(port, LARGEST);
			const name = sent?.about.name;
			if (!sent || typeof name !== "string") return;
			await put({
				id: crypto.randomUUID(),
				name: name.slice(0, 200),
				partial: sent.about.partial === true,
				at: Date.now(),
				file: sent.file,
			});
			// Beside the page: Firefox for Android takes no opener for a tab.
			const tab = port.sender?.tab;
			chrome.tabs.create({
				url: new URL("/import", MORSE).href,
				...(tab && { index: tab.index + 1 }),
			});
		} catch {
			// The page went, or sent something else: nothing is kept, and Open in Morse can be chosen
			// again.
		} finally {
			port.disconnect();
		}
	}

	/**
	 * Gives the file waiting, if one is and it's not too old, to Morse's page on `port`.
	 * @param {chrome.runtime.Port} port
	 */
	async function giveTo(port) {
		try {
			const waiting = await get();
			if (!waiting || stale(waiting)) {
				port.postMessage({ type: "none" });
				return;
			}
			await relay.send(port, waiting.file, {
				id: waiting.id,
				name: waiting.name,
				partial: waiting.partial,
			});
		} catch {
			// The page went before it had it: the file waits for the next.
		}
	}

	chrome.runtime.onMessage.addListener((message, sender) => {
		// Save for Morse: the exporter, beside the page in this extension's own world (the one its
		// script on character.ai runs in), where it finds the session the page carries and asks
		// Character.AI's API as the page does, out of the reach of the page's own scripts.
		const tabId = sender.tab?.id;
		if (
			message?.type === "run" &&
			tabId !== undefined &&
			relay.from(sender, CHARACTER_AI)
		)
			chrome.scripting.executeScript({
				target: { tabId },
				files: ["cai-exporter.js"],
				world: "ISOLATED",
			});
		// Morse's page has the file.
		const { id } = message ?? {};
		if (
			message?.type === "taken" &&
			typeof id === "string" &&
			relay.from(sender, MORSE)
		)
			void removeIf((waiting) => waiting.id === id);
	});

	chrome.runtime.onConnect.addListener((port) => {
		// From character.ai: keep this file for Morse. From Morse: the file waiting, if there is one.
		if (port.name === "keep" && relay.from(port.sender, CHARACTER_AI))
			void keepFrom(port);
		else if (port.name === "take" && relay.from(port.sender, MORSE))
			void giveTo(port);
		else port.disconnect();
	});
})();
