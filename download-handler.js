const { allowedTypes, allowedExtensions } = require("./config");

async function handleDownloadFile(req, res, sessionStore) {
  const key = req.query.key ? String(req.query.key).toUpperCase() : null;
  if (!key) return;

  const filename = decodeURIComponent(req.params.filename);
  const session = sessionStore.getSession(key);
  const file = session?.files ? session.files.find((f) => f.name === filename) : null;

  if (!session || !file) return;

  if (session.agent !== req.get("User-Agent")) {
    console.error("User Agent doesnt match: " + session.agent + " VS " + req.get("User-Agent"));
    res.status(403).send("Forbidden");
    return;
  }

  sessionStore.expireSession(key);
  const device = require("./device-detector").detect(session.agent);
  if (device.isKindle) res.attachment(file.name);
  res.sendFile(file.path);
}

async function handleDeleteFile(req, res, sessionStore) {
  const key = req.params.key.toUpperCase();
  const filename = decodeURIComponent(req.params.filename);
  const session = sessionStore.getSession(key);

  if (!session) {
    res.status(400).send("Unknown key: " + key);
    return;
  }

  const fileIndex = session.files.findIndex((f) => f.name === filename);
  if (fileIndex !== -1) {
    const file = session.files[fileIndex];
    const fs = require("fs");
    fs.unlink(file.path, (err) => err && console.error(err));
    session.files.splice(fileIndex, 1);
  }

  res.send("ok");
}

module.exports = { handleDownloadFile, handleDeleteFile };
