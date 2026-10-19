# Move to Morse

Save your Character.AI characters, chats, and personas in one go, and bring them to [Morse](https://trymorse.ai).

This repository holds two things:

- **`cai-exporter.js`**, the exporter. It's the exact file https://trymorse.ai/cai-exporter.js serves, and the script behind the Export for Morse bookmark on [trymorse.ai/import](https://trymorse.ai/import).
- **`extension/`**, Move to Morse, the browser extension for Chrome and Firefox. It puts a Save for Morse button on character.ai, runs the same exporter, and hands the file straight to Morse's import.

## See it work

On a computer, with the bookmark:

https://github.com/user-attachments/assets/86a9a667-aac0-45f5-b2e7-4bd07eb1c8c3

On an iPhone:

https://github.com/user-attachments/assets/b2e2bf49-5ece-4322-bebb-4e77c1becb4d

## What the exporter does

- It runs only in your browser, on character.ai, with your own signed-in session.
- It reads your data the way the site itself does: your chats and every message in them, each chat's memory box, the characters you talked to and the ones you made (with their definitions, since they're yours), your personas, and the characters' pictures.
- It only reads. It never changes or deletes anything on your Character.AI account.
- It talks to nothing but Character.AI: character.ai's own pages for your session, `neo.character.ai` for your data, and `characterai.io` for pictures. The file is built in your browser and saved as a download. Nothing is sent to Morse.
- It asks one thing at a time, a quarter second apart, and rests for ten seconds whenever Character.AI asks it to, so a long history doesn't load the site.
- Stop saves what's done so far, and the next run in the same browser picks up where it left off.
- If something goes wrong, Copy a report puts a report on your clipboard for you to send us. It lists which kinds of requests were made and how they were answered, never a message, a name, an id, or a picture.

## What the extension does

When you click Save for Morse, the extension runs `cai-exporter.js` in the character.ai tab, in its own isolated world where the page's scripts can't reach it. When you choose Open in Morse, it opens Morse's import and hands it the file, inside your browser. Until Morse takes the file, the extension keeps it in its own storage on your device. A file Morse hasn't taken within an hour isn't handed over, and is deleted the next time the extension runs.

It asks for `scripting` (to run the exporter when you click) and for access to `character.ai` and `trymorse.ai`, nothing else. Every script is in the package, written as you see it here: nothing is minified or bundled, and only `manifest.json` is generated, by the build script.

## Check it yourself

The file trymorse.ai serves is this one:

```sh
curl -s https://trymorse.ai/cai-exporter.js | shasum -a 256
shasum -a 256 cai-exporter.js
```

On a computer, the bookmark you drag to your bookmarks bar is the whole script, so what runs is what you saved, and it doesn't change unless you save it again. On a phone, the bookmark loads https://trymorse.ai/cai-exporter.js each time it runs.

While it runs, your browser's developer tools (the Network tab) show every request it makes, all of them to Character.AI.

## Build the extension

With Node 24.2 or later:

```sh
node scripts/build-extension.mjs
```

This writes `dist-extension/`, with a folder to load unpacked and a zip for each browser. The same files always make the same zip, byte for byte. Version 1.0.0, as uploaded to the Chrome Web Store and Firefox Add-ons:

| Zip | SHA-256 |
| --- | --- |
| `move-to-morse-1.0.0-chrome.zip` | `4a7a4ae0293dc508e99c8b993f439b2dbc90c7da28e8c09dcf783e261039309d` |
| `move-to-morse-1.0.0-firefox.zip` | `023963b434e7f509f855cc4e473d1448e46e40ad2bc3f31e94119c47cf373409` |

## License

MIT. See [LICENSE](LICENSE).

Move to Morse is made by Morse. It isn't made by, endorsed by, or affiliated with Character.AI, whose name is used only to say what it works with. Questions or problems: open an issue, or write to hello@trymorse.ai.
