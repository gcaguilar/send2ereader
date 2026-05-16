const fs = require("fs");

function create(keysMap, config) {
  const { expireDelay } = config;

  function removeSession(key) {
    const info = keysMap.get(key);
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

    keysMap.delete(key);
  }

  function expireSession(key) {
    const info = keysMap.get(key);
    const timer = setTimeout(removeSession, expireDelay * 1000, key);
    if (info) {
      clearTimeout(info.timer);
      info.timer = timer;
      info.alive = new Date();
    }
    return timer;
  }

  function generateKey(keyChars, keyLength) {
    const choices = Math.pow(keyChars.length, keyLength);
    const rnd = Math.floor(Math.random() * choices);

    return rnd
      .toString(keyChars.length)
      .padStart(keyLength, "0")
      .split("")
      .map((chr) => keyChars[parseInt(chr, keyChars.length)])
      .join("");
  }

  return {
    generateKey,
    getSession: (key) => keysMap.get(key),
    hasSession: (key) => keysMap.has(key),
    setSession: (key, info) => keysMap.set(key, info),
    removeSession,
    expireSession,
    get size() {
      return keysMap.size;
    },
  };
}

module.exports = { create };
