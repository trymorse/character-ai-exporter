// Morse's extension on character.ai. Save for Morse, a small button in the page's corner, runs
// Morse's exporter (cai-exporter.js) beside the page, in this script's own world, not the page's:
// it finds the session there as its bookmark does, in the page's `__NEXT_DATA__`, and its requests
// to Character.AI's API are still the page's own. The exporter hands the file it saves to
// `__morseExtension` here, and its Open in Morse, clicked by the user, asks for it to go to Morse.
// No script of the page's can reach either, so none can give Morse a file of its own or open it.
// This then sends the file to the background, which keeps it and opens Morse at the Import dialog,
// where morse.js hands it to the page. Nothing marks the page as the extension's.
(() => {
	/** The file the exporter saved last.
	 * @type {{ name: string, file: Blob, partial: boolean } | undefined} */
	let saved;
	/** Whether a file is on its way to the background, so a second click doesn't send it again. */
	let sending = false;

	// What the exporter, run in this world by Save for Morse, finds and gives its file to.
	globalThis.__morseExtension = {
		/** @param {{ name: unknown, file: unknown, partial?: unknown }} exported */
		hand(exported) {
			if (exported?.file instanceof Blob && typeof exported.name === "string")
				saved = {
					name: exported.name,
					file: exported.file,
					partial: exported.partial === true,
				};
		},
		open() {
			if (saved && !sending) void send(saved);
		},
	};

	/** Sends `saved` to the background, which keeps it and opens Morse.
	 * @param {{ name: string, file: Blob, partial: boolean }} saved */
	async function send({ name, file, partial }) {
		sending = true;
		const port = chrome.runtime.connect({ name: "keep" });
		try {
			await relay.send(port, file, { name, partial });
		} catch {
			// The background went before it had it all: Open in Morse can be chosen again.
		} finally {
			sending = false;
			port.disconnect();
		}
	}

	// The button, with a way to hide it until the page is opened again, in a shadow root of its own,
	// so the page's styles don't reach it, nor its styles the page. It sits in the corner the
	// exporter's panel takes, which covers it while it's open.
	const host = document.createElement("div");
	const root = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = `
		:host { all: initial; }
		.bar {
			position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
			display: flex; align-items: center; gap: 2px; padding: 3px;
			background: #fff; color: #111; border-radius: 999px;
			box-shadow: 0 4px 18px rgba(0, 0, 0, 0.3);
			font: 500 13px/1 system-ui, -apple-system, sans-serif;
		}
		button {
			all: unset; box-sizing: border-box; cursor: pointer; border-radius: 999px;
			display: inline-flex; align-items: center; justify-content: center;
		}
		button:hover { background: #eee; }
		button:focus-visible { outline: 2px solid #14307f; outline-offset: 1px; }
		.run { gap: 7px; height: 30px; padding: 0 12px 0 10px; }
		.run svg { width: 16px; height: 16px; }
		.hide { width: 26px; height: 26px; color: #555; font-size: 17px; }
		@media print { .bar { display: none; } }
	`;
	const bar = document.createElement("div");
	bar.className = "bar";
	const run = document.createElement("button");
	run.type = "button";
	run.className = "run";
	run.append(mark(), "Save for Morse");
	const hide = document.createElement("button");
	hide.type = "button";
	hide.className = "hide";
	hide.setAttribute("aria-label", "Hide Save for Morse");
	hide.title = "Hide until the page is opened again";
	hide.textContent = "×";
	bar.append(run, hide);
	root.append(style, bar);
	document.body.append(host);

	// Only a click of the user's own: a script of the page's can't start an export.
	run.addEventListener("click", (event) => {
		if (event.isTrusted) chrome.runtime.sendMessage({ type: "run" });
	});
	hide.addEventListener("click", () => host.remove());

	/** Morse's mark, as public/brand/mark.svg draws it (extension/test/character-ai.test.ts holds
	 * the two together): a four-pointed star cut down its middle, its two halves slid apart, the
	 * left one up in navy and the right one down in cornflower. Each half is filled with a
	 * radial gradient, brightest a little out from its spine and deepest at its points. */
	function mark() {
		/** How far each half's points reach from the middle of its straight side, its spine; how far
		 * its spine stands off the star's upright middle line; and how far it's slid along it. */
		const [reach, gap, slide] = [10, 0.8, 2];
		const halves = [
			{ side: -1, stops: ["#6891db", "#2d4b83", "#142546"] },
			{ side: 1, stops: ["#c5d8f9", "#80a5e7", "#527bc3"] },
		].map(({ side, stops }) => {
			const [x, y] = [side * gap, side * slide];
			const half = reach / 2;
			return {
				// Its spine from its top point down to its bottom one, closed by two curves out to its
				// side point and back, bowed in toward the spine.
				d: `M${x} ${y - reach}C${x} ${y - half} ${x + side * half} ${y} ${x + side * reach} ${y}C${x + side * half} ${y} ${x} ${y + half} ${x} ${y + reach}Z`,
				// Its fill's middle, a little out from the middle of its spine, and how far it reaches:
				// past the points, so they're the deepest.
				glow: { cx: side * (gap + 2.5), cy: y, r: 11 },
				stops,
			};
		});
		/** An SVG element named `name`, with `attributes` and `children`.
		 * @param {string} name @param {Record<string, string | number>} attributes
		 * @param {Element[]} children */
		const made = (name, attributes, ...children) => {
			const element = document.createElementNS(
				"http://www.w3.org/2000/svg",
				name,
			);
			for (const [key, value] of Object.entries(attributes))
				element.setAttribute(key, String(value));
			element.append(...children);
			return element;
		};
		return made(
			"svg",
			{ viewBox: "-12 -12 24 24", "aria-hidden": "true" },
			made(
				"defs",
				{},
				...halves.map(({ glow, stops }, h) =>
					made(
						"radialGradient",
						{ id: `morse-mark-${h}`, gradientUnits: "userSpaceOnUse", ...glow },
						...stops.map((color, s) =>
							made("stop", { offset: [0, 0.55, 1][s], "stop-color": color }),
						),
					),
				),
			),
			...halves.map(({ d }, h) =>
				made("path", { d, fill: `url(#morse-mark-${h})` }),
			),
		);
	}
})();
