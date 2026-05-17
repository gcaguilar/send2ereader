const express = require("express");
const logger = require("morgan");
const { mkdirp } = require("mkdirp");
const fs = require("fs");
const { createRouter } = require("./router");
const { create } = require("./key-session");
const { port } = require("./config");

function createApp(config, converter) {
  const app = express();
  app.set("trust proxy", 1);
  const keysMap = new Map();
  const sessionStore = create(keysMap, config);

  app.use(logger("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const router = createRouter(sessionStore, config, converter);

  app.use(express.static("static"));
  app.use(router);

  return { app };
}

function bootstrap(config, converter) {
  return new Promise((resolve, reject) => {
    const { app } = createApp(config, converter);

    fs.rm("uploads", { recursive: true, force: true }, (err) => {
      if (err && err.code !== "ENOENT") return reject(err);
      mkdirp("uploads").then(() => {
        const server = app.listen(port, "0.0.0.0", () => {
          console.log("server is listening on port " + port);
          resolve({ app, server });
        });
      }).catch(reject);
    });
  });
}

module.exports = { createApp, bootstrap };
