#!/usr/bin/env node

const http = require("http");
const Koa = require("koa");
const Router = require("@koa/router");
const multer = require("@koa/multer");
const logger = require("koa-logger");
const sendfile = require("koa-sendfile");
const serve = require("koa-static");
const { mkdirp } = require("mkdirp");
const fs = require("fs");
const { spawn } = require("child_process");
const { extname, basename, dirname } = require("path");
const FileType = require("file-type");
const { transliterate } = require("transliteration");
const sanitize = require("sanitize-filename");

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

const expireDelay = 10 * 60; // seconds
const maxExpireDuration = 1 * 60 * 60; // 1 hour
const maxFileSize = 1024 * 1024 * 800; // 800 MB

const TYPE_EPUB = "application/epub+zip";
const TYPE_MOBI = "application/x-mobipocket-ebook";

const allowedTypes = [
  TYPE_EPUB,
  TYPE_MOBI,
  "application/pdf",
  "application/vnd.comicbook+zip",
  "application/vnd.comicbook-rar",
  "text/html",
  "text/plain",
  "application/zip",
  "application/x-rar-compressed",
];
const allowedExtensions = ["epub", "mobi", "pdf", "cbz", "cbr", "html", "txt"];

const keyChars = "23456789ACDEFGHJKLMNPRSTUVWXYZ";
const keyLength = 4;

function doTransliterate(filename) {
  let name = filename.split(".");
  const ext = "." + name.splice(-1).join(".");
  name = name.join(".");
  return transliterate(name) + ext;
}

function randomKey() {
  const choices = Math.pow(keyChars.length, keyLength);
  const rnd = Math.floor(Math.random() * choices);

  return rnd
    .toString(keyChars.length)
    .padStart(keyLength, "0")
    .split("")
    .map((chr) => keyChars[parseInt(chr, keyChars.length)])
    .join("");
}

function getKeyFromRequest(req, ctx) {
  const hdr = req.headers["x-upload-key"];
  if (typeof hdr === "string" && hdr.trim()) return hdr.trim().toUpperCase();

  if (ctx && ctx.query && typeof ctx.query.key === "string" && ctx.query.key.trim()) {
    return ctx.query.key.trim().toUpperCase();
  }

  const bodyKey =
    ctx &&
    ctx.request &&
    ctx.request.body &&
    typeof ctx.request.body.key === "string"
      ? ctx.request.body.key
      : null;

  if (bodyKey && bodyKey.trim()) return bodyKey.trim().toUpperCase();

  return null;
}

function flash(ctx, data) {
  ctx.response.status = data.success ? 200 : 400;
  if (!data.success) ctx.set("Connection", "close");
  ctx.body = data.message;
}

const app = new Koa();
app.context.keys = new Map();
app.use(logger());

function removeKey(key) {
  console.log("Removing expired key", key);
  const info = app.context.keys.get(key);
  if (!info) {
    console.log("Tried to remove non-existing key", key);
    return;
  }

  clearTimeout(info.timer);

  if (info.files && info.files.length > 0) {
    for (const file of info.files) {
      console.log("Deleting file", file.path);
      fs.unlink(file.path, (err) => err && console.error(err));
    }
    info.files = [];
  }

  app.context.keys.delete(key);
}

function expireKey(key) {
  const info = app.context.keys.get(key);
  const timer = setTimeout(removeKey, expireDelay * 1000, key);
  if (info) {
    clearTimeout(info.timer);
    info.timer = timer;
    info.alive = new Date();
  }
  return timer;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "uploads");
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + "-" + Math.floor(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + extname(file.originalname).toLowerCase());
    },
  }),
  limits: {
    fileSize: maxFileSize,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    file.originalname = sanitize(Buffer.from(file.originalname, "latin1").toString("utf8"));

    const keyHeader = req.headers["x-upload-key"];
    const key =
      typeof keyHeader === "string" && keyHeader.trim()
        ? keyHeader.trim().toUpperCase()
        : null;

    if (!key) {
      return cb(new Error("Missing key. Send x-upload-key header (recommended)."), false);
    }

    if (!app.context.keys.has(key)) {
      return cb(new Error("Unknown key " + key), false);
    }

    const fileExt = extname(file.originalname).toLowerCase().substring(1);
    if ((!allowedTypes.includes(file.mimetype) && file.mimetype !== "application/octet-stream") || !allowedExtensions.includes(fileExt)) {
      return cb(new Error("Invalid filetype: " + file.originalname + " (" + file.mimetype + ")"), false);
    }

    cb(null, true);
  },
});

const router = new Router();

