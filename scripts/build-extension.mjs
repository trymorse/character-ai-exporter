#!/usr/bin/env node
// Builds Morse's browser extension (extension/) for Chrome and for Firefox: for each, a folder to
// load unpacked and a zip to upload to its store, under dist-extension/. The scripts go in as they
// are written, beside Morse's exporter (cai-exporter.js, the same file https://trymorse.ai serves),
// so a store's reviewer reads the code this repository holds, with nothing generated but the
// manifest, made here for each browser and for the Morse the build opens.
//
// Usage: node scripts/build-extension.mjs [--dev | --origin <url>] [--out <dir>]
//
//   (none)          production, https://trymorse.ai: the build the stores get
//   --dev           Morse's dev server, http://localhost:3000
//   --origin <url>  any other Morse
//   --out <dir>     where the builds go, dist-extension/ unless given
//
// The zips come out the same for the same files: entries in order, each dated 1980-01-01.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

/** The version the stores see. Each upload to a store needs a higher one. */
export const VERSION = "1.0.0";

/** The Morse each flag builds for. */
export const ORIGINS = {
	production: "https://trymorse.ai",
	dev: "http://localhost:3000",
};

/** Firefox's id for the extension, which its listing keeps for good. */
export const FIREFOX_ID = "move-to-morse@trymorse.ai";

const CHARACTER_AI = "https://character.ai/*";
const ICONS = [16, 32, 48, 128];

/** The scripts, in extension/src, each browser loads. Chrome's background is a service worker of
 * one file, worker.js, which loads the scripts Firefox lists for its background. */
const SCRIPTS = {
	chrome: ["relay.js", "background.js", "worker.js", "character-ai.js", "morse.js"],
	firefox: ["relay.js", "background.js", "character-ai.js", "morse.js"],
};

/** The pages of `origin` as `browser`'s match patterns take them. Firefox's can't name a port, so
 * a build for a local server matches its host on any port there, and morse.js checks the origin
 * itself.
 * @param {string} origin @param {"chrome" | "firefox"} browser */
export function pagesOf(origin, browser) {
	const url = new URL(origin);
	return `${url.protocol}//${browser === "firefox" ? url.hostname : url.host}/*`;
}

/** The manifest for `browser`, opening and matching Morse at `origin`.
 * @param {"chrome" | "firefox"} browser @param {string} origin */
