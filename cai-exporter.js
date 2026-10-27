// Morse's exporter. The user runs it on a site they're leaving, signed in, from a bookmark or the
// browser's console: Character.AI, Chai, JanitorAI, or Chub. It reads their own data over
// the same API the site's own pages use (their chats, every message, the characters they talked to
// and, on Character.AI, made, and their personas) and saves it as one JSON file that Morse's import
// reads (`morse.cai-export` from Character.AI, `morse.export` from the others; formats.ts). Nothing
// goes anywhere but that file: no request leaves for any site but the one it's run on (and where
// that site keeps its pictures). Run by Morse's browser extension, it hands the file to the extension
// too, to take to Morse in the same browser.
//
// One request at a time, a quarter second apart, and ten seconds' rest whenever the site asks for
// it (429), so a long history doesn't load the site. Stop saves what's done so far, and the next run
// in the same browser can go on from there, saving only the rest as a file of its own.
//
// It keeps a report as it goes, for when an export goes wrong: what it asked the site and how each
// kind of request was answered, the names of the fields the answers held, and how much it read.
// Never a message, a name, an id, or a picture. "Copy a report" puts it on the clipboard to paste
// into Morse's feedback (5,000 characters at most), or saves it as a file.
//
// It reads only what the site shows the user: a definition a creator hid stays hidden.
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

	// The sites it reads, each by the address of its pages: how to find the user's session there and
	// ask its API, the words of its API's paths and the names of the fields its answers hold (all the
	// report keeps of them), and how to read the account. Each site's own reading is further down.
	const SITES = [
		{
			host: /(^|\.)character\.ai$/,
			name: "Character.AI",
			source: "character.ai",
			format: "morse.cai-export",
			file: "character-ai-export",
			// The progress kept between runs, under this key and the user's id, as it always was.
			keep: "morse-export",
			list: "turns",
			api: NEO,
			headers: (token) => ({
				accept: "application/json",
				"content-type": "application/json",
				authorization: token,
			}),
			profile: "/user/",
			token: characterAiToken,
			read: readCharacterAi,
			words:
				" user character v1 get_user_personas get_characters_created_by_user get_character " +
				"get_character_info chats recent turns chat conversation-facts",
			fields:
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
				"upvotes usage user user__id user__username username value visibility voice_id",
		},
		{
			host: /(^|\.)janitorai\.com$/,
			name: "JanitorAI",
			source: "janitorai.com",
			format: "morse.export",
			file: "janitorai-export",
			keep: "morse-export:janitorai.com",
			list: "messages",
			api: "",
			headers: bearer,
			profile: "/hampter/profiles/mine",
			// The session's token lasts hours, and the page renews it: one that stops working is read
			// again before the session counts as ended.
			renews: true,
			token: janitorToken,
			read: readJanitor,
			words:
				" hampter chats character-chats character characters script profiles mine",
			fields:
				"allow_proxy appearance avatar character character_id character_name chat chat_count " +
				"chatMessages chat_id chats created_at creator_id creator_name description " +
				"example_dialogs first_message first_messages hasMore id is_bot is_deleted is_main " +
				"is_nsfw is_public last_chat_date message name page personality personas persona_id " +
				"scenario script scripts showdefinition summary tags title totalCharacters totalChats " +
				"updated_at user_name",
		},
		{
			host: /(^|\.)chai-ai\.com$/,
			name: "Chai",
			source: "chai-ai.com",
			format: "morse.export",
			file: "chai-export",
			keep: "morse-export:chai-ai.com",
			list: "messages",
			api: "",
			headers: bearer,
			profile: "/api/auth/me",
			// The session's token lasts an hour, and the page renews it.
			renews: true,
			token: chaiToken,
			read: readChai,
			words: " api conversations feed bots config persona auth me",
			fields:
				"art_style bot_name bot_persona bot_uid content conversation_id conversations " +
				"created_at developer_name first_message gender has_more image_url is_story " +
				"last_message_at memory message_id messages name next_cursor sender status " +
				"story_characters tags user_id user_name user_persona",
		},
		{
			host: /(^|\.)chub\.ai$/,
			name: "Chub",
			source: "chub.ai",
			format: "morse.export",
			file: "chub-export",
			keep: "morse-export:chub.ai",
			list: "messages",
			api: "https://gateway.chub.ai",
			headers: (token) => ({ accept: "application/json", "CH-API-KEY": token }),
			profile: "/api/account",
			token: chubToken,
			read: readChub,
			words: " api core chats v2 account personas",
			fields:
				"alternate_greetings avatar character_id character_ids characters chat chat_id " +
				"chat_profile chatMessages chats child_ids created_at cursor description " +
				"embedded_lorebook example_dialogs first_message full_path id is_bot is_main level " +
				"message name parent_id persona_name personality personas roots scenario summary " +
				"system_prompt total updated_at user_name",
		},
	];
	const site = SITES.find((s) => s.host.test(location.hostname));
	if (!site) {
		alert(
			"Open Character.AI, Chai, JanitorAI, or Chub in this tab and sign in, then run the Morse exporter again.",
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
	title.textContent = `Saving your ${site.name} data for Morse`;
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
	// The report as a whole run offers it: a line under what the panel says, not a button.
	const quietReport = document.createElement("button");
	quietReport.type = "button";
	quietReport.textContent = "Something missing? Copy a report";
	quietReport.style.cssText =
		"border:0;background:none;padding:0;margin-top:8px;font:inherit;font-size:13px;color:#555;" +
		"text-decoration:underline;cursor:pointer;text-align:left;";
	quietReport.style.display = "none";
	panel.append(title, status, detail, quietReport, buttons);
	document.body.append(panel);
	panel.focus();

	let stopped = false;
	/** Whether a file was saved. */
	let saved = false;
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
		// The report is for a run that went wrong. One that saved everything, with no chat refused,
		// offers it quietly, under what it says, for something missing from the file: as a button
		// beside Close, it read as a last step, and came to Morse's feedback with no word of what
		// was wrong.
		const whole =
			saved && !out.partial && !report.error && !report.counts.chatsRefused;
		(whole ? quietReport : reportButton).style.display = "";
		closeButton.style.display = "";
		if (handed) openButton.style.display = "";
		// Stop, which may have had it, is gone: focus goes to Open in Morse where it's offered, else
		// to Close, unless it's left the panel.
		if (panel.contains(document.activeElement))
			(handed ? openButton : closeButton).focus();
	};
	// The report, for Morse's feedback; saved as a file where the clipboard won't take it.
	reportButton.onclick = quietReport.onclick = async () => {
		const text = reportText();
		const what = `It holds no chats, names, or ids: only what ${site.name} answered, and counts.`;
		try {
			await navigator.clipboard.writeText(text);
			say(
				"Report copied.",
				`Paste it in Morse under Settings, then Feedback, and say what went wrong. ${what}`,
			);
		} catch {
			download(
				new Blob([text], { type: "application/json" }),
				`${site.file}-report-${date}.json`,
			);
			say(
				"Report saved as a file.",
				`Send it with Morse's feedback, under Settings, and say what went wrong. ${what}`,
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
	/** An id as a string, from a string or a number, else undefined. */
	const idOf = (value) =>
		typeof value === "number" && Number.isFinite(value)
			? String(value)
			: str(value);

	// The report: nothing in it is the user's own, only how the export went.
	const started = Date.now();
	const report = {
		exporter: 1,
		...(site.source !== "character.ai" && { site: site.source }),
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
	const WORDS = new Set(site.words.split(" "));
	/** A request's path with every id in it as `:id`, so the report names the kind, not the chat. */
	const kindOf = (path) =>
		path
			.replace(/\?.*$/, "")
			.split("/")
			.map((part) => (WORDS.has(part) ? part : ":id"))
			.join("/");
	/** The names of the fields the site's answers are known to hold (docs/design/character-import.md).
	 * Only these go in the report, any other as `?`: a field's name can be anything, a map's keys can
	 * be names, and a name of letters can't be told from a person's. */
	const FIELDS = new Set(site.fields.split(" "));
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
	 * since a message can quote what the site sent. */
	const OURS =
		/^(stopped|signed-out|refused|timeout|(Character\.AI|JanitorAI|Chai|Chub) answered \d{3})$/;
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

	/** The headers of a site that takes the session's token as a bearer's. */
	function bearer(token) {
		return { accept: "application/json", authorization: `Bearer ${token}` };
	}

	let token;
	let last = 0;
	/** One API request, after the gap since the last, again after a rest when the site says it's
	 * busy, and up to four times on a server or network error. Null for a 404. A 401 or 403 ends the
	 * export as signed out only when the user's profile is refused too (and, where the page renews
	 * the session's token, the token read again is no other): else it's this one thing the site
	 * won't give (`refused`), such as a character taken down. */
	async function api(path, body) {
		// Tries count server and network errors only: a pause the site asks for (429) is waited
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
					site.api + path,
					{
						method: body ? "POST" : "GET",
						headers: site.headers(token),
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
				detail.textContent = `${site.name} asked for a pause. Going on in a few seconds…`;
				await sleep(BUSY_MS);
				continue;
			}
			if (res.status === 401 || res.status === 403) {
				if (site.renews) {
					const renewed = await site.token();
					if (renewed && renewed !== token) {
						token = renewed;
						continue;
					}
				}
				if (path === site.profile || !(await signedIn()))
					throw new Error("signed-out");
				throw new Error("refused");
			}
			if (res.status === 404) return null;
			if (!res.ok) {
				if (tries >= 4) throw new Error(`${site.name} answered ${res.status}`);
				report.retries++;
				await sleep(1000 * 2 ** tries++);
				continue;
			}
			fieldsOf(kind, json);
			return json;
		}
	}

	/** Whether the session still holds: the site gives the user their profile. */
	async function signedIn() {
		try {
			await api(site.profile);
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
	/** A request the site may refuse with the session still good: null then. */
	const unlessRefused = (asked) =>
		asked.catch((error) => {
			if (error?.message === "refused") return null;
			throw error;
		});

	/** A picture at `url` as a data URL, or undefined if it can't be had. */
	async function picture(url) {
		if (!str(url)) return undefined;
		try {
			const { body: blob } = await fetched(url, {}, (res) =>
				res.ok ? res.blob() : undefined,
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

	/** When `value` says something happened, in ms, or undefined where it doesn't say. */
	const timeOf = (value) => {
		const t = Date.parse(value);
		return Number.isFinite(t) ? t : undefined;
	};
	/** When a turn was sent, in ms, or undefined where it doesn't say. */
	const sentAt = (turn) => timeOf(turn.create_time);
	/** `items` oldest first by `at`, where every one has a time; else as they came. */
	const oldestFirst = (items, at) =>
		items.every((x) => timeOf(at(x)) !== undefined)
			? [...items].sort((a, b) => timeOf(at(a)) - timeOf(at(b)))
			: items;

	/** Every page of a list the site pages, as `page(cursor)` asks for each: `{ items, next }`, with
	 * `next` the cursor of the page after, none at the last. A page with nothing new on it, or a
	 * cursor asked for already, ends it: an answer that named the same page again would page
	 * forever. Each item's `key` says which it is. */
	async function everyPage(page, key) {
		const items = [];
		const seen = new Set();
		const cursors = new Set();
		let cursor;
		for (;;) {
			if (stopped) throw new Error("stopped");
			const { items: got, next } = await page(cursor);
			const fresh = got.filter((x) => {
				const k = key(x);
				if (k === undefined || seen.has(k)) return false;
				seen.add(k);
				return true;
			});
			items.push(...fresh);
			cursors.add(String(cursor));
			if (next === undefined || next === null || !fresh.length) break;
			if (cursors.has(String(next))) break;
			cursor = next;
		}
		return items;
	}

	// Character.AI.

	// The session: Character.AI's pages carry the signed-in user's API token in their Next.js data.
	async function characterAiToken() {
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

	/** Who the user is on Character.AI, as its profile says. */
	async function characterAiUser() {
		const me = await optional(api("/user/"));
		const user = me?.user?.user;
		return user && typeof user === "object"
			? {
					id: user.id,
					username: user.username,
					name: user.account?.name ?? me.user.name,
				}
			: null;
	}

	/** Everything the user has on Character.AI: their personas, the characters they made, and every
	 * chat with each character they talked to. */
	async function readCharacterAi() {
		out.user = await characterAiUser();
		await remembered();
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
			const file =
				str(character.avatar_file_name) ??
				all.map((c) => str(c.character_avatar_uri)).find(Boolean);
			const entry = {
				id,
				character,
				avatar: file && (await picture(`${AVATARS + file}?anim=0`)),
				defined: !!character.definition,
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
	}

	// The other sites, each read the same way: the characters the user has chats with, each with its
	// chats, from `characters()`; each character's details from `describe`; each chat whole from
	// `chat`, as `{ head, messages }`, or null when Stop came before its start.

	/** Every character in `characters` (`{ id, name }`), with the chats `chatsOf` lists for it (each
	 * with its `id`), read into the file: each chat once, and none an earlier run saved. */
	async function readEach(characters, { chatsOf, describe, chat }) {
		const taken = new Set(progress.earlier?.chats);
		const savedBefore = new Set(progress.earlier?.characters);
		let messages = 0;
		for (const [i, listed] of characters.entries()) {
			if (stopped) break;
			say(
				`${listed.name ?? "A character"}`,
				`Character ${i + 1} of ${characters.length}.`,
			);
			const chats = (await chatsOf(listed)).filter((c) => {
				if (c.id === undefined || taken.has(c.id)) return false;
				taken.add(c.id);
				return true;
			});
			// One an earlier run saved, with no chat since, is in that run's file already.
			if (savedBefore.has(listed.id) && !chats.length) continue;
			const described = await describe(listed);
			const entry = {
				id: listed.id,
				character: described.character,
				avatar: await picture(described.picture),
				...(described.lore?.length && { lore: described.lore }),
				defined: !!described.defined,
				chats: [],
			};
			out.characters.push(entry);
			for (const [j, c] of chats.entries()) {
				if (stopped) break;
				const progress = () =>
					say(
						`${listed.name ?? "A character"}: chat ${j + 1} of ${chats.length}`,
						`Character ${i + 1} of ${characters.length}. ${n(messages)} ${messages === 1 ? "message" : "messages"} so far.`,
					);
				progress();
				let read;
				try {
					read = await chat(c, listed, (count) => {
						messages += count;
						progress();
					});
				} catch (error) {
					// A chat the site won't give, with the session still good, is left out.
					if (error?.message !== "refused") throw error;
					report.counts.chatsRefused++;
					continue;
				}
				if (!read) break;
				entry.chats.push({
					id: c.id,
					memory: !!read.head.memory,
					turns: read.messages.length,
					file: chatFile(read.head, read.messages),
				});
			}
		}
	}

	/** Adds a persona to the file, once by its name. */
	function persona(p) {
		const name = str(p?.name) ?? str(p?.persona_name);
		if (
			!name ||
			out.personas.some((x) => (str(x.name) ?? str(x.persona_name)) === name)
		)
			return;
		out.personas.push(p);
	}

	// JanitorAI: its pages keep the session in cookies (Supabase's, split in pieces and base64), and
	// its API, under /hampter, takes its token as a bearer's.

	/** The session's token, from the page's cookies, or undefined. */
	function janitorToken() {
		const jar = new Map();
		for (const pair of String(document.cookie ?? "").split(/;\s*/)) {
			const at = pair.indexOf("=");
			if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
		}
		const names = [...jar.keys()].filter((k) =>
			/^sb-[\w-]*-auth-token(\.\d+)?$/.test(k),
		);
		const whole = names.find((k) => !/\.\d+$/.test(k));
		let text = whole
			? jar.get(whole)
			: names
					.filter((k) => /\.\d+$/.test(k))
					.sort(
						(a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()),
					)
					.map((k) => jar.get(k))
					.join("");
		try {
			text = decodeURIComponent(text ?? "");
			if (text.startsWith("base64-"))
				text = atob(text.slice(7).replace(/-/g, "+").replace(/_/g, "/"));
			const session = JSON.parse(text);
			const found = str(
				Array.isArray(session) ? session[0] : session?.access_token,
			);
			if (found) report.token = "cookie";
			return found;
		} catch {
			return undefined;
		}
	}

	async function readJanitor() {
		const me = await optional(api("/hampter/profiles/mine"));
		out.user = me
			? { id: idOf(me.id), username: str(me.user_name), name: str(me.name) }
			: null;
		await remembered();
		say("Finding your chats…");
		const characters = await everyPage(
			async (page = 1) => {
				const got = await unlessRefused(
					api(`/hampter/chats/character-chats?page=${page}`),
				);
				return {
					items: listOf(got?.characters).map((c) => ({
						...c,
						id: idOf(c.character_id),
						name: str(c.name),
					})),
					next: got?.hasMore ? page + 1 : undefined,
				};
			},
			(c) => c.id,
		);
		await readEach(characters, {
			chatsOf: (c) =>
				everyPage(
					async (page = 1) => {
						const got = await unlessRefused(
							api(
								`/hampter/chats/character/${encodeURIComponent(c.id)}/chats?page=${page}`,
							),
						);
						return {
							items: listOf(got?.chats).map((x) => ({ ...x, id: idOf(x.id) })),
							next: got?.hasMore ? page + 1 : undefined,
						};
					},
					(x) => x.id,
				),
			describe: async (c) => {
				const found = await optional(
					api(`/hampter/characters/${encodeURIComponent(c.id)}`),
				);
				const character = found?.name
					? found
					: { id: c.id, name: c.name, avatar: c.avatar };
				// Its lorebooks the user may read: one its creator kept private isn't given.
				const lore = [];
				for (const script of listOf(found?.scripts)) {
					const id = idOf(script.id);
					if (!id) continue;
					const book = await optional(
						api(`/hampter/script/${encodeURIComponent(id)}`),
					);
					if (str(book?.script))
						lore.push({
							id,
							title: str(book.title) ?? str(script.title),
							script: book.script,
						});
				}
				const avatar = str(character.avatar);
				return {
					character,
					picture:
						avatar &&
						`https://ella.janitorai.com/bot-avatars/${encodeURIComponent(avatar)}?width=400`,
					lore,
					defined: !!(str(found?.personality) || str(found?.scenario)),
				};
			},
			chat: async (c, _, onPage) => {
				const got = await api(`/hampter/chats/${encodeURIComponent(c.id)}`);
				if (stopped) return null;
				const messages = oldestFirst(
					listOf(got?.chatMessages),
					(m) => m.created_at,
				);
				onPage(messages.length);
				const used = listOf(got?.personas)[0];
				if (used) persona({ name: used.name, appearance: used.appearance });
				const summary = str(got?.chat?.summary ?? c.summary);
				return {
					head: {
						chat_id: c.id,
						create_time: got?.chat?.created_at ?? c.created_at,
						...(summary && { memory: summary }),
						...(used && { persona: str(used.name) }),
					},
					messages,
				};
			},
		});
	}

	// Chai: its website keeps the session with Firebase, in the page's IndexedDB, and its API, under
	// /api, takes the token as a bearer's.

	/** The session's token, from Firebase's store in the page, or undefined. */
	async function chaiToken() {
		try {
			const db = await new Promise((done, fail) => {
				const opening = indexedDB.open("firebaseLocalStorageDb");
				opening.onsuccess = () => done(opening.result);
				opening.onerror = () => fail(opening.error);
			});
			const rows = await new Promise((done, fail) => {
				const reading = db
					.transaction("firebaseLocalStorage", "readonly")
					.objectStore("firebaseLocalStorage")
					.getAll();
				reading.onsuccess = () => done(reading.result);
				reading.onerror = () => fail(reading.error);
			});
			db.close?.();
			const found = listOf(rows)
				.map((row) => str(row.value?.stsTokenManager?.accessToken))
				.find(Boolean);
			if (found) report.token = "storage";
			return found;
		} catch {
			return undefined;
		}
	}

	async function readChai() {
		const me = await optional(api("/api/auth/me"));
		out.user = me ? { id: idOf(me.user_id), name: str(me.name) } : null;
		await remembered();
		say("Finding your chats…");
		const conversations = await everyPage(
			async (offset = 0) => {
				const got = await unlessRefused(
					api(`/api/conversations?limit=20&offset=${offset}`),
				);
				const items = listOf(got?.conversations);
				return {
					items: items.map((c) => ({ ...c, id: str(c.conversation_id) })),
					next: got?.has_more ? offset + items.length : undefined,
				};
			},
			(c) => c.id,
		);
		// A story, with several characters, is left out, as a group chat is.
		const byBot = new Map();
		for (const c of conversations) {
			const bot = str(c.bot_uid);
			if (!bot || c.is_story === true) continue;
			if (!byBot.has(bot))
				byBot.set(bot, { id: bot, name: str(c.bot_name)?.trim(), chats: [] });
			byBot.get(bot).chats.push(c);
		}
		await readEach([...byBot.values()], {
			chatsOf: async (c) => c.chats,
			describe: async (c) => {
				const config = await optional(
					api(`/api/feed/bots/${encodeURIComponent(c.id)}/config`),
				);
				return {
					character: config?.name
						? { ...config, bot_uid: c.id }
						: { bot_uid: c.id, name: c.name },
					// Chai keeps its pictures where no other site may read them.
					picture: undefined,
					defined: !!str(config?.memory),
				};
			},
			chat: async (c, _, onPage) => {
				const seen = new Set();
				const messages = [];
				let head;
				let before;
				const cursors = new Set();
				for (;;) {
					if (stopped) return null;
					const got = await api(
						`/api/conversations/${encodeURIComponent(c.id)}${
							before
								? `?before=${encodeURIComponent(before.created_at)}&before_id=${encodeURIComponent(before.message_id)}`
								: ""
						}`,
					);
					head = head ?? got;
					const fresh = listOf(got?.messages).filter((m) => {
						const id = str(m.message_id);
						if (!id) return true;
						if (seen.has(id)) return false;
						seen.add(id);
						return true;
					});
					messages.push(...fresh);
					onPage(fresh.length);
					const next = got?.next_cursor;
					const key = next && `${next.created_at}|${next.message_id}`;
					if (!got?.has_more || !next || !fresh.length || cursors.has(key))
						break;
					cursors.add(key);
					before = next;
				}
				const used = await optional(
					api(`/api/conversations/${encodeURIComponent(c.id)}/persona`),
				);
				if (used?.user_persona && typeof used.user_persona === "object")
					persona(used.user_persona);
				return {
					head: {
						chat_id: c.id,
						create_time: c.created_at,
						...(str(head?.first_message) && { greeting: head.first_message }),
					},
					messages: oldestFirst(messages, (m) => m.created_at),
				};
			},
		});
	}

	// Chub: its pages keep the user's API key in localStorage, which its API (gateway.chub.ai) takes
	// as `CH-API-KEY`.

	function chubToken() {
		try {
			const found = str(localStorage.getItem("URQL_TOKEN"));
			if (found) report.token = "storage";
			return found;
		} catch {
			return undefined;
		}
	}

	async function readChub() {
		const me = await optional(api("/api/account"));
		out.user = me
			? { id: idOf(me.id), username: str(me.user_name), name: str(me.name) }
			: null;
		await remembered();
		const personas = await optional(api("/api/personas?page=1"));
		for (const p of listOf(personas?.personas))
			persona({
				name: str(p.persona_name) ?? str(p.name),
				chat_profile: p.chat_profile,
			});
		say("Finding your chats…");
		const chats = await everyPage(
			async (cursor) => {
				const got = await unlessRefused(
					api(
						`/api/core/chats?limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
					),
				);
				return {
					items: listOf(got?.chats).map((c) => ({ ...c, id: idOf(c.id) })),
					next: str(got?.cursor),
				};
			},
			(c) => c.id,
		);
		// A chat with several characters is left out, as a group chat is.
		const byCharacter = new Map();
		for (const c of chats) {
			const id = idOf(c.character_id);
			if (!id || (Array.isArray(c.character_ids) && c.character_ids.length > 1))
				continue;
			const card =
				c.characters &&
				typeof c.characters === "object" &&
				!Array.isArray(c.characters)
					? (c.characters[id] ?? c.characters)
					: undefined;
			if (!byCharacter.has(id))
				byCharacter.set(id, {
					id,
					name: str(card?.name),
					card,
					chats: [],
				});
			byCharacter.get(id).chats.push(c);
		}
		await readEach([...byCharacter.values()], {
			chatsOf: async (c) => c.chats,
			describe: async (c) => {
				// The list gives a character's card without its definition; a chat with it gives it whole.
				const first = c.chats[0]?.id;
				const chat =
					first &&
					(await optional(
						api(`/api/core/chats/v2/${encodeURIComponent(first)}`),
					));
				const whole = chat?.chat?.characters?.[c.id];
				const card =
					whole && typeof whole === "object" && str(whole.name)
						? whole
						: c.card && typeof c.card === "object"
							? c.card
							: { id: c.id, name: c.name };
				return {
					character: card,
					// The picture is the character's card, as Chub saves it.
					picture: str(card.avatar),
					defined: !!(str(card.personality) || str(card.description)),
				};
			},
			chat: async (c, _, onPage) => {
				const got = await api(
					`/api/core/chats/v2/${encodeURIComponent(c.id)}?include_messages=true`,
				);
				if (stopped) return null;
				const all = got?.chatMessages;
				const messages = oldestFirst(
					Array.isArray(all)
						? listOf(all)
						: listOf(Object.values(all && typeof all === "object" ? all : {})),
					(m) => m.created_at,
				);
				onPage(messages.length);
				const summary = str(got?.chat?.summary ?? c.summary);
				return {
					head: {
						chat_id: c.id,
						create_time: c.created_at,
						...(summary && { memory: summary }),
					},
					messages,
				};
			},
		});
	}

	const date = new Date().toISOString().slice(0, 10);

	// What the files saved so far hold, kept in this browser (the site's own storage) once a run is
	// cut short, so the next run can go on from there: the ids of their chats and characters, and
	// how many files there are. Nothing else of the user's. It goes once a run saves all that was
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
				...out.characters.map((c) => c.id),
			],
		});
	}
	/** An earlier run cut short, for the user the file names: go on from there, or start over. */
	async function remembered() {
		progress.key = `${site.keep}:${out.user?.id ?? "me"}`;
		const earlier = recalled(progress.key);
		if (!earlier || !(earlier.chats.length || earlier.characters.length))
			return;
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
	const out = {
		format: site.format,
		version: 1,
		exportedAt: new Date().toISOString(),
		source: site.source,
		user: null,
		personas: [],
		characters: [],
	};

	/** A chat as the file holds it, written as it's read, a message at a time: a long history is
	 * held once, as the file's text, not as the API's objects and then again as the file. */
	function chatFile(chat, list) {
		const parts = [JSON.stringify(chat).slice(0, -1), `,"${site.list}":[`];
		list.forEach((t, i) => {
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
					...(entry.lore && { lore: entry.lore }),
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
			definitions: out.characters.filter((c) => c.defined).length,
		});
		if (out.partial) report.partial = true;
		const part = progress.part > 1 ? `-part-${progress.part}` : "";
		const name = `${site.file}-${date}${part}${out.partial ? "-partial" : ""}.json`;
		// A run that went on from one cut short says so in its file too, so an import of it alone
		// can say that what the earlier files hold isn't in it.
		if (progress.part > 1) out.part = progress.part;
		try {
			const made = file();
			download(made, name);
			saved = true;
			remember();
			handOver(made, name);
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
		token = await site.token();
		if (!token) {
			say(
				`Sign in to ${site.name} in this tab first, then run the exporter again.`,
			);
			return;
		}
		await site.read();
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
			// Our own error codes and the browser's kinds of error: never anything the site wrote.
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
					? `${site.name} signed you out. Sign in again, then run the exporter again.`
					: `Something went wrong reading ${site.name}.`,
				kept
					? "What was read so far is saved. Run the exporter again for the rest."
					: String(error?.message ?? error),
			);
		})
		// However it ended, it's done: the panel offers the report and Close, and a new run can start.
		.finally(finish);
})();
