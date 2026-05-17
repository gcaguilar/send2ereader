const express = require("express");

function createRouter(sessionStore, config, converter) {
  const router = express.Router();
  const { maxExpireDuration, expireDelay, keyChars, keyLength } = config;

  router.post("/generate", (req, res) => {
    const path = require("path");
    const agent = req.get("User-Agent");

    let key = null;
    let attempts = 0;
    console.log("There are currently", sessionStore.size, "key(s) in use.");
    console.log("Generating unique key...", req.ip, agent);

    do {
      key = sessionStore.generateKey(keyChars, keyLength);
      if (attempts >= sessionStore.size) {
        console.error("Can't generate more keys, map is full.", attempts, sessionStore.size);
        res.status(500).send("error");
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

    res.cookie("key", key, { overwrite: true, httpOnly: false, sameSite: "strict", maxAge: expireDelay * 1000 });
    res.status(200).send(key);
  });

  router.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/status/:key", (req, res) => {
    const key = req.params.key.toUpperCase();
    const session = sessionStore.getSession(key);

    if (!session) {
      res.status(404).json({ error: "Unknown key" });
      return;
    }

    if (session.agent !== req.get("User-Agent")) {
      console.error("User Agent doesnt match: " + session.agent + " VS " + req.get("User-Agent"));
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    sessionStore.expireSession(key);
    res.status(200).json({
      alive: session.alive,
      files: session.files ? session.files.map((f) => ({ name: f.name })) : [],
      urls: session.urls,
    });
  });

  router.post("/upload", async (req, res, next) => {
    const { handleUpload } = require("./upload-handler");
    const { processFile } = require("./file-processor");
    await handleUpload(req, res, sessionStore, processFile, config, converter);
  });

  const { handleDownloadFile, handleDeleteFile } = require("./download-handler");

  router.delete("/file/:key/:filename", (req, res) => {
    handleDeleteFile(req, res, sessionStore);
  });

  router.get("/receive", (req, res) => {
    res.sendFile(path.join(__dirname, "static", "download.html"));
  });

  router.get("/", (req, res) => {
    const agent = req.get("User-Agent");
    const device = require("./device-detector").detect(agent);
    const page = device.pageType === "download" ? "static/download.html" : "static/upload.html";
    res.sendFile(require("path").join(__dirname, page));
  });

  router.get("/:filename", (req, res, next) => {
    handleDownloadFile(req, res, sessionStore);
  });

  return router;
}

module.exports = { createRouter };
