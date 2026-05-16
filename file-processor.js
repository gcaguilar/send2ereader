const fs = require("fs");
const { spawn } = require("child_process");
const { extname, basename, dirname } = require("path");
const FileType = require("file-type");
const { transliterate } = require("transliteration");
const sanitize = require("sanitize-filename");

function createChildProcessAdapter() {
  function spawnConversion(tool, args, cwd, filePath) {
    return new Promise((resolve, reject) => {
      let stderr = "";
      const child = spawn(tool, args, { cwd });

      child.once("error", (err) => {
        cleanupOriginal(filePath);
        reject(new Error(tool + " error: " + err));
      });

      child.once("close", (code) => {
        cleanupOriginal(filePath);
        if (code !== 0 && code !== 1) {
          return reject(new Error(tool + " error code: " + code + "\n" + stderr));
        }
        resolve();
      });

      child.stdout.on("data", (str) => (stderr += String(str)));
      child.stderr.on("data", (str) => (stderr += String(str)));
    });
  }

  function cleanupOriginal(filepath) {
    fs.unlink(filepath, () => {});
    fs.unlink(filepath.replace(/\.epub$/i, ".mobi8"), () => {});
  }

  return {
    async convert(tool, inputPath, cwd, filePath) {
      const outname = inputPath.replace(/\.epub$/i, ".mobi");
      await spawnConversion(tool, [basename(inputPath), "-dont_append_source", "-c1", "-o", basename(outname)], cwd, filePath);
      return { outputPath: outname };
    },
  };
}

function createFakeAdapter(config) {
  const { tool, outputPath, errorCode } = config || {};
  return {
    async convert() {
      if (errorCode) {
        throw new Error("fake " + tool + " error code: " + errorCode);
      }
      return { outputPath: outputPath || "output.epub" };
    },
  };
}

function doTransliterate(filename) {
  let name = filename.split(".");
  const ext = "." + name.splice(-1).join(".");
  name = name.join(".");
  return transliterate(name) + ext;
}

function sanitizeFilename(filename, device) {
  let name = sanitize(Buffer.from(filename, "latin1").toString("utf8"));
  if (device.isKindle) {
    name = name.replace(/[^\.\w\-"'\(\)]/g, "_");
  }
  return name;
}

async function processFile(file, session, options, config, converter) {
  const { TYPE_EPUB, allowedTypes, allowedExtensions } = config;
  const { transliteration: transliterationEnabled, kindlegen, kepubify } = options;
  const agent = session.agent;
  const device = require("./device-detector").detect(agent);

  let conversion = null;
  let filename = file.originalname;
  filename = sanitizeFilename(filename, device);
  if (transliterationEnabled) {
    filename = doTransliterate(filename);
  }

  let mimetype = file.mimetype;
  const type = await FileType.fromFile(file.path);

  if (mimetype === "application/octet-stream" && type) mimetype = config.TYPE_EPUB;
  if (mimetype === "application/epub") mimetype = config.TYPE_EPUB;

  const fileExt = extname(filename).toLowerCase().substring(1);
  if ((!type || !allowedTypes.includes(type.mime)) && !allowedTypes.includes(mimetype)) {
    throw new Error(
      "Uploaded file is of an invalid type: " + file.originalname + " (" + (type ? type.mime : "unknown mimetype") + ")"
    );
  }

  let data = null;

  if (mimetype === TYPE_EPUB && device.isKindle && kindlegen) {
    conversion = "kindlegen";
    const outname = file.path.replace(/\.epub$/i, ".mobi");
    filename = filename.replace(/\.kepub\.epub$/i, ".epub").replace(/\.epub$/i, ".mobi");

    const result = await converter.convert("kindlegen", file.path, dirname(file.path), file.path);
    data = result.outputPath;
  } else if (mimetype === TYPE_EPUB && device.isKobo && kepubify) {
    conversion = "kepubify";
    const outname = file.path.replace(/\.epub$/i, ".kepub.epub");
    filename = filename.replace(/\.kepub\.epub$/i, ".epub").replace(/\.epub$/i, ".kepub.epub");

    const result = await converter.convert("kepubify", file.path, dirname(file.path), file.path);
    data = result.outputPath;
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

module.exports = { processFile, createChildProcessAdapter, createFakeAdapter };
