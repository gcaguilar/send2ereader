const Router = require("@koa/router");
const sendfile = require("koa-sendfile");

function createRouter(sessionStore, config, converter) {
  const router = new Router();
  const { maxExpireDuration, expireDelay, keyChars, keyLength } = config;

  router.post("/generate", async (ctx) => {
    const agent = ctx.get("user-agent");

    let key = null;
    let attempts = 0;
    console.log("There are currently", sessionStore.size, "key(s) in use.");
    console.log("Generating unique key...", ctx.ip, agent);

    do {
      key = sessionStore.generateKey(keyChars, keyLength);
      if (attempts >= sessionStore.size) {
        console.error("Can't generate more keys, map is full.", attempts, sessionStore.size);
        ctx.body = "error";
        return;
      }
      attempts++;
    } while (sessionStore.hasSession(key));

    console.log("Generated key " + key + ", " + attempts + " attempt(s)");

    const info = {
      created: new Date(),
      agent,
      files: [],
      urls: [],
      timer: null,
      alive: new Date(),
    };

    sessionStore.setSession(key, info);
    sessionStore.expireSession(key);

    setTimeout(() => {
      if (sessionStore.getSession(key) === info) sessionStore.removeSession(key);
    }, maxExpireDuration * 1000);

    ctx.cookies.set("key", key, { overwrite: true, httpOnly: false, sameSite: "strict", maxAge: expireDelay * 1000 });
    ctx.body = key;
  });

  router.get("/health", async (ctx) => {
    ctx.response.status = 200;
    ctx.body = { status: "ok", timestamp: new Date().toISOString() };
  });

  router.get("/status/:key", async (ctx) => {
    const key = ctx.params.key.toUpperCase();
    const session = sessionStore.getSession(key);

    if (!session) {
      ctx.response.status = 404;
      ctx.body = { error: "Unknown key" };
      return;
    }

    if (session.agent !== ctx.get("user-agent")) {
      console.error("User Agent doesnt match: " + session.agent + " VS " + ctx.get("user-agent"));
      ctx.response.status = 403;
      ctx.body = { error: "Forbidden" };
      return;
    }

    sessionStore.expireSession(key);
    ctx.body = {
      alive: session.alive,
      files: session.files ? session.files.map((f) => ({ name: f.name })) : [],
      urls: session.urls,
    };
  });

  router.post("/upload", async (ctx, next) => {
    const { handleUpload } = require("./upload-handler");
    const { processFile } = require("./file-processor");
    await handleUpload(ctx, next, sessionStore, processFile, config, converter);
  });

  const { handleDownloadFile, handleDeleteFile } = require("./download-handler");

  router.delete("/file/:key/:filename", async (ctx) => {
    await handleDeleteFile(ctx, null, sessionStore);
  });

  router.get("/receive", async (ctx) => {
    await sendfile(ctx, "static/download.html");
  });

  router.get("/", async (ctx) => {
    const agent = ctx.get("user-agent");
    const device = require("./device-detector").detect(agent);
    const page = device.pageType === "download" ? "static/download.html" : "static/upload.html";
    await sendfile(ctx, page);
  });

  router.get("/:filename", async (ctx, next) => {
    await handleDownloadFile(ctx, next, sessionStore);
  });

  return router;
}

module.exports = { createRouter };