export function manifest(browser, origin) {
	const morse = pagesOf(origin, browser);
	return {
		manifest_version: 3,
		name: "Move to Morse",
		version: VERSION,
		description: "Save your characters, chats, and personas from Character.AI in one go, and open them straight in Morse's import.",
		// The Morse the build opens: the background and morse.js read it here.
		homepage_url: `${new URL(origin).origin}/`,
		icons: Object.fromEntries(ICONS.map((size) => [size, `icons/icon-${size}.png`])),
		// To run the exporter in character.ai's page, when Save for Morse is clicked.
		permissions: ["scripting"],
		host_permissions: [CHARACTER_AI, morse],
		background: browser === "chrome" ? { service_worker: "worker.js" } : { scripts: ["relay.js", "background.js"] },
		content_scripts: [
			{ matches: [CHARACTER_AI], js: ["relay.js", "character-ai.js"] },
			{ matches: [morse], js: ["relay.js", "morse.js"], run_at: "document_start" },
		],
		...(browser === "chrome"
			? // All the extension uses is older: Manifest V3's `scripting`, `crypto.randomUUID`, and a
				// content script's requests made as its page's.
				{ minimum_chrome_version: "102" }
			: {
					browser_specific_settings: {
						// The consent to data collection (none here) that every new add-on declares is
						// Firefox 140's on a computer and 142's on Android.
						gecko: { id: FIREFOX_ID, strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
						gecko_android: { strict_min_version: "142.0" },
					},
				}),
	};
}

/** A zip of `files`, each deflated, in the order given, dated 1980-01-01 so the same files make
 * the same zip.
 * @param {[string, Uint8Array][]} files */
export function zip(files) {
	const DATE = (0 << 9) | (1 << 5) | 1;
	/** @type {Buffer[]} */
	const locals = [];
	/** @type {Buffer[]} */
	const directory = [];
	let offset = 0;
	for (const [name, data] of files) {
		const path = Buffer.from(name);
		const packed = deflateRawSync(data, { level: 9 });
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(path.length, 26);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(0x0800, 8);
		entry.writeUInt16LE(8, 10);
		entry.writeUInt16LE(DATE, 14);
		entry.writeUInt32LE(crc, 16);
		entry.writeUInt32LE(packed.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(path.length, 28);
		entry.writeUInt32LE(offset, 42);
		locals.push(local, path, packed);
		directory.push(entry, path);
		offset += local.length + path.length + packed.length;
	}
	const size = directory.reduce((sum, part) => sum + part.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(size, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...directory, end]);
}

/** The files of `browser`'s build for Morse at `origin`, by their paths in it, read from `root`.
 * @param {"chrome" | "firefox"} browser @param {string} origin @param {string} root */
export function filesOf(browser, origin, root) {
	/** @type {[string, Uint8Array][]} */
	const files = [["manifest.json", Buffer.from(`${JSON.stringify(manifest(browser, origin), null, 2)}\n`)]];
	for (const script of SCRIPTS[browser]) files.push([script, readFileSync(join(root, "extension/src", script))]);
	files.push(["cai-exporter.js", readFileSync(join(root, "cai-exporter.js"))]);
	for (const size of ICONS) files.push([`icons/icon-${size}.png`, readFileSync(join(root, `extension/icons/icon-${size}.png`))]);
	return files;
}

/** Builds both browsers' extensions for `origin` into `out`, replacing what an earlier build put
 * there, and gives what it made.
 * @param {{ origin: string, out: string, root?: string }} build */
export function build({ origin, out, root = join(import.meta.dirname, "..") }) {
	const made = [];
	for (const browser of /** @type {const} */ (["chrome", "firefox"])) {
		const folder = join(out, browser);
		const archive = join(out, `move-to-morse-${VERSION}-${browser}.zip`);
		rmSync(folder, { recursive: true, force: true });
		const files = filesOf(browser, origin, root);
		for (const [path, data] of files) {
			mkdirSync(dirname(join(folder, path)), { recursive: true });
			writeFileSync(join(folder, path), data);
		}
		writeFileSync(archive, zip(files));
		made.push({ browser, folder, archive });
	}
	return made;
}

/** @param {string[]} args */
function main(args) {
	const value = (flag) => {
		const at = args.indexOf(flag);
		if (at === -1) return undefined;
		const given = args[at + 1];
		if (!given || given.startsWith("--")) throw new Error(`${flag} needs a value`);
		return given;
	};
	const asked = [args.includes("--dev") && ORIGINS.dev, value("--origin")].filter(Boolean);
	if (asked.length > 1) throw new Error("Give one of --dev and --origin");
	const origin = new URL(asked[0] ?? ORIGINS.production).origin;
	const out = value("--out") ?? "dist-extension";
	for (const { browser, folder, archive } of build({ origin, out })) console.log(`${browser}: ${folder}/ and ${archive}`);
	console.log(`Morse at ${origin}, version ${VERSION}`);
}

/** Why `version` can't run this script, or "" when it can. `hasMain` is whether that Node provides
 * `import.meta.main`. It needs 24.2 or later, which has it. Without the property,
 * `if (import.meta.main)` is false and the process exits 0 having built nothing.
 * @param {string} [version] @param {boolean} [hasMain] */
export function unsupportedNode(
	version = process.version,
	hasMain = typeof import.meta.main === "boolean",
) {
	const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
	const recent = major > 24 || (major === 24 && minor >= 2);
	if (recent && hasMain) return "";
	const shown = version.startsWith("v") ? version : `v${version}`;
	const silent = hasMain ? "" : " It has no import.meta.main, so it would otherwise exit 0 and build nothing.";
	return `needs Node 24.2 or later (this is ${shown}).${silent}`;
}

/** True when node was asked to run this file. A Node with no `import.meta.main` still has to be
 * caught here, or the check below never runs and the process exits 0. */
function invokedDirectly() {
	if (typeof import.meta.main === "boolean") return import.meta.main;
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const refusal = unsupportedNode();
		if (refusal) throw new Error(refusal);
		main(process.argv.slice(2));
	} catch (error) {
		console.error(`build-extension: ${error.message}`);
		process.exit(1);
	}
}
