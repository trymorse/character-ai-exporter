// Morse's Character.AI exporter. The user runs it on character.ai, signed in, from a bookmark or
// the browser's console. It reads their own data over the same API the site uses (their chats,
// every message, the characters they talked to and made, and their personas) and saves it as one
// JSON file that Morse's import reads (`morse.cai-export`, formats.ts). Nothing goes anywhere but
// that file: no request leaves for any site other than Character.AI's own. Run by Morse's browser
// extension, it hands the file to the extension too, to take to Morse in the same browser.
//
// One request at a time, a quarter second apart, and ten seconds' rest whenever Character.AI asks
// for it (429), so a long history doesn't load the site. Stop saves what's done so far, and the
// next run in the same browser can go on from there, saving only the rest as a file of its own.
//
// It keeps a report as it goes, for when an export goes wrong: what it asked Character.AI and how
// each kind of request was answered, the names of the fields the answers held, and how much it
// read. Never a message, a name, an id, or a picture. "Copy a report" puts it on the clipboard to
// paste into Morse's feedback (5,000 characters at most), or saves it as a file.
//
// It's kept self-contained and plain, since it runs as a `javascript:` bookmark: no imports, no
// module syntax.
(() => {
	const NEO = "https://neo.character.ai";
	const AVATARS = "https://characterai.io/i/400/static/avatars/";
	const GAP_MS = 250;
	const BUSY_MS = 10_000;
	/** How long a request may go unanswered before it's given up on and asked again. */
	const PATIENCE_MS = 30_000;

	// One run at a time: run again while one goes, its panel shows; once it's done, a new run starts
	// in its place.
	if (window.__morseExport?.running) {
		window.__morseExport.show();
		return;
	}
	window.__morseExport?.close();
	if (!/(^|\.)character\.ai$/.test(location.hostname)) {
		alert(
			"Open character.ai in this tab and sign in, then run the Morse exporter again.",
		);
		return;
	}
	// Morse's browser extension, where it's the one that ran this (extension/): it runs the exporter
	// in a world of its own beside the page's, and leaves there what takes the file to Morse
	// (`__morseExtension`), where no script of the page's can reach it or stand in for it. The file
	// goes to it too, and the panel offers Open in Morse. Run as a bookmark or in the console, in the
	// page's own world, there's none, and nothing is handed over or offered.
	const extension =
		typeof globalThis.__morseExtension?.hand === "function"
			? globalThis.__morseExtension
			: undefined;

	// The panel: what it's doing, and Stop or Save. It takes focus as it opens, so a keyboard reaches
	// its buttons without crossing the page. It's wide enough for the three buttons a run with the
	// extension ends with to sit in a row, each on one line; on a narrower screen they wrap.
	const panel = document.createElement("div");
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", "Export for Morse");
	panel.tabIndex = -1;
	panel.style.cssText =
		"position:fixed;z-index:2147483647;right:16px;bottom:16px;width:360px;max-width:calc(100vw - 32px);" +
		"background:#fff;color:#111;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);" +
		"font:14px/1.45 system-ui,-apple-system,sans-serif;padding:16px 18px;box-sizing:border-box;";
	const title = document.createElement("div");
	title.style.cssText = "font-weight:600;font-size:15px;margin-bottom:6px;";
	title.textContent = "Saving your Character.AI data for Morse";
	const status = document.createElement("div");
	status.setAttribute("aria-live", "polite");
	const detail = document.createElement("div");
	detail.style.cssText = "color:#555;font-size:13px;margin-top:4px;";
	const buttons = document.createElement("div");
	buttons.style.cssText =
		"display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px;";
	const button = (label, primary) => {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.style.cssText =
			"border:0;border-radius:8px;padding:7px 12px;font:inherit;white-space:nowrap;cursor:pointer;" +
			(primary ? "background:#111;color:#fff;" : "background:#eee;color:#111;");
		buttons.append(b);
		return b;
	};
	const reportButton = button("Copy a report", false);
	reportButton.style.display = "none";
	const stopButton = button("Stop and save", false);
	// Close leads, but where the extension is, Open in Morse does.
	const closeButton = button("Close", !extension);
	closeButton.style.display = "none";
	// The question a run asks when an earlier one stopped partway: start over, or go on from there.
	const overButton = button("Start over", false);
	overButton.style.display = "none";
	const onButton = button("Go on", true);
	onButton.style.display = "none";
	// The extension's way on, once the file it was given is saved.
	const openButton = button("Open in Morse", true);
	openButton.style.display = "none";
	panel.append(title, status, detail, buttons);
	document.body.append(panel);
	panel.focus();

	let stopped = false;
	/** Whether the extension was given the file saved. */
	let handed = false;
	const say = (text, more = "") => {
		status.textContent = text;
		detail.textContent = more;
	};
	window.__morseExport = {
		running: true,
		show: () => {
			document.body.append(panel);
			panel.focus();
		},
		close: () => panel.remove(),
	};
	// The waits and requests going on, each ended at once by Stop, so it isn't held off by a pause
	// or a request that never answers.
	const waits = new Set();
	stopButton.onclick = () => {
		stopped = true;
		stopButton.disabled = true;
		say("Stopping. Saving what's done…");
		for (const wake of waits) wake();
	};
	closeButton.onclick = () => {
		panel.remove();
		delete window.__morseExport;
	};
	// The extension takes the file to Morse's import, at a click or a key of the user's own: one a
	// script makes isn't trusted.
	openButton.onclick = (event) => {
		if (event?.isTrusted) extension?.open();
	};
	const finish = () => {
		if (window.__morseExport) window.__morseExport.running = false;
		stopButton.style.display = "none";
		reportButton.style.display = "";
		closeButton.style.display = "";
		if (handed) openButton.style.display = "";
		// Stop, which may have had it, is gone: focus goes to Open in Morse where it's offered, else
		// to Close, unless it's left the panel.
		if (panel.contains(document.activeElement))
			(handed ? openButton : closeButton).focus();
	};
	// The report, for Morse's feedback; saved as a file where the clipboard won't take it.
	reportButton.onclick = async () => {
		const text = reportText();
		const what =
			"It holds no chats, names, or ids: only what Character.AI answered, and counts.";
		try {
			await navigator.clipboard.writeText(text);
			say(
				"Report copied.",
				`Paste it in Morse under Settings, then Feedback. ${what}`,
			);
		} catch {
			download(
				new Blob([text], { type: "application/json" }),
				`character-ai-export-report-${date}.json`,
			);
			say(
				"Report saved as a file.",
				`Send it with Morse's feedback, under Settings. ${what}`,
			);
		}
	};

	/** Asks whether to go on from an earlier run (true) or start over (false), with Stop out of the
	 * way while it asks. */
	const goOn = (text, more) =>
		new Promise((answer) => {
			say(text, more);
			stopButton.style.display = "none";
			overButton.style.display = "";
			onButton.style.display = "";
			const choose = (on) => () => {
				overButton.style.display = "none";
				onButton.style.display = "none";
				stopButton.style.display = "";
				stopButton.focus();
				answer(on);
			};
			overButton.onclick = choose(false);
			onButton.onclick = choose(true);
			onButton.focus();
		});

	/** Waits `ms`, or until Stop. */
	const sleep = (ms) =>
		new Promise((done) => {
			const wake = () => {
				waits.delete(wake);
				clearTimeout(timer);
				done();
			};
			const timer = setTimeout(wake, ms);
			waits.add(wake);
		});
	const n = (count) => count.toLocaleString("en-US");
	/** The objects in a list an answer gives, or none for anything else: answers can change shape. */
	const listOf = (value) =>
		Array.isArray(value)
			? value.filter((x) => x && typeof x === "object" && !Array.isArray(x))
			: [];
	/** A string with something in it, else undefined. */
	const str = (value) =>
		typeof value === "string" && value.trim() ? value : undefined;

	// The report: nothing in it is the user's own, only how the export went.
	const started = Date.now();
	const report = {
		exporter: 1,
		started: new Date(started).toISOString(),
		token: "none",
		requests: {},
		pauses: 0,
		retries: 0,
		// Chats an earlier run saved, when this one went on from it.
		resumed: 0,
		fields: {},
		counts: {
			characters: 0,
			chats: 0,
			chatsRefused: 0,
			turns: 0,
			pictures: 0,
			picturesMissing: 0,
			memories: 0,
			definitions: 0,
		},
	};
	/** The words of the API's paths this asks for: any other part of a path is an id. */
	const WORDS = new Set([
		"",
		"user",
		"character",
		"v1",
		"get_user_personas",
		"get_characters_created_by_user",
		"get_character",
		"get_character_info",
		"chats",
		"recent",
		"turns",
		"chat",
		"conversation-facts",
	]);
	/** A request's path with every id in it as `:id`, so the report names the kind, not the chat. */
	const kindOf = (path) =>
		path
			.replace(/\?.*$/, "")
			.split("/")
			.map((part) => (WORDS.has(part) ? part : ":id"))
			.join("/");
	/** The names of the fields Character.AI's answers are known to hold (docs/design/character-import.md).
	 * Only these go in the report, any other as `?`: a field's name can be anything, a map's keys can
	 * be names, and a name of letters can't be told from a person's. */
	const FIELDS = new Set(
		(
			"account additional_greetings allow_dynamic_greeting author author_id avatar_file_name " +
			"avatar_type avatar_url background_image_url base_candidate_id base_img_prompt bio " +
			"candidate_id candidates categories character character_avatar_uri character_id " +
			"character_name character_translations character_visibility characters chat chat_id chats " +
			"command comment comments_enabled conversation_fact_overrides copyable create_time created " +
			"creator_id default_voice_id definition description dynamic_greeting_enabled editor error " +
			"external_id first_name greeting has_definition id identifier img_gen_enabled " +
			"img_prompt_regex is_final is_human is_licensed_professional is_persona is_pinned is_staff " +
			"last_update_time lorebook_id meta model_type name narrator next_token onboarding_complete " +
			"operation overrides participant__name participant__num_interactions " +
			"participant__user__username personas preview_turns primary_candidate_id raw_content " +
			"remix_count safety_truncated short_hash songs starter_prompts state status streak " +
			"strip_img_prompt_from_msg title tti_image_rel_path turn_id turn_key turns type updated " +
			"upvotes usage user user__id user__username username value visibility voice_id"
		).split(" "),
	);
	const fieldName = (key) => (FIELDS.has(key) ? key : "?");
	const tally = (kind, answer) => {
		const kinds = report.requests;
		kinds[kind] = kinds[kind] ?? {};
		kinds[kind][answer] = (kinds[kind][answer] ?? 0) + 1;
	};
	/** The field names an answer held, two levels down (a list by its first item), others as `?`. */
	function fieldsOf(kind, json) {
		const seen = new Set(report.fields[kind] ?? []);
		const walk = (value, at, depth) => {
			const item = Array.isArray(value) ? value[0] : value;
			if (!item || typeof item !== "object" || depth > 2) return;
			for (const key of Object.keys(item)) {
				const name = `${at}${fieldName(key)}`;
				seen.add(name);
				if (fieldName(key) === "?") continue;
				walk(
					item[key],
					`${name}${Array.isArray(item[key]) ? "[]" : ""}.`,
					depth + 1,
				);
			}
		};
		walk(json, "", 1);
		report.fields[kind] = [...seen].slice(0, 40);
	}
	/** Our own errors, which the report keeps as they are; of any other, only its kind (TypeError),
	 * since a message can quote what Character.AI sent. */
	const OURS =
		/^(stopped|signed-out|refused|timeout|Character\.AI answered \d{3})$/;
	const codeOf = (error) =>
		String(
			OURS.test(error?.message) ? error.message : (error?.name ?? "unknown"),
		).slice(0, 80);
	/** The report as text, cut to what Morse's feedback takes: field names go first if it's long,
	 * then each answer's status, to its class (4xx). */
	function reportText() {
		report.seconds = Math.round((Date.now() - started) / 1000);
		const long = () => JSON.stringify(report).length > 4800;
		for (const kind of Object.keys(report.fields)) {
			if (!long()) break;
			delete report.fields[kind];
			report.fieldsCut = true;
		}
		if (long()) {
			for (const [kind, answers] of Object.entries(report.requests)) {
				const classes = {};
				for (const [answer, count] of Object.entries(answers)) {
					const to = /^\d{3}$/.test(answer) ? `${answer[0]}xx` : answer;
					classes[to] = (classes[to] ?? 0) + count;
				}
				report.requests[kind] = classes;
			}
			report.requestsCut = true;
		}
		if (long()) report.requests = {};
		return JSON.stringify(report);
	}

	/** A fetch that Stop ends at once, given up on after PATIENCE_MS (`timeout`); `read` reads its
	 * answer under the same watch, since a body can stall too. */
	async function fetched(url, init, read) {
		if (stopped) throw new Error("stopped");
		const controller = new AbortController();
		let late = false;
		const timer = setTimeout(() => {
			late = true;
			controller.abort();
		}, PATIENCE_MS);
		const stop = () => controller.abort();
		waits.add(stop);
		try {
			const res = await fetch(url, { ...init, signal: controller.signal });
			return { res, body: await read(res) };
		} catch (error) {
			if (stopped) throw new Error("stopped");
			throw late ? new Error("timeout") : error;
		} finally {
			clearTimeout(timer);
			waits.delete(stop);
		}
	}

	// The session: Character.AI's pages carry the signed-in user's API token in their Next.js data.
	async function findToken() {
		const fromData = (text) => {
			try {
				const token = JSON.parse(text)?.props?.pageProps?.token;
				return typeof token === "string" && token
					? `Token ${token}`
					: undefined;
			} catch {
				return undefined;
			}
		};
		const here = document.getElementById("__NEXT_DATA__")?.textContent;
		const token = here && fromData(here);
		if (token) {
			report.token = "page";
			return token;
		}
		try {
			const { body } = await fetched(
				`/?_d=${Date.now()}`,
				{ cache: "no-store" },
				(res) => res.text(),
			);
			const doc = new DOMParser().parseFromString(body, "text/html");
			const text = doc.getElementById("__NEXT_DATA__")?.textContent;
			const fetchedToken = text ? fromData(text) : undefined;
			if (fetchedToken) report.token = "fetched";
			return fetchedToken;
		} catch (error) {
			if (error?.message === "stopped") throw error;
			return undefined;
		}
	}

	let token;
	let last = 0;
	/** One API request, after the gap since the last, again after a rest when Character.AI says
	 * it's busy, and up to four times on a server or network error. Null for a 404. A 401 or 403
	 * ends the export as signed out only when the user's profile is refused too: else it's this one
	 * thing Character.AI won't give (`refused`), such as a character taken down. */
	async function api(path, body) {
		// Tries count server and network errors only: a pause Character.AI asks for (429) is waited
		// out however often it comes, or a busy hour would spend them and end the export.
		for (let tries = 0; ; ) {
			const wait = last + GAP_MS - Date.now();
			if (wait > 0) await sleep(wait);
			// Stop is heard between tries too, or a long run of 429s would hold it off for good.
			if (stopped) throw new Error("stopped");
			last = Date.now();
			const kind = kindOf(path);
			let res;
			let json;
			try {
				({ res, body: json } = await fetched(
					NEO + path,
					{
						method: body ? "POST" : "GET",
						headers: {
							accept: "application/json",
							"content-type": "application/json",
							authorization: token,
						},
						...(body && { body: JSON.stringify(body) }),
					},
					(res) => (res.ok ? res.json() : undefined),
				));
			} catch (error) {
				if (error?.message === "stopped") throw error;
				tally(
					kind,
					error?.message === "timeout"
						? "timeout"
						: error?.name === "SyntaxError"
							? "unreadable"
							: "network",
				);
				if (tries >= 4) throw error;
				report.retries++;
				await sleep(1000 * 2 ** tries++);
				continue;
			}
			tally(kind, res.status);
			if (stopped) throw new Error("stopped");
			if (res.status === 429) {
				report.pauses++;
				detail.textContent =
					"Character.AI asked for a pause. Going on in a few seconds…";
				await sleep(BUSY_MS);
				continue;
			}
			if (res.status === 401 || res.status === 403) {
				if (path === "/user/" || !(await signedIn()))
					throw new Error("signed-out");
				throw new Error("refused");
			}
			if (res.status === 404) return null;
			if (!res.ok) {
				if (tries >= 4) throw new Error(`Character.AI answered ${res.status}`);
				report.retries++;
				await sleep(1000 * 2 ** tries++);
				continue;
			}
			fieldsOf(kind, json);
			return json;
		}
	}

	/** Whether the session still holds: Character.AI gives the user their profile. */
	async function signedIn() {
		try {
			await api("/user/");
			return true;
		} catch (error) {
			if (error?.message === "signed-out") return false;
			throw error;
		}
	}

	/** A request whose answer the export can go without (a character's details, a chat's memory):
	 * null when it fails, but Stop and a signed-out session still end the export, or Stop would
	 * save a character or chat without them that a later run couldn't mend. */
	const optional = (asked) =>
		asked.catch((error) => {
			if (error?.message === "stopped" || error?.message === "signed-out")
				throw error;
			return null;
		});
	/** A request Character.AI may refuse with the session still good: null then. */
	const unlessRefused = (asked) =>
		asked.catch((error) => {
			if (error?.message === "refused") return null;
			throw error;
		});

	/** A picture as a data URL, or undefined if it can't be had. */
	async function picture(file) {
		if (!str(file)) return undefined;
		try {
			const { body: blob } = await fetched(
				`${AVATARS + file}?anim=0`,
				{},
				(res) => (res.ok ? res.blob() : undefined),
			);
			if (!blob?.type.startsWith("image/")) {
				report.counts.picturesMissing++;
				return undefined;
			}
			report.counts.pictures++;
			return await new Promise((done) => {
				const reader = new FileReader();
				reader.onload = () => done(reader.result);
				reader.onerror = () => done(undefined);
				reader.readAsDataURL(blob);
			});
		} catch (error) {
			if (error?.message === "stopped") throw error;
			report.counts.picturesMissing++;
			return undefined;
		}
	}

	/** When a turn was sent, in ms, or undefined where it doesn't say. */
	const sentAt = (turn) => {
		const t = Date.parse(turn.create_time);
		return Number.isFinite(t) ? t : undefined;
	};

	/** Every turn of a chat, oldest first, or null when Stop came before its oldest page: a chat
	 * saved without its start would be imported so, and never again whole. The API pages them newest
	 * first. A page with no turns new to it, or a next page asked for already, ends the chat: an
	 * answer that named the same page again would page forever, and pages a turn sent since shifts
	 * overlap. */
	async function turnsOf(chatId, onPage) {
		const pages = [];
		const tokens = new Set();
		const seen = new Set();
		let next;
		let fresh;
		do {
			if (stopped) return null;
			const page = await api(
				`/turns/${encodeURIComponent(chatId)}/${next ? `?next_token=${encodeURIComponent(next)}` : ""}`,
			);
			fresh = listOf(page?.turns).filter((t) => {
				const id = t.turn_key?.turn_id;
				if (id === undefined) return true;
				if (seen.has(id)) return false;
				seen.add(id);
				return true;
			});
			pages.push(fresh);
			onPage(fresh.length);
			tokens.add(next);
			next = page?.meta?.next_token;
		} while (next && fresh.length && !tokens.has(next));
		const turns = pages.reverse().flatMap((p) => p.reverse());
		// By their times, where every turn has one, whatever order the pages came in.
		return turns.every((t) => sentAt(t) !== undefined)
			? turns.sort((a, b) => sentAt(a) - sentAt(b))
			: turns;
	}

	/** A character's name, where an answer gives one. */
	const nameOf = (c) => str(c?.name) ?? str(c?.participant__name);

	/** A character, with its definition if the user made it, or null when no answer names it: a
	 * character taken down answers with an error, or with nothing. */
	async function characterOf(id, mine) {
		const ask = (what) =>
			optional(api(`/character/v1/${what}`, { external_id: id }));
		const first = await ask(mine ? "get_character" : "get_character_info");
		if (nameOf(first?.character)) return first.character;
		const other = await ask(mine ? "get_character_info" : "get_character");
		return nameOf(other?.character) ? other.character : null;
	}

	const date = new Date().toISOString().slice(0, 10);

	// What the files saved so far hold, kept in this browser (character.ai's own storage) once a run
	// is cut short, so the next run can go on from there: the ids of their chats and characters,
	// and how many files there are. Nothing else of the user's. It goes once a run saves all that was
	// left, and when the user starts over.
	const progress = { key: "", earlier: null, part: 1 };
	/** What earlier runs saved, as kept under `key`, or null. */
	function recalled(key) {
		try {
			const kept = JSON.parse(localStorage.getItem(key) ?? "null");
			if (
				!kept ||
				!Array.isArray(kept.chats) ||
				!Array.isArray(kept.characters)
			)
				return null;
			return {
				at: str(kept.at),
				parts: Number.isInteger(kept.parts) && kept.parts > 0 ? kept.parts : 1,
				chats: kept.chats.filter(str),
				characters: kept.characters.filter(str),
			};
		} catch {
			return null;
		}
	}
	/** Keeps `value` under the run's key, or forgets it (null). A browser that won't keep it just
	 * starts over next time. */
	function keep(value) {
		try {
			if (value) localStorage.setItem(progress.key, JSON.stringify(value));
			else localStorage.removeItem(progress.key);
		} catch {}
	}
	/** After a file is saved: what the files hold so far, kept for the next run while some is left,
	 * and forgotten once this file has all that was. */
	function remember() {
		if (!progress.key) return;
		if (!out.partial) return keep(null);
		const { earlier } = progress;
		keep({
			at: new Date().toISOString(),
			parts: progress.part,
			chats: [
				...(earlier?.chats ?? []),
				...out.characters.flatMap((c) => c.chats.map((chat) => chat.id)),
			],
			characters: [
				...(earlier?.characters ?? []),
				...out.characters.map((c) => c.character.external_id),
			],
		});
	}
	const out = {
		format: "morse.cai-export",
		version: 1,
		exportedAt: new Date().toISOString(),
		source: "character.ai",
		user: null,
		personas: [],
		characters: [],
	};

	/** A chat as the file holds it, written as it's read, a turn at a time: a long history is held
	 * once, as the file's text, not as the API's objects and then again as the file. */
	function chatFile(chat, turns) {
		const parts = [JSON.stringify(chat).slice(0, -1), ',"turns":['];
		turns.forEach((t, i) => {
			parts.push(i ? "," : "", JSON.stringify(t));
		});
		parts.push("]}");
		return new Blob(parts);
	}

	/** The file, a part at a time: no one string holds it all, which for a long history would be
	 * longer than a browser's longest string. */
	function file() {
		const { characters, ...head } = out;
		const parts = [JSON.stringify(head).slice(0, -1), ',"characters":['];
		characters.forEach((entry, i) => {
			parts.push(
				i ? "," : "",
				JSON.stringify({
					character: entry.character,
					avatar: entry.avatar,
				}).slice(0, -1),
				',"chats":[',
			);
			entry.chats.forEach((chat, j) => {
				parts.push(j ? "," : "", chat.file);
			});
			parts.push("]}");
		});
		parts.push("]}");
		return new Blob(parts, { type: "application/json" });
	}

	function download(blob, name) {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
	}

	/** Gives the extension, where it ran this, the file saved as `name`, for Open in Morse. One that
	 * won't take it goes without, as a run without the extension does. */
	function handOver(saved, name) {
		if (!extension) return;
		try {
			extension.hand({ name, file: saved, partial: !!out.partial });
			handed = true;
		} catch {}
	}

	/** Saves the file, or says it couldn't (false). */
	function save() {
		const chats = out.characters.flatMap((c) => c.chats);
		Object.assign(report.counts, {
			characters: out.characters.length,
			chats: chats.length,
			turns: chats.reduce((sum, c) => sum + c.turns, 0),
			memories: chats.filter((c) => c.memory).length,
			definitions: out.characters.filter((c) => c.character.definition).length,
		});
		if (out.partial) report.partial = true;
		const part = progress.part > 1 ? `-part-${progress.part}` : "";
		const name = `character-ai-export-${date}${part}${out.partial ? "-partial" : ""}.json`;
		// A run that went on from one cut short says so in its file too, so an import of it alone
		// can say that what the earlier files hold isn't in it.
		if (progress.part > 1) out.part = progress.part;
		try {
			const saved = file();
			download(saved, name);
			remember();
			handOver(saved, name);
			return true;
		} catch (error) {
			report.error = codeOf(error);
			say(
				"Couldn't save the file.",
				"Copy a report and send it with Morse's feedback, under Settings.",
			);
			return false;
		}
	}

	async function run() {
		say("Finding your session…");
		token = await findToken();
		if (!token) {
			say(
				"Sign in to Character.AI in this tab first, then run the exporter again.",
			);
			return;
		}
		const me = await optional(api("/user/"));
		const user = me?.user?.user;
		out.user =
			user && typeof user === "object"
				? {
						id: user.id,
						username: user.username,
						name: user.account?.name ?? me.user.name,
					}
				: null;

		// An earlier run cut short: go on from there, or start over.
		progress.key = `morse-export:${out.user?.id ?? "me"}`;
		const earlier = recalled(progress.key);
		if (earlier && (earlier.chats.length || earlier.characters.length)) {
			const when = earlier.at
				? ` on ${new Date(earlier.at).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
				: "";
			const saved = `${n(earlier.chats.length)} ${earlier.chats.length === 1 ? "chat" : "chats"}`;
			const on = await goOn(
				`Your export${when} stopped partway, with ${saved} saved.`,
				"Go on, and this run saves the rest as a file of its own, to import with the earlier one. Or start over and save everything again.",
			);
			if (on) {
				progress.earlier = earlier;
				progress.part = earlier.parts + 1;
				report.resumed = earlier.chats.length;
			} else keep(null);
		}

		say("Reading your personas and characters…");
		const personas = await optional(
			api("/character/v1/get_user_personas?force_refresh=0"),
		);
		out.personas = listOf(personas?.personas);
		const created = await optional(
			api("/character/v1/get_characters_created_by_user"),
		);
		const mine = new Map();
		for (const c of listOf(created?.characters))
			if (str(c.external_id)) mine.set(c.external_id, c);

		say("Finding your chats…");
		const recent = listOf((await unlessRefused(api("/chats/recent/")))?.chats);
		const ids = [];
		for (const c of recent)
			if (str(c.character_id) && !ids.includes(c.character_id))
				ids.push(c.character_id);
		for (const id of mine.keys()) if (!ids.includes(id)) ids.push(id);

		// Chats taken already, so one listed twice, or under two characters, is read once; and those
		// an earlier run saved, when going on from it.
		const taken = new Set(progress.earlier?.chats);
		const savedBefore = new Set(progress.earlier?.characters);
		let messages = 0;
		for (const [i, id] of ids.entries()) {
			if (stopped) break;
			const listed = await unlessRefused(
				api(
					`/chats/?character_ids=${encodeURIComponent(id)}&num_preview_turns=2`,
				),
			);
			const all = [
				...listOf(listed?.chats),
				...recent.filter((c) => c.character_id === id),
			];
			const chats = all.filter((c) => {
				if (!str(c.chat_id) || taken.has(c.chat_id)) return false;
				if (str(c.character_id) && c.character_id !== id) return false;
				taken.add(c.chat_id);
				return true;
			});
			// One an earlier run saved, with no chat since, is in that run's file already.
			if (savedBefore.has(id) && !chats.length) continue;
			const own = mine.get(id);
			const character = {
				...own,
				...(await characterOf(id, !!own)),
				external_id: id,
			};
			if (!str(character.definition) && str(own?.definition))
				character.definition = own.definition;
			// One no answer names takes the name its chats give it.
			if (!nameOf(character)) {
				const named = all.map((c) => str(c.character_name)).find(Boolean);
				if (named) character.name = named;
			}
			const entry = {
				character,
				avatar: await picture(
					str(character.avatar_file_name) ??
						all.map((c) => str(c.character_avatar_uri)).find(Boolean),
				),
				chats: [],
			};
			out.characters.push(entry);
			for (const [j, c] of chats.entries()) {
				if (stopped) break;
				const progress = () =>
					say(
						`${nameOf(character) ?? "A character"}: chat ${j + 1} of ${chats.length}`,
						`Character ${i + 1} of ${ids.length}. ${n(messages)} ${messages === 1 ? "message" : "messages"} so far.`,
					);
				progress();
				let turns;
				try {
					turns = await turnsOf(c.chat_id, (count) => {
						messages += count;
						progress();
					});
				} catch (error) {
					// A chat Character.AI won't give, with the session still good, is left out.
					if (error?.message !== "refused") throw error;
					report.counts.chatsRefused++;
					continue;
				}
				if (!turns) break;
				if (!nameOf(character)) {
					const author = turns
						.map((t) => t.author)
						.find((a) => a && a.is_human !== true && str(a.name));
					if (author) character.name = author.name;
				}
				const facts = await optional(
					api(`/chat/${encodeURIComponent(c.chat_id)}/conversation-facts/`),
				);
				const memory = str(
					facts?.conversation_fact_overrides?.narrator?.overrides?.[
						"MEMORY BOX"
					]?.value,
				);
				const chat = {
					chat_id: c.chat_id,
					create_time: c.create_time,
					...(memory && { memory }),
				};
				entry.chats.push({
					id: c.chat_id,
					memory: !!memory,
					turns: turns.length,
					file: chatFile(chat, turns),
				});
			}
		}
		if (!stopped) {
			if (save()) say("Done. Your file is downloading.", summary());
			return;
		}
		out.partial = true;
		stoppedSaying();
	}

	/** Whether anything was read to save: a character, or a persona. */
	const anything = () => out.characters.length > 0 || out.personas.length > 0;

	/** Saves what was done when Stop came, and says so; or says nothing was, before anything was
	 * read, since then no file comes. */
	function stoppedSaying() {
		if (!anything())
			say(
				"Stopped before anything was read, so no file was saved.",
				"Run the exporter again when you're ready.",
			);
		else if (save()) say("Saved what was done.", summary());
	}

	/** What the file holds, counted from the file: a chat Stop cut short isn't in it. */
	function summary() {
		const chats = out.characters.flatMap((c) => c.chats);
		const turns = chats.reduce((sum, c) => sum + c.turns, 0);
		const count = (k, one) => `${n(k)} ${k === 1 ? one : `${one}s`}`;
		const held = `${count(out.characters.length, "character")}, ${count(chats.length, "chat")}, and ${count(turns, "message")}.`;
		const before = progress.part - 1;
		const earlierFiles =
			before === 1 ? "the earlier file" : `the ${n(before)} earlier files`;
		// With Morse's extension, Open in Morse takes each file as it's saved, so each is imported
		// in its turn, rather than all of them together at the end.
		if (out.partial)
			return handed
				? `${held} Choose Open in Morse to import what's saved so far, then run the exporter again in this browser for the rest.`
				: `${held} Run the exporter again in this browser to go on from here, then import every file it saved together.`;
		if (before)
			return handed
				? `${held} That's the rest: choose Open in Morse to import it.`
				: `${held} That's the rest: import this file together with ${earlierFiles}.`;
		return handed
			? `${held} Choose Open in Morse to import it.`
			: `${held} Open Morse, go to Characters, choose Import, and pick the file.`;
	}

	run()
		.catch((error) => {
			// Our own error codes and the browser's kinds of error: never anything Character.AI wrote.
			report.error = codeOf(error);
			out.partial = true;
			if (error?.message === "stopped") {
				stoppedSaying();
				return;
			}
			const kept = anything() && save();
			if (anything() && !kept) return;
			say(
				error?.message === "signed-out"
					? "Character.AI signed you out. Sign in again, then run the exporter again."
					: "Something went wrong reading Character.AI.",
				kept
					? "What was read so far is saved. Run the exporter again for the rest."
					: String(error?.message ?? error),
			);
		})
		// However it ended, it's done: the panel offers the report and Close, and a new run can start.
		.finally(finish);
})();
