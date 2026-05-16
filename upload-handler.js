const multer = require("@koa/multer");
const fs = require("fs");
const { extname } = require("path");
const { allowedTypes, allowedExtensions, maxFileSize, TYPE_EPUB, TYPE_MOBI } = require("./config");
const { processFile } = require("./file-processor");

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

function createMulterMiddleware(config) {
  const { maxFileSize, allowedTypes, allowedExtensions } = config;

  return multer({
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

      if (!req.keys.has(key)) {
        return cb(new Error("Unknown key " + key), false);
      }

      const fileExt = extname(file.originalname).toLowerCase().substring(1);
      if ((!allowedTypes.includes(file.mimetype) && file.mimetype !== "application/octet-stream") || !allowedExtensions.includes(fileExt)) {
        return cb(new Error("Invalid filetype: " + file.originalname + " (" + file.mimetype + ")"), false);
      }

      cb(null, true);
    },
  });
}

function sanitize(filename) {
  const sanitize = require("sanitize-filename");
  return sanitize(Buffer.from(filename, "latin1").toString("utf8"));
}

async function handleUpload(ctx, next, sessionStore, fileProcessorModule, config, converter) {
  const upload = createMulterMiddleware(config);

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

  if (!sessionStore.hasSession(key)) {
    if (ctx.request.files?.length) {
      for (const f of ctx.request.files) fs.unlink(f.path, () => {});
    }
    flash(ctx, { message: "Unknown key " + key, success: false });
    await next();
    return;
  }

  const session = sessionStore.getSession(key);
  sessionStore.expireSession(key);

  let url = null;
  if (ctx.request.body?.url) {
    url = String(ctx.request.body.url).trim();
    if (url.length > 0 && !session.urls.includes(url)) session.urls.push(url);
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
        const processedFile = await processFile(file, session, ctx.request.body, config, spawnFn);
        processedFiles.push(processedFile);
        session.files.push(processedFile);
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
}

module.exports = { handleUpload, getKeyFromRequest, flash };
