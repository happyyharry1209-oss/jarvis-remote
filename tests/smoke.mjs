import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const read = (name) =>
  readFile(new URL(`../${name}`, import.meta.url), "utf8");

const html = await read("index.html");
const app = await read("app.js");
const config = await read("config.js");
const manifest = JSON.parse(await read("manifest.webmanifest"));
const worker = await read("sw.js");

assert.match(html, /id="pair-form"/);
assert.match(html, /id="offline-banner"/);
assert.match(html, /id="feed"/);
assert.match(html, /id="empty-state"/);
assert.match(html, /id="audio-toggle"/);
assert.match(html, /rel="manifest"/);
assert.match(app, /URLSearchParams\(location\.search\)/);
assert.match(config, /new URL\(/);
assert.match(app, /\/ws\/phone-audio/);
assert.match(app, /\/api\/upload/);
assert.match(app, /createBufferSource/);
assert.match(app, /jarvis_phone_audio/);
assert.match(app, /binaryType = "arraybuffer"/);
assert.match(app, /允許瀏覽器存取本機網絡/);
assert.match(config, /Remote backend must use HTTPS/);
assert.match(worker, /jarvis-shell-v1/);
assert.equal(manifest.start_url, "./");
assert.equal(manifest.display, "standalone");
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));

console.log("PASS: remote web static contract");