router.post("/generate", async (ctx) => {
  const agent = ctx.get("user-agent");

  let key = null;
  let attempts = 0;
  console.log("There are currently", ctx.keys.size, "key(s) in use.");
  console.log("Generating unique key...", ctx.ip, agent);

  do {
    key = randomKey();
    if (attempts > ctx.keys.size) {
      console.error("Can't generate more keys, map is full.", attempts, ctx.keys.size);
      ctx.body = "error";
      return;
    }
    attempts++;
  } while (ctx.keys.has(key));

  console.log("Generated key " + key + ", " + attempts + " attempt(s)");

  const info = {
    created: new Date(),
    agent,
    files: [],
    urls: [],
    timer: null,
    alive: new Date(),
  };

  ctx.keys.set(key, info);
  expireKey(key);

  setTimeout(() => {
    if (ctx.keys.get(key) === info) removeKey(key);
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
  const info = ctx.keys.get(key);

  if (!info) {
    ctx.response.status = 404;
    ctx.body = { error: "Unknown key" };
    return;
  }

  if (info.agent !== ctx.get("user-agent")) {
    console.error("User Agent doesnt match: " + info.agent + " VS " + ctx.get("user-agent"));
    ctx.response.status = 403;
    ctx.body = { error: "Forbidden" };
    return;
  }

  expireKey(key);
  ctx.body = {
    alive: info.alive,
    files: info.files ? info.files.map((f) => ({ name: f.name })) : [],
    urls: info.urls,
  };
});

router.post("/upload", async (ctx, next) => {
  try {
    await upload.array("files", 10)(ctx, () => {});
  } catch (err) {
    flash(ctx, { message: String(err?.message || err), success: false });
    await next();
    return;
  }

  const key = getKeyFromRequest(ctx.req, ctx);

  if (!key) {
    if (ctx.request.files?.length) {
      for (const f of ctx.request.files) fs.unlink(f.path, () => {});
    }
    flash(ctx, { message: "Missing key (send x-upload-key header).", success: false });
    await next();
    return;
  }

  if (!ctx.keys.has(key)) {
    if (ctx.request.files?.length) {
      for (const f of ctx.request.files) fs.unlink(f.path, () => {});
    }
    flash(ctx, { message: "Unknown key " + key, success: false });
    await next();
    return;
  }

  const info = ctx.keys.get(key);
  expireKey(key);

  let url = null;
  if (ctx.request.body?.url) {
    url = String(ctx.request.body.url).trim();
    if (url.length > 0 && !info.urls.includes(url)) info.urls.push(url);
  }

  const messages = [];
  const processedFiles = [];

  if (ctx.request.files?.length) {
    for (const file of ctx.request.files) {
      if (file.size === 0) {
        fs.unlink(file.path, () => {});
        continue;
      }

      try {
        const processedFile = await processFile(file, info, ctx);
        processedFiles.push(processedFile);
        info.files.push(processedFile);
        messages.push("✓ " + processedFile.name + (processedFile.conversion ? " (converted with " + processedFile.conversion + ")" : ""));
      } catch (err) {
        console.error("Error processing file:", file.originalname, err);
        messages.push("✗ Error processing " + file.originalname + ": " + String(err?.message || err));
        fs.unlink(file.path, () => {});
      }
    }
  }

  if (url) messages.push("✓ Added url: " + url);

  if (messages.length === 0) {
    flash(ctx, { message: "No file or url selected", success: false });
    await next();
    return;
  }

  const successMsg =
    processedFiles.length > 0
      ? `Upload successful! ${processedFiles.length} file(s) received:<br/>`
      : "";

  flash(ctx, {
    message: successMsg + messages.join("<br/>"),
    success: true,
    key,
    url,
  });

  await next();
});

router.delete("/file/:key/:filename", async (ctx) => {
  const key = ctx.params.key.toUpperCase();
  const filename = decodeURIComponent(ctx.params.filename);
  const info = ctx.keys.get(key);

  if (!info) ctx.throw(400, "Unknown key: " + key);

  const fileIndex = info.files.findIndex((f) => f.name === filename);
  if (fileIndex !== -1) {
    const file = info.files[fileIndex];
    fs.unlink(file.path, (err) => err && console.error(err));
    info.files.splice(fileIndex, 1);
  }

  ctx.body = "ok";
});

async function downloadFile(ctx, next) {
  const key = ctx.query.key ? String(ctx.query.key).toUpperCase() : null;
  if (!key) return next();

  const filename = decodeURIComponent(ctx.params.filename);
  const info = ctx.keys.get(key);
  const file = info?.files ? info.files.find((f) => f.name === filename) : null;

  if (!info || !file) return next();

  if (info.agent !== ctx.get("user-agent")) {
    console.error("User Agent doesnt match: " + info.agent + " VS " + ctx.get("user-agent"));
    ctx.response.status = 403;
    ctx.body = "Forbidden";
    return;
  }

  expireKey(key);
  if (info.agent.includes("Kindle")) ctx.attachment(file.name);
  await sendfile(ctx, file.path);
}

router.get("/receive", async (ctx) => {
  await sendfile(ctx, "static/download.html");
});

router.get("/", async (ctx) => {
  const agent = ctx.get("user-agent");
  await sendfile(
    ctx,
    agent.includes("Kobo") ||
      agent.includes("Kindle") ||
      agent.toLowerCase().includes("tolino") ||
      agent.includes("eReader")
      ? "static/download.html"
      : "static/upload.html"
  );
});

router.get("/:filename", downloadFile);

async function processFile(file, info, ctx) {
  let conversion = null;
  let filename = file.originalname;

  if (ctx.request.body?.transliteration) filename = sanitize(doTransliterate(filename));
  if (info.agent.includes("Kindle")) filename = filename.replace(/[^\.\w\-"'\(\)]/g, "_");

  let mimetype = file.mimetype;
  const type = await FileType.fromFile(file.path);

  if (mimetype === "application/octet-stream" && type) mimetype = type.mime;
  if (mimetype === "application/epub") mimetype = TYPE_EPUB;

  if ((!type || !allowedTypes.includes(type.mime)) && !allowedTypes.includes(mimetype)) {
    throw new Error(
      "Uploaded file is of an invalid type: " +
        file.originalname +
        " (" +
        (type ? type.mime : "unknown mimetype") +
        ")"
    );
  }

  let data = null;

  if (mimetype === TYPE_EPUB && info.agent.includes("Kindle") && ctx.request.body?.kindlegen) {
    conversion = "kindlegen";
    const outname = file.path.replace(/\.epub$/i, ".mobi");
    filename = filename.replace(/\.kepub\.epub$/i, ".epub").replace(/\.epub$/i, ".mobi");

    data = await new Promise((resolve, reject) => {
      let stderr = "";
      const kindlegen = spawn("kindlegen", [basename(file.path), "-dont_append_source", "-c1", "-o", basename(outname)], {
        cwd: dirname(file.path),
      });

      kindlegen.once("error", (err) => {
        fs.unlink(file.path, () => {});
        fs.unlink(file.path.replace(/\.epub$/i, ".mobi8"), () => {});
        reject(new Error("kindlegen error: " + err));
      });

      kindlegen.once("close", (code) => {
        fs.unlink(file.path, () => {});
        fs.unlink(file.path.replace(/\.epub$/i, ".mobi8"), () => {});
        if (code !== 0 && code !== 1) return reject(new Error("kindlegen error code: " + code + "\n" + stderr));
        resolve(outname);
      });

      kindlegen.stdout.on("data", (str) => (stderr += String(str)));
      kindlegen.stderr.on("data", (str) => (stderr += String(str)));
    });
  } else if (mimetype === TYPE_EPUB && info.agent.includes("Kobo") && ctx.request.body?.kepubify) {
    conversion = "kepubify";
    const outname = file.path.replace(/\.epub$/i, ".kepub.epub");
    filename = filename.replace(/\.kepub\.epub$/i, ".epub").replace(/\.epub$/i, ".kepub.epub");

    data = await new Promise((resolve, reject) => {
      let stderr = "";
      const kepubify = spawn("kepubify", ["-v", "-u", "-o", basename(outname), basename(file.path)], {
        cwd: dirname(file.path),
      });

      kepubify.once("error", (err) => {
        fs.unlink(file.path, () => {});
        reject(new Error("kepubify error: " + err));
      });

      kepubify.once("close", (code) => {
        fs.unlink(file.path, () => {});
        if (code !== 0) return reject(new Error("Kepubify error code: " + code + "\n" + stderr));
        resolve(outname);
      });

      kepubify.stdout.on("data", (str) => (stderr += String(str)));
      kepubify.stderr.on("data", (str) => (stderr += String(str)));
    });
  } else {
    data = file.path;
    filename = filename.replace(/\.epub$/i, ".epub").replace(/\.pdf$/i, ".pdf");
  }

  return {
    name: filename,
    path: data,
    uploaded: new Date(),
    conversion,
  };
}

app.use(serve("static"));
app.use(router.routes());
app.use(router.allowedMethods());

const server = http.createServer(app.callback());

fs.rm("uploads", { recursive: true, force: true }, async (err) => {
  if (err && err.code !== "ENOENT") throw err;
  await mkdirp("uploads");
  server.listen(port, "0.0.0.0");
  console.log("server is listening on port " + port);
});
