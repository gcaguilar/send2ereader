#!/usr/bin/env node

const { bootstrap } = require("./app");
const { createChildProcessAdapter } = require("./file-processor");
const config = require("./config");

bootstrap(config, createChildProcessAdapter()).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
