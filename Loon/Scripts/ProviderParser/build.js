#!/usr/bin/env node
// 用法：node build.js [sub-store-parser.loon.min.js 的本地路径]
// 不给路径时从 Sub-Store 最新 release 下载，生成 ../ProviderParser.js
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ENGINE_URL = "https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store-parser.loon.min.js";

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "loon-provider-parser-build" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

(async () => {
  const local = process.argv[2];
  const engine = local ? fs.readFileSync(local, "utf8") : await download(ENGINE_URL);
  const version = (engine.match(/Tm="([^"]+)"/) || [])[1] || "unknown";
  const src = fs.readFileSync(path.join(__dirname, "parser.js"), "utf8");
  const begin = "/* SUBSTORE:BEGIN */";
  const end = "/* SUBSTORE:END */";
  const i = src.indexOf(begin);
  const j = src.indexOf(end);
  if (i < 0 || j < i) throw new Error("parser.js 中找不到 SUBSTORE 标记");
  const header =
    "/*! 内嵌 Sub-Store 解析引擎 v" + version +
    "（https://github.com/sub-store-org/Sub-Store，AGPL-3.0）*/\n";
  const out = header + src.slice(0, i + begin.length) + "\n" + engine + "\n" + src.slice(j);
  const dest = path.join(__dirname, "..", "ProviderParser.js");
  fs.writeFileSync(dest, out);
  console.log(`已生成 ${dest}（Sub-Store v${version}，${(out.length / 1024).toFixed(0)} KB）`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
