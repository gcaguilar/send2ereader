const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { createApp } = require("../app");
const { createFakeAdapter } = require("../file-processor");
const config = require("../config");

const UA =
  "Mozilla/5.0 (Linux; U; en-US) AppleWebKit/528.5+ (KHTML, like Gecko, Safari/528.5+) Version/4.0 Kindle/3.0";
const KOBO_UA =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) Kobo/3.15.0";

async function startServer(cfg) {
  fs.mkdirSync("uploads", { recursive: true });
  const { app } = createApp(cfg || config, createFakeAdapter({}));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function generateKey(baseUrl, headers = { "User-Agent": UA }) {
  const res = await fetch(`${baseUrl}/generate`, { method: "POST", headers });
  return (await res.text()).trim();
}

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startServer());
});

after(() => {
  if (server) {
    server.closeAllConnections?.();
    server.close();
  }
});

test("generates a 6-character access key", async () => {
  const res = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "User-Agent": UA },
  });
  assert.equal(res.status, 200);
  assert.match((await res.text()).trim(), /^[2-9A-HJ-NP-Z]{6}$/);
});

test("full send flow: upload, status, download, delete", async () => {
  const key = await generateKey(baseUrl);

  const fd = new FormData();
  fd.append("files", new Blob(["hello world"], { type: "text/plain" }), "test.txt");

  const upload = await fetch(`${baseUrl}/upload?key=${key}`, {
    method: "POST",
    headers: { "User-Agent": UA, "x-upload-key": key },
    body: fd,
  });
  assert.equal(upload.status, 200);

  const statusRes = await fetch(`${baseUrl}/status/${key}`, {
    headers: { "User-Agent": UA },
  });
  assert.equal(statusRes.status, 200);
  assert.deepEqual((await statusRes.json()).files, [{ name: "test.txt" }]);

  const download = await fetch(`${baseUrl}/test.txt?key=${key}`, {
    headers: { "User-Agent": UA },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "hello world");

  const del = await fetch(`${baseUrl}/file/${key}/test.txt`, {
    method: "DELETE",
    headers: { "User-Agent": UA },
  });
  assert.equal(del.status, 200);
});

test("download with an unknown key returns 404", async () => {
  const res = await fetch(`${baseUrl}/missing.txt?key=ZZZZZZ`, {
    headers: { "User-Agent": UA },
  });
  assert.equal(res.status, 404);
});

test("filenames with a literal percent sign survive a round trip", async () => {
  const key = await generateKey(baseUrl, { "User-Agent": KOBO_UA });

  const fd = new FormData();
  fd.append("files", new Blob(["data"], { type: "text/plain" }), "50%.txt");
  await fetch(`${baseUrl}/upload?key=${key}`, {
    method: "POST",
    headers: { "User-Agent": KOBO_UA, "x-upload-key": key },
    body: fd,
  });

  const download = await fetch(`${baseUrl}/50%25.txt?key=${key}`, {
    headers: { "User-Agent": KOBO_UA },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "data");
});

test("key generation is rate limited", async () => {
  const limited = await startServer({ ...config, generateRateLimitMax: 2 });

  try {
    assert.equal(
      (await fetch(`${limited.baseUrl}/generate`, { method: "POST", headers: { "User-Agent": UA } })).status,
      200
    );
    assert.equal(
      (await fetch(`${limited.baseUrl}/generate`, { method: "POST", headers: { "User-Agent": UA } })).status,
      200
    );
    assert.equal(
      (await fetch(`${limited.baseUrl}/generate`, { method: "POST", headers: { "User-Agent": UA } })).status,
      429
    );
  } finally {
    limited.server.closeAllConnections?.();
    limited.server.close();
  }
});
