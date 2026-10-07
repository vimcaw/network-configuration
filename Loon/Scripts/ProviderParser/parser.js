/*!
 * Loon Provider Parser
 *
 * 在 Sub-Store 解析引擎（负责拉取、解码、age 解密、转换为 Loon 节点）的输出上，
 * 对节点做：排除、正则重命名、去旗帜、去地区、加前后缀、排序、去重。
 *
 * 配置来源：Loon 传入的插件参数（订阅未单独设置时是插件页面的全局值，单独设置过则是该订阅的值）
 * < 远程配置 global < 远程配置 subscriptions 中匹配的项（后者覆盖前者）。
 * Loon 不会把订阅（[Remote Proxy]）的别名传给解析器，别名来自参数 name（订阅名称）。
 *
 * 本文件是源码；../ProviderParser.js 是把 Sub-Store 引擎嵌入 SUBSTORE 区块后的构建产物（node build.js）。
 */

var LPP = (function () {
  "use strict";

  var STORE_REMOTE = "LoonProviderParser.remote.";
  var LOG = "[ProviderParser]";

  // ---------- 参数定义 ----------

  var DEFAULTS = {
    resourceUrlOnly: true,
    ua: "",
    timeout: "",
    noCache: false,
    ageSecretKey: "",
    aliasPrefix: false,
    aliasSuffix: false,
    aliasSep: " ",
    name: "",
    prefix: "",
    suffix: "",
    noFlag: false,
    noRegion: false,
    rename: "",
    exclude: "",
    sort: "none",
    sortKeys: "",
    configUrl: "",
    debug: false
  };

  var BOOL_KEYS = {
    resourceUrlOnly: 1, noCache: 1, aliasPrefix: 1, aliasSuffix: 1,
    noFlag: 1, noRegion: 1, debug: 1
  };

  var KEY_ALIASES = {
    "age-secret-key": "ageSecretKey",
    agesecretkey: "ageSecretKey",
    alias: "name",
    pre: "prefix",
    suf: "suffix",
    exc: "exclude",
    nocache: "noCache",
    resourceurlonly: "resourceUrlOnly",
    noflag: "noFlag",
    noregion: "noRegion",
    sortkeys: "sortKeys",
    configurl: "configUrl",
    aliasprefix: "aliasPrefix",
    aliassuffix: "aliasSuffix",
    aliassep: "aliasSep",
    "user-agent": "ua",
    useragent: "ua"
  };

  var SORT_MODES = {
    "none": "none", "不排序": "none", "": "none",
    "keyword": "keyword", "关键字": "keyword", "关键词": "keyword",
    "name": "name", "名称升序": "name", "名称": "name",
    "namedesc": "nameDesc", "name-desc": "nameDesc", "名称降序": "nameDesc",
    "region": "region", "地区": "region",
    "rate": "rate", "倍率升序": "rate", "倍率": "rate",
    "ratedesc": "rateDesc", "rate-desc": "rateDesc", "倍率降序": "rateDesc"
  };

  function str(v) { return v == null ? "" : String(v); }

  function toBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    var s = str(v).trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on" || s === "开";
  }

  function canonicalKey(k) {
    k = str(k).trim();
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) return k;
    var lower = k.toLowerCase();
    if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
    if (KEY_ALIASES[k]) return KEY_ALIASES[k];
    return null;
  }

  // 把任意来源的键值规整为已知参数；未知键丢弃
  function normalize(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var key = canonicalKey(k);
      if (!key) continue;
      var v = obj[k];
      if (v === undefined || v === null) continue;
      out[key] = BOOL_KEYS[key] ? toBool(v) : (typeof v === "string" ? v : String(v));
    }
    return out;
  }

  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    return out;
  }

  // ---------- 持久化 ----------

  function storeRead(key) {
    try {
      if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
    } catch (e) { /* ignore */ }
    return null;
  }

  function storeWrite(key, value) {
    try {
      if (typeof $persistentStore !== "undefined") return $persistentStore.write(value, key);
    } catch (e) { /* ignore */ }
    return false;
  }

  // ---------- 规则解析 ----------

  // 按未转义的分隔符切分，保留反斜杠（正则里的 \, \; 等本身就是合法转义）
  function splitUnescaped(s, seps) {
    var out = [];
    var cur = "";
    s = str(s);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "\\" && i + 1 < s.length) {
        cur += ch + s.charAt(i + 1);
        i++;
        continue;
      }
      if (seps.indexOf(ch) >= 0) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // "/pattern/flags" → RegExp；否则 null
  function asRegex(token, defaultFlags) {
    var m = /^\/(.+)\/([gimsuy]*)$/.exec(token);
    if (!m) return null;
    var flags = m[2] || "";
    if (defaultFlags) {
      for (var i = 0; i < defaultFlags.length; i++) {
        if (flags.indexOf(defaultFlags.charAt(i)) < 0) flags += defaultFlags.charAt(i);
      }
    }
    return new RegExp(m[1], flags);
  }

  function escapeRegex(s) {
    return str(s).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  }

  // 关键字列表：逗号分隔，/.../flags 为正则，其余为忽略大小写的包含匹配
  function parseMatchers(text, label) {
    var list = [];
    var items = splitUnescaped(text, ",，\n");
    for (var i = 0; i < items.length; i++) {
      var raw = items[i].trim();
      if (!raw) continue;
      try {
        var re = asRegex(raw, "");
        if (re) {
          list.push({ src: raw, re: new RegExp(re.source, re.flags.replace("g", "")) });
        } else {
          var plain = raw.replace(/\\([,，\\])/g, "$1");
          list.push({ src: raw, re: new RegExp(escapeRegex(plain), "i") });
        }
      } catch (e) {
        console.log(LOG + " " + label + " 规则无效，已跳过：" + raw + "（" + e.message + "）");
      }
    }
    return list;
  }

  function firstMatchIndex(matchers, name) {
    for (var i = 0; i < matchers.length; i++) if (matchers[i].re.test(name)) return i;
    return -1;
  }

  // 重命名规则：分号或换行分隔多条，每条 "匹配 -> 替换"
  // 匹配部分默认是正则（全局替换），也可写成 /pattern/flags；替换部分支持 $1 $2 $<name> $&
  function parseRenameRules(text) {
    var rules = [];
    var items = splitUnescaped(text, ";；\n");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item.trim()) continue;
      var arrow = -1;
      for (var j = 0; j < item.length - 1; j++) {
        if (item.charAt(j) === "\\") { j++; continue; }
        if (item.charAt(j) === "-" && item.charAt(j + 1) === ">") { arrow = j; break; }
      }
      if (arrow < 0) {
        console.log(LOG + " 重命名规则缺少 ->，已跳过：" + item);
        continue;
      }
      var pattern = item.slice(0, arrow).trim();
      var replacement = item.slice(arrow + 2).trim().replace(/\\([;；\\]|->)/g, "$1");
      if (!pattern) continue;
      try {
        var re = asRegex(pattern, "g") || new RegExp(pattern, "g");
        rules.push({ re: re, to: replacement });
      } catch (e) {
        console.log(LOG + " 重命名正则无效，已跳过：" + pattern + "（" + e.message + "）");
      }
    }
    return rules;
  }

  // ---------- 地区与旗帜 ----------

  // [代码, 中文名, 英文名, 额外的大写代码]，顺序即“地区”排序的顺序
  var REGIONS = [
    ["HK", ["香港"], ["Hong Kong", "HongKong"], ["HKG"]],
    ["MO", ["澳门", "澳門"], ["Macau", "Macao"], ["MAC"]],
    ["TW", ["台湾", "台灣", "臺灣"], ["Taiwan"], ["TWN"]],
    ["JP", ["日本"], ["Japan"], ["JPN"]],
    ["KR", ["韩国", "韓國", "南韩", "南韓"], ["South Korea", "Korea"], ["KOR"]],
    ["SG", ["新加坡", "狮城", "獅城"], ["Singapore"], ["SGP"]],
    ["US", ["美国", "美國"], ["United States", "America"], ["USA"]],
    ["CN", ["中国", "中國"], ["China"], ["CHN"]],
    ["GB", ["英国", "英國"], ["United Kingdom", "Britain", "England"], ["UK", "GBR"]],
    ["DE", ["德国", "德國"], ["Germany"], ["DEU"]],
    ["FR", ["法国", "法國"], ["France"], ["FRA"]],
    ["NL", ["荷兰", "荷蘭"], ["Netherlands", "Holland"], ["NLD"]],
    ["RU", ["俄罗斯", "俄羅斯"], ["Russia"], ["RUS"]],
    ["CA", ["加拿大"], ["Canada"], ["CAN"]],
    ["AU", ["澳大利亚", "澳大利亞", "澳洲"], ["Australia"], ["AUS"]],
    ["NZ", ["新西兰", "紐西蘭", "新西蘭"], ["New Zealand"], ["NZL"]],
    ["IN", ["印度"], ["India"], ["IND"]],
    ["ID", ["印度尼西亚", "印度尼西亞", "印尼"], ["Indonesia"], ["IDN"]],
    ["TH", ["泰国", "泰國"], ["Thailand"], ["THA"]],
    ["VN", ["越南"], ["Vietnam", "Viet Nam"], ["VNM"]],
    ["MY", ["马来西亚", "馬來西亞"], ["Malaysia"], ["MYS"]],
    ["PH", ["菲律宾", "菲律賓"], ["Philippines"], ["PHL"]],
    ["KH", ["柬埔寨"], ["Cambodia"], ["KHM"]],
    ["TR", ["土耳其"], ["Turkey", "Türkiye"], ["TUR"]],
    ["AE", ["阿联酋", "阿聯酋", "迪拜"], ["United Arab Emirates", "Dubai"], ["UAE", "ARE"]],
    ["IL", ["以色列"], ["Israel"], ["ISR"]],
    ["IT", ["意大利", "義大利"], ["Italy"], ["ITA"]],
    ["ES", ["西班牙"], ["Spain"], ["ESP"]],
    ["CH", ["瑞士"], ["Switzerland"], ["CHE"]],
    ["SE", ["瑞典"], ["Sweden"], ["SWE"]],
    ["NO", ["挪威"], ["Norway"], ["NOR"]],
    ["FI", ["芬兰", "芬蘭"], ["Finland"], ["FIN"]],
    ["IE", ["爱尔兰", "愛爾蘭"], ["Ireland"], ["IRL"]],
    ["PL", ["波兰", "波蘭"], ["Poland"], ["POL"]],
    ["UA", ["乌克兰", "烏克蘭"], ["Ukraine"], ["UKR"]],
    ["KZ", ["哈萨克斯坦", "哈薩克"], ["Kazakhstan"], ["KAZ"]],
    ["EG", ["埃及"], ["Egypt"], ["EGY"]],
    ["ZA", ["南非"], ["South Africa"], ["ZAF"]],
    ["NG", ["尼日利亚", "奈及利亞"], ["Nigeria"], ["NGA"]],
    ["BR", ["巴西"], ["Brazil"], ["BRA"]],
    ["AR", ["阿根廷"], ["Argentina"], ["ARG"]],
    ["CL", ["智利"], ["Chile"], ["CHL"]],
    ["MX", ["墨西哥"], ["Mexico"], ["MEX"]]
  ];

  var FLAG_RE = /🏴(?:\uDB40[\uDC20-\uDC7F])+|(?:\uD83C[\uDDE6-\uDDFF]){1,2}/g;
  var regionCache = null;

  function byLengthDesc(a, b) { return b.length - a.length; }

  function buildRegionMatchers() {
    if (regionCache) return regionCache;
    var zh = [], en = [], codes = [];
    var lookup = {};
    for (var i = 0; i < REGIONS.length; i++) {
      var r = REGIONS[i];
      var allCodes = [r[0]].concat(r[3]);
      for (var a = 0; a < r[1].length; a++) { zh.push(r[1][a]); lookup[r[1][a]] = i; }
      for (var b = 0; b < r[2].length; b++) { en.push(r[2][b]); lookup[r[2][b].toLowerCase()] = i; }
      for (var c = 0; c < allCodes.length; c++) { codes.push(allCodes[c]); lookup[allCodes[c]] = i; }
    }
    zh.sort(byLengthDesc); en.sort(byLengthDesc); codes.sort(byLengthDesc);
    var enAlt = en.map(function (s) { return escapeRegex(s).replace(/ /g, "[\\s_-]?"); }).join("|");
    regionCache = {
      zh: new RegExp("(" + zh.map(escapeRegex).join("|") + ")", "g"),
      // 英文名不区分大小写；代码只匹配大写。两者都要求前后不是字母，避免误伤 PLUS、BUS 等
      en: new RegExp("(^|[^A-Za-z])(" + enAlt + ")(?=[^A-Za-z]|$)", "gi"),
      codes: new RegExp("(^|[^A-Za-z])(" + codes.join("|") + ")(?=[^A-Za-z]|$)", "g"),
      lookup: lookup
    };
    return regionCache;
  }

  function flagToCode(flag) {
    if (flag.length !== 4) return "";
    var a = flag.charCodeAt(1) - 0xDDE6, b = flag.charCodeAt(3) - 0xDDE6;
    if (a < 0 || a > 25 || b < 0 || b > 25) return "";
    return String.fromCharCode(65 + a) + String.fromCharCode(65 + b);
  }

  // 返回地区在 REGIONS 中的序号；未识别返回 REGIONS.length
  function regionIndex(name) {
    var m = buildRegionMatchers();
    var flags = str(name).match(FLAG_RE);
    if (flags) {
      for (var f = 0; f < flags.length; f++) {
        var code = flagToCode(flags[f]);
        if (code && m.lookup[code] !== undefined) return m.lookup[code];
      }
    }
    var hit;
    m.zh.lastIndex = 0;
    if ((hit = m.zh.exec(name))) return m.lookup[hit[1]];
    m.en.lastIndex = 0;
    if ((hit = m.en.exec(name))) {
      var key = hit[2].toLowerCase().replace(/[\s_-]/g, "");
      for (var k in m.lookup) {
        if (k.toLowerCase().replace(/\s/g, "") === key) return m.lookup[k];
      }
    }
    m.codes.lastIndex = 0;
    if ((hit = m.codes.exec(name))) return m.lookup[hit[2]];
    return REGIONS.length;
  }

  function stripRegion(name) {
    var m = buildRegionMatchers();
    return str(name).replace(m.zh, "").replace(m.en, "$1").replace(m.codes, "$1");
  }

  function stripFlags(name) {
    return str(name).replace(FLAG_RE, "").replace(/️|‍/g, "");
  }

  function tidy(name) {
    return str(name)
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-_|·•:：,，/]+|[\s\-_|·•:：,，/]+$/g, "")
      .replace(/([\-_|·•])\s*\1+/g, "$1");
  }

  // 倍率：识别 "2x" "x2" "×1.5" "0.5倍" 等，默认 1
  function rateOf(name) {
    var s = str(name);
    var m = /(\d+(?:\.\d+)?)\s*(?:[xX×✕]|倍)(?![A-Za-z])/.exec(s) ||
      /(?:^|[^A-Za-z])[xX×✕]\s*(\d+(?:\.\d+)?)/.exec(s);
    var n = m ? parseFloat(m[1]) : 1;
    return isFinite(n) ? n : 1;
  }

  var collator = null;
  try { collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" }); } catch (e) { collator = null; }

  function naturalCompare(a, b) {
    if (collator) return collator.compare(a, b);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // ---------- 节点处理 ----------

  function processNodes(text, cfg, alias) {
    var renameRules = parseRenameRules(cfg.rename);
    var excludes = parseMatchers(cfg.exclude, "排除");
    var sortMode = SORT_MODES[str(cfg.sort).trim().toLowerCase()] || SORT_MODES[str(cfg.sort).trim()] || "none";
    var sortKeys = sortMode === "keyword" ? parseMatchers(cfg.sortKeys, "排序关键字") : [];

    var prefix = str(cfg.prefix) || (cfg.aliasPrefix && alias ? alias + cfg.aliasSep : "");
    var suffix = str(cfg.suffix) || (cfg.aliasSuffix && alias ? cfg.aliasSep + alias : "");
    if ((cfg.aliasPrefix && !cfg.prefix || cfg.aliasSuffix && !cfg.suffix) && !alias) {
      console.log(LOG + " 未填写订阅名称，别名前/后缀未生效。请在该订阅的插件参数里填写「订阅名称」");
    }

    var lines = str(text).split(/\r\n|\r|\n/);
    var head = [];
    var nodes = [];
    var excluded = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line.trim();
      var eq = t.indexOf("=");
      if (!t || t.charAt(0) === "#" || t.indexOf("//") === 0 || t.charAt(0) === "[" || eq <= 0) {
        if (t) head.push(line);
        continue;
      }
      var original = t.slice(0, eq).trim();
      var rest = t.slice(eq + 1).trim();
      if (excludes.length && firstMatchIndex(excludes, original) >= 0) { excluded++; continue; }

      var n = original;
      for (var r = 0; r < renameRules.length; r++) {
        renameRules[r].re.lastIndex = 0;
        n = n.replace(renameRules[r].re, renameRules[r].to);
      }
      if (cfg.noFlag) n = stripFlags(n);
      if (cfg.noRegion) n = stripRegion(n);
      n = tidy(n);
      n = prefix + n + suffix;
      n = n.replace(/=/g, "＝").trim();
      if (!n) n = original;

      nodes.push({ idx: nodes.length, original: original, name: n, rest: rest });
    }

    if (sortMode !== "none") {
      var keyOf;
      if (sortMode === "keyword") {
        keyOf = function (x) { var k = firstMatchIndex(sortKeys, x.original); return k < 0 ? sortKeys.length : k; };
      } else if (sortMode === "region") {
        keyOf = function (x) { return regionIndex(x.original); };
      } else if (sortMode === "rate" || sortMode === "rateDesc") {
        keyOf = function (x) { return rateOf(x.original); };
      }
      for (var s = 0; s < nodes.length; s++) if (keyOf) nodes[s].key = keyOf(nodes[s]);
      nodes.sort(function (a, b) {
        var d = 0;
        if (sortMode === "name") d = naturalCompare(a.name, b.name);
        else if (sortMode === "nameDesc") d = naturalCompare(b.name, a.name);
        else if (sortMode === "rateDesc") d = b.key - a.key;
        else d = a.key - b.key;
        return d !== 0 ? d : a.idx - b.idx;
      });
    }

    // 处理后重名（例如去掉地区后都变成 "01"）时追加序号，避免 Loon 丢节点
    var used = {};
    for (var u = 0; u < nodes.length; u++) used[nodes[u].name] = (used[nodes[u].name] || 0) + 1;
    var seen = {};
    for (var v = 0; v < nodes.length; v++) {
      var nm = nodes[v].name;
      if (used[nm] > 1) {
        var c = (seen[nm] || 0) + 1;
        seen[nm] = c;
        if (c > 1) {
          var candidate = nm + " " + c;
          while (used[candidate]) { c++; candidate = nm + " " + c; }
          seen[nm] = c;
          used[candidate] = 1;
          nodes[v].name = candidate;
        }
      }
    }

    var out = head.slice();
    for (var o = 0; o < nodes.length; o++) out.push(nodes[o].name + " = " + nodes[o].rest);
    return { text: out.join("\n"), total: nodes.length + excluded, kept: nodes.length, excluded: excluded };
  }

  // ---------- 远程配置（跨设备同步） ----------

  function matchRemoteSubs(remote, alias, url) {
    var out = {};
    var subs = remote && (remote.subscriptions || remote.subs);
    if (!subs || typeof subs !== "object") return out;
    for (var key in subs) {
      if (!Object.prototype.hasOwnProperty.call(subs, key)) continue;
      var hit = (alias && key.toLowerCase() === alias.toLowerCase()) || (url && url.indexOf(key) >= 0);
      if (hit) out = merge(out, normalize(subs[key]));
    }
    return out;
  }

  function loadRemoteConfig(url, done) {
    if (!url) return done(null);
    var cacheKey = STORE_REMOTE + url;
    function fromCache(reason) {
      var cached = storeRead(cacheKey);
      if (cached) {
        try {
          console.log(LOG + " 远程配置" + reason + "，使用上次缓存");
          return done(JSON.parse(cached));
        } catch (e) { /* fallthrough */ }
      }
      console.log(LOG + " 远程配置" + reason + "，且没有缓存，忽略远程配置");
      done(null);
    }
    if (typeof $httpClient === "undefined") return fromCache("无法请求");
    try {
      $httpClient.get({ url: url, timeout: 5000, headers: { "Cache-Control": "no-cache" } }, function (err, resp, data) {
        var status = resp && resp.status;
        if (err || !data || (status && (status < 200 || status >= 300))) return fromCache("拉取失败");
        try {
          var json = JSON.parse(data);
          storeWrite(cacheKey, JSON.stringify(json));
          done(json);
        } catch (e) {
          fromCache("不是有效 JSON");
        }
      });
    } catch (e) {
      fromCache("拉取异常");
    }
  }

  // ---------- 主流程 ----------

  function main(runEngine) {
    var startedAt = Date.now();
    var resource = typeof $resource !== "undefined" ? $resource : "";
    var type = typeof $resourceType !== "undefined" ? $resourceType : 1;
    var url = typeof $resourceUrl !== "undefined" ? str($resourceUrl) : "";
    var finished = false;

    function finish(content) {
      if (finished) return;
      finished = true;
      $done(content);
    }

    try {
      var args = normalize(typeof $argument !== "undefined" ? $argument : null);
      var base = merge(DEFAULTS, args);

      loadRemoteConfig(str(base.configUrl).trim(), function (remote) {
        var cfg;
        try {
          var remoteGlobal = remote ? normalize(remote.global || {}) : {};
          var remoteSub = remote ? matchRemoteSubs(remote, str(base.name).trim(), url) : {};
          cfg = merge(base, remoteGlobal, remoteSub);
        } catch (e) {
          console.log(LOG + " 配置合并失败：" + e.message);
          cfg = base;
        }
        var alias = str(cfg.name).trim();

        if (cfg.debug) {
          console.log(LOG + " 订阅名称：" + (alias || "(未填写)") + "，URL：" + url);
          var shown = merge(cfg);
          if (shown.ageSecretKey) shown.ageSecretKey = "***";
          console.log(LOG + " 生效配置：" + JSON.stringify(shown));
        }

        var engineArgs = { resourceUrlOnly: !!cfg.resourceUrlOnly, noCache: !!cfg.noCache };
        if (str(cfg.ua).trim()) engineArgs.ua = str(cfg.ua).trim();
        if (str(cfg.timeout).trim()) {
          var ms = Number(str(cfg.timeout).trim());
          engineArgs.timeout = isFinite(ms) ? ms : str(cfg.timeout).trim();
        }
        if (str(cfg.ageSecretKey).trim()) engineArgs["age-secret-key"] = str(cfg.ageSecretKey).trim();

        runEngine(engineArgs, resource, type, url, function (produced) {
          if (finished) return;
          var output = str(produced);
          if (type !== 1) return finish(output);
          try {
            var res = processNodes(output, cfg, alias);
            console.log(LOG + " 节点 " + res.kept + "/" + res.total + "（排除 " + res.excluded + "），耗时 " + (Date.now() - startedAt) + "ms");
            finish(res.text);
          } catch (e) {
            console.log(LOG + " 处理节点出错，返回未处理结果：" + (e && e.message));
            finish(output);
          }
        });
      });
    } catch (e) {
      console.log(LOG + " 出错：" + (e && e.message));
      finish(str(resource));
    }
  }

  return {
    main: main,
    // 供本地测试使用
    _internal: {
      processNodes: processNodes, normalize: normalize,
      parseRenameRules: parseRenameRules, stripRegion: stripRegion, stripFlags: stripFlags,
      regionIndex: regionIndex, rateOf: rateOf, DEFAULTS: DEFAULTS
    }
  };
})();

// Sub-Store 解析引擎：用函数参数遮蔽 $done 等全局变量，拿到它的产出后再交给 LPP 处理
function __runSubStore($done, $argument, $resource, $resourceType, $resourceUrl) {
/* SUBSTORE:BEGIN */
  // 源码未嵌入引擎时直接透传，方便本地测试；构建时此区块会被替换为 Sub-Store 解析器代码
  $done($resource);
/* SUBSTORE:END */
}

LPP.main(function (args, resource, type, url, callback) {
  __runSubStore(callback, args, resource, type, url);
});
