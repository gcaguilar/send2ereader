const http = require("http");
const Koa = require("koa");
const logger = require("koa-logger");
const serve = require("koa-static");
const { mkdirp } = require("mkdirp");
const fs = require("fs");
const { createRouter } = require("./router");
const { create } = require("./key-session");
const { port } = require("./config");

function createApp(config, converter) {
  const app = new Koa();
  const keysMap = new Map();
  const sessionStore = create(keysMap, config);

  app.use(logger());

  const router = createRouter(sessionStore, config, converter);

  app.use(serve("static"));
  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = http.createServer(app.callback());

  return { app, server };
}

function bootstrap(config, converter) {
  return new Promise((resolve, reject) => {
    const { app, server } = createApp(config, converter);

    fs.rm("uploads", { recursive: true, force: true }, (err) => {
      if (err && err.code !== "ENOENT") return reject(err);
      mkdirp("uploads").then(() => {
        server.listen(port, "0.0.0.0", () => {
          console.log("server is listening on port " + port);
          resolve({ app, server });
        });
      }).catch(reject);
    });
  });
}

module.exports = { createApp, bootstrap };
