// Morse's extension on Morse: hands the page the file the exporter saved on character.ai, which the
// background has kept since Open in Morse. Morse's /import posts `morse-import-ready` once it can
// take a file (signed in, with importing on: src/lib/characters/import/extension.ts names the
// messages), and this answers with the file, every time it's asked, until the page posts that it
// has it: so a page that asks only once the user has signed in still gets it. The background then
// lets the file go. A page that never asks leaves the file to the download.
(() => {
	/** How long the page has to ask. */
	const WAIT_MS = 30 * 60 * 1000;
	// A build for a local server matches its host on any port, as Firefox's patterns can't name
	// one: Morse is only the build's own origin.
	if (location.origin !== relay.morseOf(chrome.runtime.getManifest())) return;

	const port = chrome.runtime.connect({ name: "take" });
	relay.receive(port).then(
		(waiting) => {
			port.disconnect();
			if (waiting) handOver(waiting.about, waiting.file);
		},
		() => port.disconnect(),
	);

	/**
	 * Answers the page's asks with the file until it has it, or until WAIT_MS has passed.
	 * @param {Record<string, unknown>} about
	 * @param {Blob} file
	 */
	function handOver({ id, name }, file) {
		if (typeof id !== "string" || typeof name !== "string") return;
		const handed = {
			type: "morse-import-file",
			id,
			name,
			file: new File([file], name, { type: "application/json" }),
		};
		const post = () => window.postMessage(handed, location.origin);
		/** @param {MessageEvent} event */
		const heard = (event) => {
			if (relay.posted(event, window, "morse-import-ready")) post();
			else if (
				relay.posted(event, window, "morse-import-received")?.id === id
			) {
				stop();
				chrome.runtime.sendMessage({ type: "taken", id });
			}
		};
		const stop = () => {
			window.removeEventListener("message", heard);
			clearTimeout(timer);
		};
		const timer = setTimeout(stop, WAIT_MS);
		window.addEventListener("message", heard);
		// The page may have asked before the file came.
		post();
	}
})();
