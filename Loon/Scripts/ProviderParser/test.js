// 本地测试：在 vm 里模拟 Loon 解析器环境运行脚本
// 用法：node test.js [src|dist]（src 测本目录 parser.js，dist 测构建出的 ../ProviderParser.js）
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const which = process.argv[2] || "src";
const file = which === "dist" ? path.join(__dirname, "..", "ProviderParser.js") : path.join(__dirname, "parser.js");
const code = fs.readFileSync(file, "utf8");

function run({ resource, argument, url = "https://sub.example.com/api?token=abc", type = 1, store = {}, http = {}, globals = {} }) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const ctx = {
      console: { log: (...a) => logs.push(a.join(" ")) },
      $resource: resource,
      $resourceType: type,
      $resourceUrl: url,
      $argument: argument,
      $loon: "iPhone16,2 iOS/18.0 Loon/3.5.1(998)",
      $persistentStore: {
        read: (k) => (k in store ? store[k] : null),
        write: (v, k) => { store[k] = v; return true; },
      },
      $httpClient: {
        get: (opts, cb) => {
          const u = typeof opts === "string" ? opts : opts.url;
          setTimeout(() => (u in http ? cb(null, { status: 200, headers: {} }, http[u]) : cb("offline", null, null)), 1);
        },
        post: (opts, cb) => setTimeout(() => cb("offline", null, null), 1),
      },
      $notification: { post: () => {} },
      setTimeout, clearTimeout, Promise, TextEncoder, TextDecoder, Intl, atob, btoa, URL, URLSearchParams,
      $done: (out) => resolve({ out: typeof out === "object" && out ? out : out, logs, store }),
      ...globals,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    try { vm.runInContext(code, ctx, { filename: file }); } catch (e) { reject(e); }
    setTimeout(() => reject(new Error("timeout; logs:\n" + logs.join("\n"))), 15000);
  });
}

const loonLines = [
  "🇭🇰 香港 IPLC 01 = Shadowsocks,1.1.1.1,443,aes-128-gcm,\"pw\"",
  "🇭🇰 香港 02 x2 = Shadowsocks,1.1.1.2,443,aes-128-gcm,\"pw\"",
  "🇯🇵 日本 东京 01 = Shadowsocks,1.1.1.3,443,aes-128-gcm,\"pw\"",
  "🇺🇸 US Los Angeles 0.5x = Shadowsocks,1.1.1.4,443,aes-128-gcm,\"pw\"",
  "🇸🇬 Singapore 01 = Shadowsocks,1.1.1.5,443,aes-128-gcm,\"pw\"",
  "剩余流量：100GB = Shadowsocks,1.1.1.6,443,aes-128-gcm,\"pw\"",
  "官网 example.com = Shadowsocks,1.1.1.7,443,aes-128-gcm,\"pw\"",
  "🇹🇼 台湾 01 = Shadowsocks,1.1.1.8,443,aes-128-gcm,\"pw\"",
].join("\n");

const names = (out) => out.split("\n").filter(Boolean).map((l) => l.slice(0, l.indexOf(" = ")));

const tests = [];
const test = (name, fn, onlyFor) => tests.push({ name, fn, onlyFor });

test("排除 + 去旗帜 + 去地区 + 地区排序", async () => {
  const r = await run({
    resource: loonLines,
    argument: { noFlag: true, noRegion: true, exclude: "剩余流量,/官网|到期/", sort: "地区" },
  });
  assert.deepStrictEqual(names(r.out), ["IPLC 01", "02 x2", "01", "东京 01", "01 2", "Los Angeles 0.5x"]);
}, "src");

test("正则多重替换 $1 $2 + 别名前缀 + 名称排序", async () => {
  const r = await run({
    resource: loonLines,
    argument: { noFlag: true, rename: "(香港|日本)\\s*(\\d+) -> $2-$1 ; /iplc/i -> 专线", aliasPrefix: true, aliasSep: "·", exclude: "流量,官网", sort: "名称升序" },
    url: "https://sub.example.com/api#name=机场A",
  });
  assert.ok(names(r.out).every((n) => n.startsWith("机场A·")), names(r.out).join("|"));
  assert.ok(names(r.out).includes("机场A·香港 专线 01"), names(r.out).join("|"));
  assert.ok(names(r.out).includes("机场A·02-香港 x2"), names(r.out).join("|"));
}, "src");

test("倍率降序 + 关键字排序", async () => {
  let r = await run({ resource: loonLines, argument: { exclude: "流量,官网", sort: "倍率降序" } });
  assert.strictEqual(names(r.out)[0], "🇭🇰 香港 02 x2");
  assert.strictEqual(names(r.out).at(-1), "🇺🇸 US Los Angeles 0.5x");
  r = await run({ resource: loonLines, argument: { exclude: "流量,官网", sort: "关键字", sortKeys: "/新加坡|singapore/i,日本" } });
  assert.deepStrictEqual(names(r.out).slice(0, 2), ["🇸🇬 Singapore 01", "🇯🇵 日本 东京 01"]);
}, "src");

