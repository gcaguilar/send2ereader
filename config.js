const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const maxKeys = process.env.MAX_KEYS ? Number(process.env.MAX_KEYS) : 1000;
const generateRateLimitMax = process.env.GENERATE_RATE_LIMIT ? Number(process.env.GENERATE_RATE_LIMIT) : 10;
const generateRateLimitWindowMs = 60 * 1000; // 1 minute

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
const keyLength = 6;

module.exports = {
  port,
  maxKeys,
  generateRateLimitMax,
  generateRateLimitWindowMs,
  expireDelay,
  maxExpireDuration,
  maxFileSize,
  TYPE_EPUB,
  TYPE_MOBI,
  allowedTypes,
  allowedExtensions,
  keyChars,
  keyLength,
};
