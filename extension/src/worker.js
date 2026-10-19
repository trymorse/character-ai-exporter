// Chrome runs the extension's background as a service worker, from one file: this one loads the
// scripts Firefox's manifest lists as its background instead.
importScripts("relay.js", "background.js");
