// Morse's extension on Morse: hands the page the file the exporter saved on character.ai, which the
// background has kept since Open in Morse. Morse, opened asking for the Import dialog
// (`?import=extension`), posts `morse-import-ready` once it can take a file (signed in, with importing on: src/lib/characters/import/extension.ts names the
// messages), and only then is the file asked of the background, once: the other pages of Morse,
// which never ask, never hold it. This answers each ask with the file until the page posts that it
// has it: so a page that asks only once the user has signed in still gets it. The background then
// lets the file go. A page that never asks leaves the file to the download.
(() => {
	/** How long a page has to ask, and to take the file. */
	const WAIT_MS = 30 * 60 * 1000;
	// A build for a local server matches its host on any port, as Firefox's patterns can't name
	// one: Morse is only the build's own origin.
	if (location.origin !== relay.morseOf(chrome.runtime.getManifest())) return;

	/** What hands the page the file waiting, asked of the background the first time the page asks:
	 * nothing when no file waits, or it couldn't be had.
	 * @type {Promise<{ type: string, id: string, name: string, file: File } | undefined> | undefined} */
	let handing;

	/** The message that hands the page the file the background has waiting, if one does. */
	function take() {
		const port = chrome.runtime.connect({ name: "take" });
		return relay.receive(port).then(
			(waiting) => {
				port.disconnect();
				return waiting ? handed(waiting.about, waiting.file) : undefined;
			},
			() => {
				port.disconnect();
				return undefined;
			},
		);
	}

	/**
	 * The message that hands the page `file`, as `about` names it.
	 * @param {Record<string, unknown>} about
	 * @param {Blob} file
	 */
	function handed({ id, name }, file) {
		if (typeof id !== "string" || typeof name !== "string") return undefined;
		return {
			type: "morse-import-file",
			id,
			name,
			file: new File([file], name, { type: "application/json" }),
		};
	}

	/** @param {MessageEvent} event */
	const heard = (event) => {
		if (relay.posted(event, window, "morse-import-ready")) {
			handing ??= take();
			void handing.then((message) => {
				if (message) window.postMessage(message, location.origin);
			});
			return;
		}
		const received = relay.posted(event, window, "morse-import-received");
		if (!received || !handing) return;
		void handing.then((message) => {
			if (!message || received.id !== message.id) return;
			stop();
			chrome.runtime.sendMessage({ type: "taken", id: message.id });
		});
	};
	const stop = () => {
		window.removeEventListener("message", heard);
		clearTimeout(timer);
	};
	const timer = setTimeout(stop, WAIT_MS);
	window.addEventListener("message", heard);
})();