test("订阅字符串参数覆盖全局，全局从缓存补齐", async () => {
  const store = {};
  await run({ resource: loonLines, argument: { noFlag: true, aliasPrefix: true }, store });
  const r = await run({ resource: loonLines, argument: "prefix=%5BA%5D%20&exclude=香港", store });
  const ns = names(r.out);
  assert.ok(ns.every((n) => n.startsWith("[A] ") && !/🇯🇵/.test(n)), ns.join("|"));
  assert.ok(!ns.some((n) => n.includes("香港")));
}, "src");

test("URL 片段单独配置，且从 URL 去掉", async () => {
  const r = await run({ resource: loonLines, argument: { noFlag: false }, url: "https://sub.example.com/x?t=1#noFlag&suffix=%20%E2%9C%88", globals: {} });
  assert.ok(names(r.out).every((n) => n.endsWith(" ✈") && !/🇭🇰/.test(n)), names(r.out).join("|"));
}, "src");

test("远程配置：global + 按 URL 关键字匹配", async () => {
  const cfgUrl = "https://gist.example.com/cfg.json";
  const http = { [cfgUrl]: JSON.stringify({ global: { noFlag: true }, subscriptions: { "sub.example.com": { exclude: "日本,流量,官网", prefix: "R-" } } }) };
  const store = {};
  let r = await run({ resource: loonLines, argument: { configUrl: cfgUrl }, http, store });
  let ns = names(r.out);
  assert.ok(ns.every((n) => n.startsWith("R-") && !/🇭🇰/.test(n)) && !ns.some((n) => n.includes("日本")), ns.join("|"));
  r = await run({ resource: loonLines, argument: { configUrl: cfgUrl }, http: {}, store }); // 离线用缓存
  assert.deepStrictEqual(names(r.out), ns);
}, "src");

test("重名自动加序号", async () => {
  const r = await run({ resource: "香港 01 = a,1\n日本 01 = a,2\n美国 01 = a,3", argument: { noRegion: true } });
  assert.deepStrictEqual(names(r.out), ["01", "01 2", "01 3"]);
}, "src");

test("Sub-Store 引擎解析 Base64 URI 订阅后再处理", async () => {
  const uris = [
    "ss://" + Buffer.from("aes-128-gcm:pass").toString("base64") + "@1.2.3.4:8388#" + encodeURIComponent("🇭🇰 香港 01 [2x]"),
    "trojan://pwd@5.6.7.8:443?sni=a.com#" + encodeURIComponent("🇯🇵 日本 02"),
    "trojan://pwd@9.9.9.9:443?sni=a.com#" + encodeURIComponent("到期时间：2027-01-01"),
  ].join("\n");
  const r = await run({
    resource: Buffer.from(uris).toString("base64"),
    argument: { resourceUrlOnly: false, noFlag: true, noRegion: true, exclude: "到期", rename: "\\[(\\d+)x\\] -> ×$1", sort: "倍率降序" },
  });
  const ns = names(r.out);
  assert.deepStrictEqual(ns, ["01 ×2", "02"], r.out + "\n" + r.logs.join("\n"));
  assert.ok(/= shadowsocks,1\.2\.3\.4,8388/i.test(r.out), r.out);
}, "dist");

test("resourceUrlOnly：引擎按去掉片段的 URL 拉取", async () => {
  const subUrl = "https://sub.example.com/api?token=abc";
  const body = Buffer.from("trojan://pwd@5.6.7.8:443?sni=a.com#" + encodeURIComponent("🇯🇵 日本 02")).toString("base64");
  const r = await run({ resource: "", url: subUrl + "#name=机场B&noFlag", http: { [subUrl]: body }, argument: { resourceUrlOnly: true, aliasSuffix: true, ua: "clash.meta", timeout: "8000" } });
  assert.deepStrictEqual(names(r.out), ["日本 02 机场B"], r.out + "\n" + r.logs.join("\n"));
}, "dist");

test("非节点资源原样交给引擎", async () => {
  const r = await run({ resource: "DOMAIN-SUFFIX,google.com", type: 2, argument: { resourceUrlOnly: false, noFlag: true } });
  assert.ok(/google\.com/.test(r.out), r.out);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    if (t.onlyFor && t.onlyFor !== which) continue;
    try { await t.fn(); console.log("✓", t.name); }
    catch (e) { failed++; console.log("✗", t.name, "\n ", e.message); }
  }
  process.exit(failed ? 1 : 0);
})();
