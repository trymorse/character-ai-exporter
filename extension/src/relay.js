// What Morse's extension's scripts share: its background (background.js), and its scripts on
// character.ai (character-ai.js) and on Morse (morse.js). A file goes between them over a port a
// piece at a time, each piece as base64 text, since Chrome's messages carry only what JSON can
// (Firefox's take a file whole, but one way serves both); and a page's messages are taken only
// from the page itself.
//
// It's a plain script, as browsers run content scripts, with no imports: the scripts that use it
// are listed after it (the manifest, worker.js) and find it as `relay`.
// biome-ignore lint/correctness/noUnusedVariables: the scripts loaded after this one use it
const relay = (() => {
	/** The bytes a piece carries: 4 MiB, 5.3 MiB as base64, well within the 64 MiB Chrome takes in
	 * one message. */
	const PIECE = 4 * 1024 * 1024;

	/** `bytes` as base64: by the browser's own way where it has one (Chrome 140, Firefox 133),
	 * some fifty times faster, else a stretch at a time, as a call takes only so many arguments.
	 * @param {Uint8Array} bytes */
	const base64 = (bytes) => {
		if (bytes.toBase64) return bytes.toBase64();
		let text = "";
		for (let at = 0; at < bytes.length; at += 0x8000)
			text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
		return btoa(text);
	};

	/** A piece's base64 as the bytes it carries, in a Blob, so a file's pieces are kept by the
	 * browser rather than held as text.
	 * @param {string} text */
	const bytesOf = (text) => {
		if (Uint8Array.fromBase64) return new Blob([Uint8Array.fromBase64(text)]);
		const binary = atob(text);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return new Blob([bytes]);
	};

	/**
	 * Sends `file` on `port`, said to be what `about` says, a piece each time the other end asks for
	 * one (`receive`), so only one piece is ever on its way. Resolves once the end is sent; rejects
	 * if the port closes before.
	 * @param {chrome.runtime.Port} port
	 * @param {Blob} file
	 * @param {Record<string, unknown>} about
	 * @returns {Promise<void>}
	 */
	function send(port, file, about) {
		return new Promise((done, fail) => {
			let at = 0;
			/** @param {unknown} message */
			const asked = async (message) => {
				if (!isMessage(message) || message.type !== "next") return;
				if (at >= file.size) {
					stop();
					port.postMessage({ type: "end" });
					return done();
				}
				const piece = file.slice(at, at + PIECE);
				at += PIECE;
				try {
					const data = base64(new Uint8Array(await piece.arrayBuffer()));
					port.postMessage({ type: "piece", data });
				} catch (error) {
					// The file couldn't be read, or the port went as it was.
					stop();
					fail(error);
				}
			};
			const gone = () => {
				stop();
				fail(new Error("The port closed before the file was sent"));
			};
			const stop = () => {
				port.onMessage.removeListener(asked);
				port.onDisconnect.removeListener(gone);
			};
			port.onMessage.addListener(asked);
			port.onDisconnect.addListener(gone);
			port.postMessage({ ...about, type: "file", size: file.size });
		});
	}

	/**
	 * Takes the file `send` sends on `port`: what was said of it, and the file; or null when the
	 * other end says there is none (`{ type: "none" }`). Rejects when the port closes first, when
	 * the file isn't the size it was said to be, when it's said to be over `largest` bytes, or when
	 * a message comes out of turn.
	 * @param {chrome.runtime.Port} port
	 * @param {number} [largest]
	 * @returns {Promise<{ about: Record<string, unknown>, file: Blob } | null>}
	 */
	function receive(port, largest = Number.MAX_SAFE_INTEGER) {
		return new Promise((done, fail) => {
			/** @type {Record<string, unknown> | undefined} */
			let about;
			/** @type {Blob[]} */
			const parts = [];
			let size = 0;
			/** @param {string} why */
			const refuse = (why) => {
				stop();
				fail(new Error(why));
			};
			/** @param {unknown} message */
			const heard = (message) => {
				if (!isMessage(message)) return refuse("A message that isn't one");
				if (!about && message.type === "none") {
					stop();
					return done(null);
				}
				if (!about && message.type === "file") {
					const said = message.size;
					if (typeof said !== "number" || !Number.isSafeInteger(said))
						return refuse("A file of no size");
					if (said < 0 || said > largest) return refuse("A file too large");
					about = message;
					return port.postMessage({ type: "next" });
				}
				if (
					about &&
					message.type === "piece" &&
					typeof message.data === "string"
				) {
					const part = bytesOf(message.data);
					size += part.size;
					if (size > Number(about.size)) return refuse("More than the file");
					parts.push(part);
					return port.postMessage({ type: "next" });
				}
				if (about && message.type === "end") {
					if (size !== about.size) return refuse("Less than the file");
					stop();
					return done({
						about,
						file: new Blob(parts, { type: "application/json" }),
					});
				}
				refuse(`A message out of turn: ${String(message.type)}`);
			};
			const gone = () => refuse("The port closed before the file came");
			const stop = () => {
				port.onMessage.removeListener(heard);
				port.onDisconnect.removeListener(gone);
			};
			port.onMessage.addListener(heard);
			port.onDisconnect.addListener(gone);
		});
	}

	/** Whether `value` is a message: an object with a type.
	 * @param {unknown} value
	 * @returns {value is { type: unknown } & Record<string, unknown>} */
	const isMessage = (value) =>
		typeof value === "object" && value !== null && "type" in value;

	/**
	 * What `win`'s own page posted to it, if `event` is that and of `type`: never a message from
	 * another window or another origin, which a frame in the page could send.
	 * @param {MessageEvent} event
	 * @param {Window} win
	 * @param {string} type
	 */
	const posted = (event, win, type) => {
		const { data } = event;
		return event.source === win &&
			event.origin === win.location.origin &&
			isMessage(data) &&
			data.type === type
			? data
			: undefined;
	};

	/** The origin of Morse this build opens and hands files to: the manifest's homepage, which the
	 * build sets (scripts/build-extension.mjs).
	 * @param {{ homepage_url?: string }} manifest */
	const morseOf = (manifest) => new URL(String(manifest.homepage_url)).origin;

	/**
	 * Whether a message came from the extension's own script at the top of a tab at `origin`, as
	 * the browser says of its sender: a script of the extension's on another page, or in a frame,
	 * is never taken for it.
	 * @param {chrome.runtime.MessageSender | undefined} sender
	 * @param {string} origin
	 */
	const from = (sender, origin) => {
		if (!sender?.tab || sender.frameId !== 0 || !sender.url) return false;
		try {
			return new URL(sender.url).origin === origin;
		} catch {
			return false;
		}
	};

	return { PIECE, send, receive, posted, morseOf, from };
})();
