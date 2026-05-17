const multer = require("multer");
const fs = require("fs");
const { extname, join } = require("path");
const { allowedTypes, allowedExtensions, maxFileSize, TYPE_EPUB, TYPE_MOBI } = require("./config");
const { processFile } = require("./file-processor");

function getKeyFromRequest(req) {
  const hdr = req.headers["x-upload-key"];
  if (typeof hdr === "string" && hdr.trim()) return hdr.trim().toUpperCase();

  if (req.query && typeof req.query.key === "string" && req.query.key.trim()) {
    return req.query.key.trim().toUpperCase();
  }

  const bodyKey =
    req.body &&
    typeof req.body.key === "string"
      ? req.body.key
      : null;

  if (bodyKey && bodyKey.trim()) return bodyKey.trim().toUpperCase();

  return null;
}

function flash(res, data) {
  res.status(data.success ? 200 : 400);
  if (!data.success) res.set("Connection", "close");
  res.send(data.message);
}

function createMulterMiddleware(config, sessionStore) {
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

      if (!sessionStore.hasSession(key)) {
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

async function handleUpload(req, res, sessionStore, fileProcessorModule, config, converter) {
  const upload = createMulterMiddleware(config, sessionStore);

  try {
    await upload.array("files", 10)(req, res, () => {});
  } catch (err) {
    flash(res, { message: String(err?.message || err), success: false });
    return;
  }

  const key = getKeyFromRequest(req);

  if (!key) {
    if (req.files?.length) {
      for (const f of req.files) fs.unlink(f.path, () => {});
    }
    flash(res, { message: "Missing key (send x-upload-key header).", success: false });
    return;
  }

  if (!sessionStore.hasSession(key)) {
    if (req.files?.length) {
      for (const f of req.files) fs.unlink(f.path, () => {});
    }
    flash(res, { message: "Unknown key " + key, success: false });
    return;
  }

  const session = sessionStore.getSession(key);
  sessionStore.expireSession(key);

  let url = null;
  if (req.body?.url) {
    url = String(req.body.url).trim();
    if (url.length > 0 && !session.urls.includes(url)) session.urls.push(url);
  }

  const messages = [];
  const processedFiles = [];

  if (req.files?.length) {
    for (const file of req.files) {
      if (file.size === 0) {
        fs.unlink(file.path, () => {});
        continue;
      }

      try {
        const processedFile = await processFile(file, session, req.body, config, spawnFn);
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
    flash(res, { message: "No file or url selected", success: false });
    return;
  }

  const successMsg =
    processedFiles.length > 0
      ? `Upload successful! ${processedFiles.length} file(s) received:<br/>`
      : "";

  flash(res, {
    message: successMsg + messages.join("<br/>"),
    success: true,
    key,
    url,
  });
}

module.exports = { handleUpload, getKeyFromRequest, flash };
