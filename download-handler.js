const sendfile = require("koa-sendfile");
const { allowedTypes, allowedExtensions } = require("./config");

async function handleDownloadFile(ctx, next, sessionStore) {
  const key = ctx.query.key ? String(ctx.query.key).toUpperCase() : null;
  if (!key) return next();

  const filename = decodeURIComponent(ctx.params.filename);
  const session = sessionStore.getSession(key);
  const file = session?.files ? session.files.find((f) => f.name === filename) : null;

  if (!session || !file) return next();

  if (session.agent !== ctx.get("user-agent")) {
    console.error("User Agent doesnt match: " + session.agent + " VS " + ctx.get("user-agent"));
    ctx.response.status = 403;
    ctx.body = "Forbidden";
    return;
  }

  sessionStore.expireSession(key);
  const device = require("./device-detector").detect(session.agent);
  if (device.isKindle) ctx.attachment(file.name);
  await sendfile(ctx, file.path);
}

async function handleDeleteFile(ctx, next, sessionStore) {
  const key = ctx.params.key.toUpperCase();
  const filename = decodeURIComponent(ctx.params.filename);
  const session = sessionStore.getSession(key);

  if (!session) ctx.throw(400, "Unknown key: " + key);

  const fileIndex = session.files.findIndex((f) => f.name === filename);
  if (fileIndex !== -1) {
    const file = session.files[fileIndex];
    const fs = require("fs");
    fs.unlink(file.path, (err) => err && console.error(err));
    session.files.splice(fileIndex, 1);
  }

  ctx.body = "ok";
}

module.exports = { handleDownloadFile, handleDeleteFile };
