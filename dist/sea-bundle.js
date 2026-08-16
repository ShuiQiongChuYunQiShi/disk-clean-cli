#!/usr/bin/env node
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// lib/engine.js
var require_engine = __commonJS({
  "lib/engine.js"(exports2, module2) {
    "use strict";
    var fs2 = require("fs");
    var fsp = fs2.promises;
    var path2 = require("path");
    var crypto = require("crypto");
    var args = process.argv.slice(2);
    function opt(name, def) {
      const i = args.indexOf(name);
      if (i < 0) return def;
      const v = args[i + 1];
      return v === void 0 ? def : v;
    }
    var roots = [];
    var excludes = [];
    var progressFile = "";
    var reportFile = "";
    var withTime = false;
    var suggestMode = false;
    var DAYS = 24 * 3600 * 1e3;
    var STALE_MS = 730 * DAYS;
    var STALE_LARGE_MIN = 500 * 1024 * 1024;
    var DUP_MIN_SIZE = 1 << 20;
    var DUP_FULL_LIMIT = 32 * 1024 * 1024;
    var DUP_HEAD = 64 * 1024;
    var DUP_TAIL = 64 * 1024;
    var EXT_CAT = {
      mp4: "\u5A92\u4F53",
      mkv: "\u5A92\u4F53",
      mov: "\u5A92\u4F53",
      avi: "\u5A92\u4F53",
      wmv: "\u5A92\u4F53",
      flv: "\u5A92\u4F53",
      webm: "\u5A92\u4F53",
      m4v: "\u5A92\u4F53",
      ts: "\u5A92\u4F53",
      mp3: "\u5A92\u4F53",
      flac: "\u5A92\u4F53",
      wav: "\u5A92\u4F53",
      aac: "\u5A92\u4F53",
      ogg: "\u5A92\u4F53",
      m4a: "\u5A92\u4F53",
      wma: "\u5A92\u4F53",
      opus: "\u5A92\u4F53",
      mid: "\u5A92\u4F53",
      jpg: "\u56FE\u7247",
      jpeg: "\u56FE\u7247",
      png: "\u56FE\u7247",
      gif: "\u56FE\u7247",
      webp: "\u56FE\u7247",
      bmp: "\u56FE\u7247",
      svg: "\u56FE\u7247",
      ico: "\u56FE\u7247",
      tif: "\u56FE\u7247",
      tiff: "\u56FE\u7247",
      raw: "\u56FE\u7247",
      heic: "\u56FE\u7247",
      psd: "\u56FE\u7247",
      ai: "\u56FE\u7247",
      avif: "\u56FE\u7247",
      doc: "\u6587\u6863",
      docx: "\u6587\u6863",
      xls: "\u6587\u6863",
      xlsx: "\u6587\u6863",
      ppt: "\u6587\u6863",
      pptx: "\u6587\u6863",
      pdf: "\u6587\u6863",
      txt: "\u6587\u6863",
      md: "\u6587\u6863",
      rtf: "\u6587\u6863",
      csv: "\u6587\u6863",
      epub: "\u6587\u6863",
      pages: "\u6587\u6863",
      numbers: "\u6587\u6863",
      key: "\u6587\u6863",
      zip: "\u538B\u7F29\u5305",
      rar: "\u538B\u7F29\u5305",
      "7z": "\u538B\u7F29\u5305",
      tar: "\u538B\u7F29\u5305",
      gz: "\u538B\u7F29\u5305",
      bz2: "\u538B\u7F29\u5305",
      xz: "\u538B\u7F29\u5305",
      iso: "\u538B\u7F29\u5305",
      cab: "\u538B\u7F29\u5305",
      zst: "\u538B\u7F29\u5305",
      exe: "\u5B89\u88C5\u5305",
      msi: "\u5B89\u88C5\u5305",
      msix: "\u5B89\u88C5\u5305",
      appx: "\u5B89\u88C5\u5305",
      dmg: "\u5B89\u88C5\u5305",
      js: "\u4EE3\u7801",
      ts: "\u4EE3\u7801",
      jsx: "\u4EE3\u7801",
      tsx: "\u4EE3\u7801",
      py: "\u4EE3\u7801",
      java: "\u4EE3\u7801",
      c: "\u4EE3\u7801",
      h: "\u4EE3\u7801",
      cpp: "\u4EE3\u7801",
      cc: "\u4EE3\u7801",
      hpp: "\u4EE3\u7801",
      cs: "\u4EE3\u7801",
      go: "\u4EE3\u7801",
      rs: "\u4EE3\u7801",
      rb: "\u4EE3\u7801",
      php: "\u4EE3\u7801",
      swift: "\u4EE3\u7801",
      kt: "\u4EE3\u7801",
      scala: "\u4EE3\u7801",
      sh: "\u4EE3\u7801",
      bat: "\u4EE3\u7801",
      ps1: "\u4EE3\u7801",
      sql: "\u4EE3\u7801",
      html: "\u4EE3\u7801",
      css: "\u4EE3\u7801",
      vue: "\u4EE3\u7801",
      json: "\u4EE3\u7801",
      xml: "\u4EE3\u7801",
      yaml: "\u4EE3\u7801",
      yml: "\u4EE3\u7801",
      toml: "\u4EE3\u7801",
      ini: "\u4EE3\u7801",
      cfg: "\u4EE3\u7801",
      log: "\u65E5\u5FD7",
      tmp: "\u4E34\u65F6",
      temp: "\u4E34\u65F6",
      bak: "\u5907\u4EFD",
      dll: "\u7CFB\u7EDF",
      sys: "\u7CFB\u7EDF",
      drv: "\u7CFB\u7EDF",
      mui: "\u7CFB\u7EDF",
      cat: "\u7CFB\u7EDF",
      ocx: "\u7CFB\u7EDF",
      db: "\u6570\u636E\u5E93",
      sqlite: "\u6570\u636E\u5E93",
      sqlite3: "\u6570\u636E\u5E93",
      mdf: "\u6570\u636E\u5E93",
      ldf: "\u6570\u636E\u5E93",
      accdb: "\u6570\u636E\u5E93",
      mdb: "\u6570\u636E\u5E93",
      vhd: "\u865A\u62DF\u78C1\u76D8",
      vhdx: "\u865A\u62DF\u78C1\u76D8",
      vmdk: "\u865A\u62DF\u78C1\u76D8",
      vdi: "\u865A\u62DF\u78C1\u76D8",
      node_modules: "\u4F9D\u8D56\u5305",
      jar: "\u4F9D\u8D56\u5305",
      whl: "\u4F9D\u8D56\u5305",
      gem: "\u4F9D\u8D56\u5305",
      nupkg: "\u4F9D\u8D56\u5305"
    };
    var EXT_JUNK = { dmp: "\u5D29\u6E83\u8F6C\u50A8", mdmp: "\u5D29\u6E83\u8F6C\u50A8", tmp: "\u4E34\u65F6\u6587\u4EF6", temp: "\u4E34\u65F6\u6587\u4EF6" };
    var DIR_CAT_RULES = [
      { segs: ["windows"], cat: "\u7CFB\u7EDF\u76EE\u5F55" },
      { segs: ["windows.old"], cat: "\u65E7\u7CFB\u7EDF" },
      { segs: ["program files", "program files (x86)"], cat: "\u7A0B\u5E8F\u76EE\u5F55" },
      { segs: ["programdata"], cat: "\u5E94\u7528\u6570\u636E" },
      { segs: ["appdata"], cat: "\u5E94\u7528\u6570\u636E" },
      { segs: ["users"], cat: "\u7528\u6237\u6570\u636E" },
      { segs: ["documents", "downloads", "desktop", "pictures", "videos", "music", "onedrive"], cat: "\u7528\u6237\u6570\u636E" },
      { segs: ["node_modules", ".git", "dist", "build", "target", "__pycache__", "venv", ".venv", ".gradle", ".idea", ".vscode"], cat: "\u5F00\u53D1\u5DE5\u7A0B" },
      { segs: ["temp", "tmp", "cache", "caches"], cat: "\u4E34\u65F6/\u7F13\u5B58" },
      { segs: ["$recycle.bin"], cat: "\u56DE\u6536\u7AD9" }
    ];
    var JUNK_RULES = [
      { label: "\u56DE\u6536\u7AD9", match: (s) => s.indexOf("$recycle.bin") >= 0 },
      { label: "\u7528\u6237\u4E34\u65F6\u76EE\u5F55", match: (s) => s.indexOf("appdata") >= 0 && s.indexOf("temp") >= 0 },
      { label: "Windows \u4E34\u65F6", match: (s) => s.indexOf("windows") >= 0 && s.indexOf("temp") >= 0 },
      { label: "Windows \u9884\u8BFB\u53D6", match: (s) => s.indexOf("windows") >= 0 && s.indexOf("prefetch") >= 0 },
      { label: "Windows \u66F4\u65B0\u7F13\u5B58", match: (s) => s.indexOf("windows") >= 0 && s.indexOf("softwaredistribution") >= 0 && s.indexOf("download") >= 0 },
      { label: "\u6D4F\u89C8\u5668\u7F13\u5B58", match: (s) => (s.indexOf("chrome") >= 0 || s.indexOf("msedge") >= 0 || s.indexOf("microsoft edge") >= 0 || s.indexOf("firefox") >= 0 || s.indexOf("chromium") >= 0) && (s.indexOf("cache") >= 0 || s.indexOf("cacheddata") >= 0 || s.indexOf("code cache") >= 0 || s.indexOf("gpucache") >= 0) },
      { label: "\u7F29\u7565\u56FE\u7F13\u5B58", match: (s) => s.indexOf("explorer") >= 0 && (s.indexOf("thumbcache") >= 0 || s.indexOf("thumbnails") >= 0 || s.indexOf("iconcache") >= 0) },
      { label: "Windows.old", match: (s) => s.indexOf("windows.old") >= 0 }
    ];
    var AUTO_SKIP = ["system volume information"];
    var MAX_DEPTH = 64;
    var CONCURRENCY = 64;
    var USER_ZONE_SEGS = ["downloads", "documents", "desktop", "pictures", "videos", "music", "onedrive"];
    var APP_ZONE_SEGS = [
      "steamapps",
      "wegameapps",
      "rail_apps",
      "epic games",
      "gog games",
      "gog galaxy",
      "battle.net",
      "origin games",
      "xboxgames",
      "ubisoft game launcher",
      "blizzard",
      "ubisoft"
    ];
    var LOOSE_MS = 30 * DAYS;
    var LOOSE_MIN = 100 * 1024 * 1024;
    var LOOSE_MAX = 100;
    var DRIVE_ROOT_SKIP = [
      "windows",
      "program files",
      "program files (x86)",
      "programdata",
      "users",
      "$recycle.bin",
      "system volume information",
      "recovery",
      "perflogs",
      "intel",
      "msocache",
      "config.msi",
      "onekey",
      "oneclick",
      "dsh",
      ".dsh",
      "\u6574\u7406\u533A",
      "temp",
      "tmp"
    ];
    var PROG_NAME_HINTS = [
      "steam",
      "wegame",
      "epic",
      "gog",
      "battle.net",
      "origin",
      "xbox",
      "ubisoft",
      "blizzard",
      "razer",
      "logitech",
      "qq",
      "wechat",
      "weixin",
      "\u5FAE\u4FE1",
      "tim",
      "\u9489\u9489",
      "dingtalk",
      "alipay",
      "\u652F\u4ED8\u5B9D",
      "wps",
      "office",
      "vs code",
      "vscode",
      "visual studio",
      "jetbrains",
      "idea",
      "pycharm",
      "goland",
      "webstorm",
      "android",
      "sdk",
      "ndk",
      "nodejs",
      "node",
      "python",
      "anaconda",
      "miniconda",
      "rust",
      "cargo",
      "golang",
      "unity",
      "unreal",
      "ue4",
      "ue5",
      "blender",
      "photoshop",
      "adobe",
      "autocad",
      "cad",
      "chrome",
      "firefox",
      "edge",
      "360",
      "tencent",
      "baidu",
      "alibaba",
      "netease",
      "youdao",
      "obs",
      "bandizip",
      "winrar",
      "7-zip",
      "7zip",
      "vmware",
      "virtualbox",
      "docker",
      "wsl",
      "git",
      "svn",
      "maven",
      "gradle",
      "npm",
      "yarn",
      "pnpm",
      "mysql",
      "postgresql",
      "oracle",
      "mongodb",
      "redis",
      "nginx",
      "tomcat",
      "java",
      "jdk",
      "jre",
      "dotnet",
      "vcredist",
      "directx",
      "vulkan",
      "cuda",
      "nvidia",
      "amd",
      "driver",
      "\u9A71\u52A8",
      "\u6E38\u620F",
      "games",
      "game",
      "lol",
      "\u82F1\u96C4\u8054\u76DF",
      "dota",
      "csgo",
      "cs2",
      "valorant",
      "genshin",
      "\u539F\u795E",
      "mihoyo",
      "miyoho",
      "star rail",
      "\u5D29\u574F",
      "apex",
      "pubg",
      "\u7EDD\u5730\u6C42\u751F",
      "minecraft",
      "\u6211\u7684\u4E16\u754C"
    ];
    var PROG_DIR_HINTS = ["steamapps", "wegameapps", "rail_apps", "bin", "exe", "release", "debug"];
    var PROG_EXT = { exe: 1, dll: 1, msi: 1, msix: 1, appx: 1, sys: 1, bat: 1, cmd: 1 };
    var ORG_CAT_MAP = { "\u5A92\u4F53": "\u5A92\u4F53", "\u56FE\u7247": "\u56FE\u7247", "\u6587\u6863": "\u6587\u6863", "\u5B89\u88C5\u5305": "\u5B89\u88C5\u5305", "\u538B\u7F29\u5305": "\u538B\u7F29\u5305", "\u865A\u62DF\u78C1\u76D8": "\u865A\u62DF\u78C1\u76D8", "\u6570\u636E\u5E93": "\u6570\u636E\u5E93", "\u5907\u4EFD": "\u5907\u4EFD" };
    function low(s) {
      return String(s || "").toLowerCase();
    }
    function isDedupZone(p) {
      const segs = splitSegs(p);
      return segs.some((s) => USER_ZONE_SEGS.indexOf(s) >= 0);
    }
    function isAppZone(segs) {
      return segs.some((s) => APP_ZONE_SEGS.indexOf(s) >= 0);
    }
    function splitSegs(p) {
      return low(p).replace(/^[a-z]:[\\/]/, "").replace(/^[a-z]:/, "").split(/[\\/]+/).filter(Boolean);
    }
    function extOf(name) {
      const i = name.lastIndexOf(".");
      if (i <= 0 || i === name.length - 1) return "";
      return low(name.slice(i + 1));
    }
    function classifyDir(segs) {
      for (const r of DIR_CAT_RULES) for (const s of r.segs) if (segs.indexOf(s) >= 0) return r.cat;
      return "\u5176\u4ED6";
    }
    function junkFor(segs, ext) {
      for (const r of JUNK_RULES) if (r.match(segs)) return r.label;
      return EXT_JUNK[ext] || null;
    }
    var cancelled = false;
    if (!process._dskSigBound) {
      process._dskSigBound = true;
      process.on("SIGTERM", function() {
        cancelled = true;
      });
    }
    var visited = /* @__PURE__ */ new Set();
    var dirMap = /* @__PURE__ */ new Map();
    var stats = {
      files: 0,
      dirs: 0,
      bytes: 0,
      emptyDirs: 0,
      currentPath: "",
      skipped: { permission: 0, cycle: 0, protected: 0, excluded: 0, deep: 0, error: 0 },
      appZoneFiles: 0,
      appZoneBytes: 0
    };
    var results = {
      fileCat: {},
      fileCatCount: {},
      ext: {},
      junk: {},
      junkCount: {},
      topFiles: [],
      emptyDirs: [],
      createdBuckets: {},
      modifiedBuckets: {}
    };
    var bySize = /* @__PURE__ */ new Map();
    var staleFiles = [];
    var dirOld = /* @__PURE__ */ new Map();
    var looseCandidates = [];
    var looseDirs = [];
    var now = Date.now();
    var lastProg = 0;
    function resetState() {
      cancelled = false;
      visited = /* @__PURE__ */ new Set();
      dirMap = /* @__PURE__ */ new Map();
      stats = {
        files: 0,
        dirs: 0,
        bytes: 0,
        emptyDirs: 0,
        currentPath: "",
        skipped: { permission: 0, cycle: 0, protected: 0, excluded: 0, deep: 0, error: 0 },
        appZoneFiles: 0,
        appZoneBytes: 0
      };
      results = {
        fileCat: {},
        fileCatCount: {},
        ext: {},
        junk: {},
        junkCount: {},
        topFiles: [],
        emptyDirs: [],
        createdBuckets: {},
        modifiedBuckets: {}
      };
      bySize = /* @__PURE__ */ new Map();
      staleFiles = [];
      dirOld = /* @__PURE__ */ new Map();
      looseCandidates = [];
      looseDirs = [];
      now = Date.now();
      lastProg = 0;
    }
    function writeProgress() {
      if (!progressFile) return;
      try {
        fs2.writeFileSync(progressFile, JSON.stringify({
          files: stats.files,
          dirs: stats.dirs,
          bytes: stats.bytes,
          emptyDirs: stats.emptyDirs,
          currentPath: stats.currentPath,
          skipped: stats.skipped
        }), "utf8");
      } catch (e) {
      }
    }
    async function walk(dir, segs, depth, inAppZone) {
      if (cancelled) throw new Error("CANCELLED");
      let key;
      try {
        key = await fsp.realpath(dir);
      } catch (e) {
        stats.skipped.permission++;
        return null;
      }
      if (visited.has(key)) {
        stats.skipped.cycle++;
        return null;
      }
      if (depth > MAX_DEPTH) {
        stats.skipped.deep++;
        return null;
      }
      const lp = low(dir);
      for (const ex of excludes) {
        if (lp === ex || lp.indexOf(ex + "\\") === 0) {
          stats.skipped.excluded++;
          return null;
        }
      }
      for (const s of AUTO_SKIP) {
        if (segs.indexOf(s) >= 0) {
          stats.skipped.protected++;
          return null;
        }
      }
      visited.add(key);
      const appZone = inAppZone || isAppZone(segs);
      const thisRoot = low(dir).replace(/[\\/]+$/, "");
      const isDriveRoot = /^[a-z]:$/.test(thisRoot);
      const isUserZoneRoot = !isDriveRoot && segs.indexOf("users") >= 0 && USER_ZONE_SEGS.indexOf(segs[segs.length - 1]) >= 0;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (e) {
        stats.skipped.permission++;
        return null;
      }
      if (entries.length === 0) {
        stats.emptyDirs++;
        if (results.emptyDirs.length < 2e3) results.emptyDirs.push(dir);
      }
      const childDirs = [];
      const fileEntries = [];
      for (const en of entries) {
        if (en.isDirectory() || en.isSymbolicLink()) childDirs.push(en);
        else if (en.isFile()) fileEntries.push(en);
      }
      if (suggestMode && (isDriveRoot || isUserZoneRoot)) {
        for (const en of childDirs) {
          const n = low(en.name);
          if (n.charAt(0) === "$") continue;
          if (isDriveRoot && DRIVE_ROOT_SKIP.indexOf(n) >= 0) continue;
          looseCandidates.push({ path: path2.join(dir, en.name), name: en.name, zone: isDriveRoot ? "drive" : "user" });
        }
      }
      const agg = { bytes: 0, files: 0, dirs: childDirs.length };
      if (fileEntries.length > 0) {
        await pool(fileEntries, async function(en) {
          let st;
          try {
            st = await fsp.stat(path2.join(dir, en.name));
          } catch (e) {
            return;
          }
          const sz = st.size;
          agg.bytes += sz;
          agg.files++;
          stats.files++;
          stats.bytes += sz;
          const ext = extOf(en.name);
          const cat = EXT_CAT[ext] || "\u5176\u4ED6";
          results.fileCat[cat] = (results.fileCat[cat] || 0) + sz;
          results.fileCatCount[cat] = (results.fileCatCount[cat] || 0) + 1;
          const ek = ext === "" ? "(\u65E0\u6269\u5C55\u540D)" : ext;
          results.ext[ek] = (results.ext[ek] || 0) + sz;
          if (appZone) {
            stats.appZoneFiles++;
            stats.appZoneBytes += sz;
          }
          const jl = junkFor(segs, ext);
          if (jl) {
            results.junk[jl] = (results.junk[jl] || 0) + sz;
            results.junkCount[jl] = (results.junkCount[jl] || 0) + 1;
          }
          if (sz > 0) {
            const tf = results.topFiles;
            if (tf.length < 100) {
              tf.push({ path: path2.join(dir, en.name), bytes: sz });
              tf.sort((a, b) => b.bytes - a.bytes);
            } else if (sz > tf[tf.length - 1].bytes) {
              tf[tf.length - 1] = { path: path2.join(dir, en.name), bytes: sz };
              tf.sort((a, b) => b.bytes - a.bytes);
            }
          }
          if (withTime) {
            if (st.birthtime && !isNaN(st.birthtime.getTime())) {
              const y2 = st.birthtime.getFullYear();
              results.createdBuckets[y2] = (results.createdBuckets[y2] || 0) + sz;
            }
            const y = st.mtime.getFullYear();
            results.modifiedBuckets[y] = (results.modifiedBuckets[y] || 0) + sz;
          }
          if (suggestMode && !appZone) {
            if (sz >= DUP_MIN_SIZE && isDedupZone(dir)) {
              const arr = bySize.get(sz);
              if (arr) arr.push({ path: path2.join(dir, en.name), size: sz });
              else bySize.set(sz, [{ path: path2.join(dir, en.name), size: sz }]);
            }
            if (now - st.mtimeMs > STALE_MS && sz > 0) staleFiles.push({ path: path2.join(dir, en.name), size: sz, modified: st.mtime.toISOString().slice(0, 10) });
            if (isDedupZone(dir)) {
              const dob = dirOld.get(dir);
              if (dob) {
                dob.count++;
                if (st.birthtime && !isNaN(st.birthtime.getTime()) && now - st.birthtimeMs > STALE_MS) dob.oldCount++;
              } else {
                dirOld.set(dir, { count: 1, oldCount: st.birthtime && !isNaN(st.birthtime.getTime()) && now - st.birthtimeMs > STALE_MS ? 1 : 0 });
              }
            }
          }
        });
      }
      if (childDirs.length > 0) {
        await pool(childDirs, async function(en) {
          const r = await walk(path2.join(dir, en.name), segs.concat(splitSegs(en.name)).filter(Boolean), depth + 1, appZone);
          if (r) {
            agg.bytes += r.bytes;
            agg.files += r.files;
            agg.dirs += r.dirs;
          }
        });
      }
      dirMap.set(lp, { path: dir, bytes: agg.bytes, files: agg.files, dirs: agg.dirs, cat: classifyDir(segs) });
      stats.dirs++;
      if (Date.now() - lastProg > 250) {
        lastProg = Date.now();
        stats.currentPath = dir;
        writeProgress();
      }
      return agg;
    }
    async function pool(items, fn) {
      let i = 0;
      const workers = [];
      const limit = Math.min(CONCURRENCY, items.length);
      for (let w = 0; w < limit; w++) {
        workers.push((async function() {
          while (i < items.length) {
            const item = items[i++];
            try {
              await fn(item);
            } catch (e) {
              if (e && e.message === "CANCELLED") throw e;
              stats.skipped.error++;
            }
          }
        })());
      }
      await Promise.all(workers);
    }
    function finalize() {
      const extArr = Object.keys(results.ext).map((k) => ({ ext: k, bytes: results.ext[k] }));
      extArr.sort((a, b) => b.bytes - a.bytes);
      const extTop = extArr.slice(0, 30);
      const rest = extArr.slice(30).reduce((a, x) => a + x.bytes, 0);
      if (rest > 0) extTop.push({ ext: "(\u5176\u4ED6)", bytes: rest });
      const category = Object.keys(results.fileCat).map((k) => ({ label: k, bytes: results.fileCat[k], count: results.fileCatCount[k] || 0 }));
      category.sort((a, b) => b.bytes - a.bytes);
      const dirArr = [];
      dirMap.forEach((v) => dirArr.push(v));
      dirArr.sort((a, b) => b.bytes - a.bytes);
      const topDirs = dirArr.slice(0, 50).map((d) => ({ path: d.path, bytes: d.bytes, files: d.files, dirs: d.dirs, cat: d.cat }));
      const junk = Object.keys(results.junk).map((k) => ({ label: k, bytes: results.junk[k], count: results.junkCount[k] || 0 }));
      junk.sort((a, b) => b.bytes - a.bytes);
      const timeBuckets = withTime ? {
        created: results.createdBuckets,
        modified: results.modifiedBuckets
      } : null;
      return {
        summary: {
          roots,
          totalFiles: stats.files,
          totalDirs: dirMap.size,
          totalBytes: stats.bytes,
          emptyDirs: stats.emptyDirs,
          skipped: stats.skipped,
          scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: cancelled ? "cancelled" : "done",
          appZoneFiles: stats.appZoneFiles,
          appZoneBytes: stats.appZoneBytes
        },
        category,
        extTop,
        topDirs,
        topFiles: results.topFiles,
        junk,
        emptyDirSample: results.emptyDirs,
        timeBuckets
      };
    }
    async function hashRange(p, start, len) {
      const fh = await fsp.open(p, "r");
      try {
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, start);
        return crypto.createHash("sha256").update(bytesRead === len ? buf : buf.slice(0, bytesRead)).digest("hex");
      } finally {
        await fh.close().catch(function() {
        });
      }
    }
    async function headHash(p, size) {
      return hashRange(p, 0, Math.min(DUP_HEAD, size));
    }
    async function tailHash(p, size) {
      return hashRange(p, Math.max(0, size - DUP_TAIL), Math.min(DUP_TAIL, size));
    }
    async function fullHash(p) {
      const h = crypto.createHash("sha256");
      const fh = await fsp.open(p, "r");
      try {
        const buf = Buffer.alloc(1 << 20);
        let pos = 0;
        while (true) {
          const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
          if (bytesRead === 0) break;
          h.update(bytesRead === buf.length ? buf : buf.slice(0, bytesRead));
          pos += bytesRead;
        }
        return h.digest("hex");
      } finally {
        await fh.close().catch(function() {
        });
      }
    }
    async function hashGroup(items, step) {
      const map = /* @__PURE__ */ new Map();
      await pool(items, async function(t) {
        let h;
        try {
          if (step === "head") h = await headHash(t.f.path, t.size);
          else if (step === "tail") h = await tailHash(t.f.path, t.size);
          else h = await fullHash(t.f.path);
        } catch (e) {
          return;
        }
        const key = t.size + "|" + h;
        const arr = map.get(key);
        if (arr) arr.push(t.f);
        else map.set(key, [t.f]);
      });
      const out = [];
      for (const files of map.values()) if (files.length >= 2) out.push(files);
      return out;
    }
    async function buildSuggestions(junkArr, emptySample, emptyCount) {
      const s = [];
      const tempLabels = ["\u7528\u6237\u4E34\u65F6\u76EE\u5F55", "Windows \u4E34\u65F6", "Windows \u9884\u8BFB\u53D6", "Windows \u66F4\u65B0\u7F13\u5B58", "\u6D4F\u89C8\u5668\u7F13\u5B58", "\u7F29\u7565\u56FE\u7F13\u5B58"];
      let tempBytes = 0;
      const tempItems = [];
      for (const j of junkArr) {
        if (tempLabels.indexOf(j.label) >= 0) {
          tempBytes += j.bytes;
          tempItems.push({ label: j.label, bytes: j.bytes, count: j.count });
        }
      }
      if (tempBytes > 0) s.push({ type: "junk-temp", title: "\u6E05\u7406\u4E34\u65F6\u4E0E\u7F13\u5B58\u6587\u4EF6", risk: "low", estBytes: tempBytes, items: tempItems, note: "\u4E34\u65F6\u6587\u4EF6/\u6D4F\u89C8\u5668\u7F13\u5B58/\u9884\u8BFB\u53D6\u7B49\uFF0C\u5220\u9664\u540E\u53EF\u91CD\u65B0\u751F\u6210" });
      const rb = junkArr.find((j) => j.label === "\u56DE\u6536\u7AD9");
      if (rb && rb.bytes > 0) s.push({ type: "recycle-bin", title: "\u6E05\u7A7A\u56DE\u6536\u7AD9", risk: "high-irreversible", estBytes: rb.bytes, items: [{ path: rb.label, bytes: rb.bytes, count: rb.count }], note: "\u6C38\u4E45\u5220\u9664\uFF0C\u4E0D\u53EF\u6062\u590D" });
      if (emptyCount > 0) s.push({ type: "empty-dirs", title: "\u5220\u9664\u7A7A\u6587\u4EF6\u5939", risk: "low", estBytes: 0, count: emptyCount, items: emptySample.slice(0, 100).map((p) => ({ path: p })), note: "\u5171 " + emptyCount + " \u4E2A\u7A7A\u6587\u4EF6\u5939" });
      const dupGroups = [];
      const sizeBuckets = [];
      for (const [size, list] of bySize) if (list.length >= 2) sizeBuckets.push({ size, list });
      if (sizeBuckets.length > 0) {
        const headItems = [];
        for (const b of sizeBuckets) for (const f of b.list) headItems.push({ f, size: b.size });
        const headGroups = await hashGroup(headItems, "head");
        const tailItems = [];
        for (const g of headGroups) {
          if (g[0].size <= DUP_HEAD) {
            dupGroups.push(g);
            continue;
          }
          for (const f of g) tailItems.push({ f, size: f.size });
        }
        if (tailItems.length > 0) {
          const tailGroups = await hashGroup(tailItems, "tail");
          const fullItems = [];
          for (const g of tailGroups) {
            if (g[0].size <= DUP_FULL_LIMIT) {
              for (const f of g) fullItems.push({ f, size: f.size });
            } else dupGroups.push(g);
          }
          if (fullItems.length > 0) {
            const fullGroups = await hashGroup(fullItems, "full");
            for (const g of fullGroups) dupGroups.push(g);
          }
        }
      }
      const removable = [];
      let dupBytes = 0;
      for (const g of dupGroups) {
        const userFiles = g.filter((f) => isDedupZone(f.path));
        if (userFiles.length < 2) continue;
        userFiles.sort((a, b) => a.path.length - b.path.length);
        const keep = userFiles[0];
        const dups = userFiles.slice(1);
        dupBytes += dups.reduce((a, f) => a + f.size, 0);
        removable.push({ size: g[0].size, keep: keep.path, removable: dups.map((f) => f.path) });
      }
      if (removable.length > 0) s.push({ type: "duplicates", title: "\u5220\u9664\u91CD\u590D\u6587\u4EF6", risk: "medium", estBytes: dupBytes, groups: removable.slice(0, 50), note: "\u4FDD\u7559\u8DEF\u5F84\u6700\u77ED\u8005\uFF0C\u5176\u4F59\u79FB\u5165\u56DE\u6536\u7AD9\uFF08\u4EC5\u7528\u6237\u533A\uFF09" });
      const staleLarge = staleFiles.filter((f) => f.size >= STALE_LARGE_MIN).sort((a, b) => b.size - a.size);
      if (staleLarge.length > 0) s.push({ type: "stale-large", title: "\u6E05\u7406\u957F\u671F\u672A\u4F7F\u7528\u7684\u5927\u6587\u4EF6", risk: "medium", estBytes: staleLarge.reduce((a, f) => a + f.size, 0), items: staleLarge.slice(0, 50).map((f) => ({ path: f.path, bytes: f.size, modified: f.modified })), note: "\u4FEE\u6539\u65F6\u95F4\u8D85\u8FC7 730 \u5929\u4E14 \u2265 500MB" });
      s.push({ type: "uninstall-orphans", title: "\u5378\u8F7D\u6B8B\u7559\u68C0\u67E5", risk: "high", estBytes: null, note: "\u68C0\u67E5 AppData/ProgramData \u4E2D\u5DF2\u5378\u8F7D\u7A0B\u5E8F\u7684\u6B8B\u7559\u76EE\u5F55\uFF08\u9700\u7ED3\u5408\u6CE8\u518C\u8868\u4EA4\u53C9\u9A8C\u8BC1\uFF0C\u5EFA\u8BAE\u4EBA\u5DE5\u786E\u8BA4\uFF09" });
      const oldDirs = [];
      for (const [dir, rec] of dirOld) {
        if (rec.count < 2 || rec.count > 1e3) continue;
        if (rec.oldCount === rec.count) {
          const agg = dirMap.get(low(dir));
          if (agg && agg.bytes > 0) oldDirs.push({ path: dir, bytes: agg.bytes, files: rec.count });
        }
      }
      oldDirs.sort((a, b) => b.bytes - a.bytes);
      if (oldDirs.length > 0) s.push({ type: "created-old", title: "\u521B\u5EFA\u65F6\u95F4\u4E45\u8FDC\u7684\u5386\u53F2\u76EE\u5F55", risk: "low", estBytes: oldDirs.reduce((a, d) => a + d.bytes, 0), items: oldDirs.slice(0, 50).map((d) => ({ path: d.path, bytes: d.bytes, files: d.files })), note: "\u76EE\u5F55\u5185\u6240\u6709\u6587\u4EF6\u521B\u5EFA\u65F6\u95F4\u8D85\u8FC7 730 \u5929\uFF0C\u53EF\u80FD\u662F\u5386\u53F2\u9057\u7559" });
      if (looseDirs.length > 0) {
        const loose = looseDirs.filter((d) => d.kind === "loose");
        const prog = looseDirs.filter((d) => d.kind === "program");
        const items = [];
        for (const d of loose.slice(0, 50)) items.push({ path: d.path, bytes: d.bytes, modified: d.modified, kind: "loose", cat: d.cat, suggestDst: suggestDstOf(d) });
        for (const d of prog.slice(0, 50)) items.push({ path: d.path, bytes: d.bytes, modified: d.modified, kind: "program", warn: "\u79FB\u52A8\u5C06\u5BFC\u81F4\u5FEB\u6377\u65B9\u5F0F\u5931\u6548\uFF1B\u5982\u9700\u79FB\u52A8\u8BF7\u4F7F\u7528 fixShortcuts \u81EA\u52A8\u91CD\u5199\u684C\u9762/\u5F00\u59CB\u83DC\u5355/\u4EFB\u52A1\u680F\u5FEB\u6377\u65B9\u5F0F" });
        s.push({ type: "organize-folders", title: "\u76EE\u5F55\u6574\u7406\u5EFA\u8BAE", risk: "low", estBytes: loose.reduce((a, d) => a + d.bytes, 0), items, note: "\u6563\u843D\u76EE\u5F55\u68C0\u6D4B\uFF08\u4FEE\u6539 >30 \u5929 \u4E14 \u2265100MB\uFF09\uFF1Aloose \u7C7B\u53EF\u5F52\u5165 <\u76D8>:\\\u6574\u7406\u533A\\<\u5206\u7C7B>\\\uFF1Bprogram \u7C7B\u4E3A\u7A0B\u5E8F/\u6E38\u620F\u76EE\u5F55\u4EC5\u63D0\u793A\uFF08\u79FB\u52A8\u4F1A\u7834\u574F\u5B89\u88C5\uFF09\uFF0C\u53EF\u914D\u5408 fixShortcuts \u79FB\u52A8\u5E76\u81EA\u52A8\u91CD\u5199\u5FEB\u6377\u65B9\u5F0F\u3002\u53EF\u7528 disk_organize plan \u751F\u6210\u6574\u7406\u8BA1\u5212" });
      }
      s.sort((a, b) => (b.estBytes || 0) - (a.estBytes || 0));
      return s;
    }
    function suggestDstOf(d) {
      const m = d.path.match(/^([A-Za-z]):/);
      const drv = m ? m[1].toUpperCase() : "C";
      const name = d.path.split(/[\\/]+/).filter(Boolean).pop() || "\u672A\u547D\u540D";
      return drv + ":\\\u6574\u7406\u533A\\" + d.cat + "\\" + name;
    }
    async function analyzeLooseDirs() {
      if (looseCandidates.length === 0) return;
      const seen = /* @__PURE__ */ new Set();
      const uniq = [];
      for (const c of looseCandidates) {
        const k = low(c.path);
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(c);
      }
      await pool(uniq, async function(c) {
        let st;
        try {
          st = await fsp.stat(c.path);
        } catch (e) {
          return;
        }
        const agg = dirMap.get(low(c.path));
        const bytes = agg && agg.bytes ? agg.bytes : 0;
        const mtimeMs = st.mtimeMs || 0;
        if (bytes < LOOSE_MIN) return;
        if (now - mtimeMs < LOOSE_MS) return;
        let exeCount = 0, dirHits = 0;
        const catCount = {};
        try {
          const en = await fsp.readdir(c.path, { withFileTypes: true });
          for (const e of en) {
            if (e.isFile()) {
              const ext = extOf(e.name);
              if (PROG_EXT[ext]) exeCount++;
              const c2 = EXT_CAT[ext] || "\u5176\u4ED6";
              catCount[c2] = (catCount[c2] || 0) + 1;
            } else if (e.isDirectory() && PROG_DIR_HINTS.indexOf(low(e.name)) >= 0) {
              dirHits++;
            }
          }
        } catch (e) {
        }
        const n = low(c.name);
        const nameHint = c.zone === "drive" && PROG_NAME_HINTS.some(function(h) {
          return h.length >= 4 && n.indexOf(h) >= 0 || n.split(/[^a-z0-9\u4e00-\u9fa5]+/).indexOf(h) >= 0;
        });
        const kind = exeCount >= 3 || dirHits > 0 || nameHint ? "program" : "loose";
        let cat = "\u5176\u4ED6", best = 0;
        for (const k2 of Object.keys(catCount)) if (catCount[k2] > best) {
          best = catCount[k2];
          cat = k2;
        }
        cat = ORG_CAT_MAP[cat] || "\u5176\u4ED6";
        looseDirs.push({ path: c.path, bytes, modified: new Date(mtimeMs).toISOString().slice(0, 10), kind, cat });
      });
      looseDirs.sort(function(a, b) {
        return b.bytes - a.bytes;
      });
    }
    function fmtBytesMD(n) {
      if (!n || n < 0) return "0 B";
      const u = ["B", "KB", "MB", "GB", "TB"];
      let v = n, k = 0;
      while (v >= 1024 && k < u.length - 1) {
        v /= 1024;
        k++;
      }
      return v.toFixed(v >= 100 ? 0 : 1) + " " + u[k];
    }
    function mdBar(ratio, width) {
      const w = Math.max(0, Math.min(width, Math.round(ratio * width)));
      return "\u2588".repeat(w) + "\u2591".repeat(width - w);
    }
    function buildMarkdown2(out, elapsedMs) {
      const sm = out.summary || {};
      const L = [];
      L.push("# \u78C1\u76D8\u626B\u63CF\u62A5\u544A");
      L.push("");
      L.push("> \u751F\u6210\u65F6\u95F4\uFF1A" + (sm.scannedAt || "\u2014") + " \uFF5C \u8017\u65F6\uFF1A" + (elapsedMs ? (elapsedMs / 1e3).toFixed(1) + " \u79D2" : "\u2014") + " \uFF5C \u72B6\u6001\uFF1A" + (sm.status || "\u2014"));
      L.push("");
      L.push("## \u6982\u89C8");
      L.push("");
      L.push("| \u9879\u76EE | \u6570\u503C |");
      L.push("|---|---|");
      L.push("| \u626B\u63CF\u8303\u56F4 | " + ((sm.roots || []).join("\u3001") || "\u2014") + " |");
      L.push("| \u603B\u5927\u5C0F | " + fmtBytesMD(sm.totalBytes || 0) + " |");
      L.push("| \u6587\u4EF6\u6570 | " + (sm.totalFiles || 0) + " |");
      L.push("| \u76EE\u5F55\u6570 | " + (sm.totalDirs || 0) + " |");
      L.push("| \u7A7A\u76EE\u5F55 | " + (sm.emptyDirs || 0) + " |");
      L.push("| \u5E94\u7528/\u6E38\u620F\u5E93 | " + fmtBytesMD(sm.appZoneBytes || 0) + "\uFF08" + (sm.appZoneFiles || 0) + " \u4E2A\u6587\u4EF6\uFF0C\u4EC5\u7EDF\u8BA1\u4E0D\u6DF1\u5EA6\u5206\u6790\uFF09 |");
      const sk = sm.skipped || {};
      const skKeys = Object.keys(sk).filter((k2) => sk[k2]);
      if (skKeys.length > 0) L.push("| \u8DF3\u8FC7 | " + skKeys.map((k2) => k2 + ":" + sk[k2]).join("\uFF0C") + " |");
      L.push("");
      const cat = (out.category || []).slice(0, 15);
      const catRest = (out.category || []).slice(15).reduce((a, c) => a + (c.bytes || 0), 0);
      if (cat.length > 0) {
        L.push("## \u7C7B\u522B\u7EDF\u8BA1");
        L.push("");
        L.push("| \u7C7B\u522B | \u6587\u4EF6\u6570 | \u5927\u5C0F | \u5360\u6BD4 |");
        L.push("|---|---|---|---|");
        const total = sm.totalBytes || 1;
        for (const c of cat) {
          const pct = c.bytes / total;
          L.push("| " + c.label + " | " + (c.count || 0) + " | " + fmtBytesMD(c.bytes) + " | " + mdBar(pct, 12) + " " + (pct * 100).toFixed(1) + "% |");
        }
        if (catRest > 0) L.push("| \u5176\u4ED6\u7C7B\u522B | \u2014 | " + fmtBytesMD(catRest) + " | \u2014 |");
        L.push("");
      }
      const tf = (out.topFiles || []).slice(0, 10);
      if (tf.length > 0) {
        L.push("## \u5927\u6587\u4EF6 Top 10");
        L.push("");
        L.push("| # | \u6587\u4EF6 | \u5927\u5C0F |");
        L.push("|---|---|---|");
        tf.forEach((f, i) => L.push("| " + (i + 1) + " | `" + f.path + "` | " + fmtBytesMD(f.bytes) + " |"));
        L.push("");
      }
      const td = (out.topDirs || []).slice(0, 10);
      if (td.length > 0) {
        L.push("## \u5927\u76EE\u5F55 Top 10");
        L.push("");
        L.push("| # | \u76EE\u5F55 | \u5927\u5C0F | \u6587\u4EF6 |");
        L.push("|---|---|---|---|");
        td.forEach((d, i) => L.push("| " + (i + 1) + " | `" + d.path + "` | " + fmtBytesMD(d.bytes) + " | " + (d.files || 0) + " |"));
        L.push("");
      }
      const sugg = out.suggestions || [];
      if (sugg.length > 0) {
        L.push("## \u667A\u80FD\u5EFA\u8BAE\uFF08" + sugg.length + " \u7C7B\uFF09");
        L.push("");
        sugg.forEach((s, i) => {
          L.push("### " + (i + 1) + ". " + (s.title || s.type) + (s.risk ? "\uFF08\u98CE\u9669\uFF1A" + s.risk + "\uFF09" : ""));
          if (s.note) L.push("");
          if (s.note) L.push(s.note);
          if (s.estBytes != null) {
            L.push("");
            L.push("- \u6D89\u53CA\u5927\u5C0F\uFF1A" + fmtBytesMD(s.estBytes));
          }
          if (s.type === "organize-folders" && Array.isArray(s.items) && s.items.length > 0) {
            L.push("");
            L.push("| \u76EE\u5F55 | \u5927\u5C0F | \u4FEE\u6539\u65E5\u671F | \u7C7B\u578B | \u53BB\u5411/\u63D0\u793A |");
            L.push("|---|---|---|---|---|");
            for (const it of s.items) {
              const kind = it.kind === "program" ? "\u26A0 \u7A0B\u5E8F\u76EE\u5F55" : "\u2705 \u53EF\u6574\u7406";
              const dst = it.kind === "program" ? it.warn || "\u4EC5\u63D0\u793A\uFF0C\u4E0D\u79FB\u52A8" : "\u2192 `" + (it.suggestDst || "") + "`";
              L.push("| `" + it.path + "` | " + fmtBytesMD(it.bytes) + " | " + (it.modified || "\u2014") + " | " + kind + " | " + dst + " |");
            }
          } else if (s.type === "duplicates" && Array.isArray(s.groups) && s.groups.length > 0) {
            L.push("");
            L.push("| \u4FDD\u7559 | \u53EF\u5220\u9664\u6570 | \u6BCF\u7EC4\u5927\u5C0F |");
            L.push("|---|---|---|");
            for (const g of s.groups.slice(0, 10)) {
              L.push("| `" + g.keep + "` | " + (g.removable ? g.removable.length : 0) + " \u4E2A | " + fmtBytesMD(g.size) + " |");
            }
          } else if (Array.isArray(s.items) && s.items.length > 0 && s.items[0].path !== void 0) {
            L.push("");
            L.push("| \u8DEF\u5F84 | \u5927\u5C0F |");
            L.push("|---|---|");
            for (const it of s.items.slice(0, 20)) {
              L.push("| `" + it.path + "` | " + (it.bytes != null ? fmtBytesMD(it.bytes) : "\u2014") + " |");
            }
          } else if (Array.isArray(s.items) && s.items.length > 0 && s.items[0].label !== void 0) {
            L.push("");
            L.push("| \u9879\u76EE | \u5927\u5C0F |");
            L.push("|---|---|");
            for (const it of s.items.slice(0, 20)) {
              L.push("| " + it.label + " | " + fmtBytesMD(it.bytes) + " |");
            }
          }
          L.push("");
        });
      }
      L.push("---");
      L.push("*\u7531\u78C1\u76D8\u5206\u6790\u52A9\u624B\u751F\u6210\u3002\u5B8C\u6574 JSON \u5EFA\u8BAE\u660E\u7EC6\u89C1\u540C\u76EE\u5F55 .json \u62A5\u544A\u6587\u4EF6\u3002*");
      return L.join("\n");
    }
    var LNK_ROOTS = (function() {
      const out = [];
      const env = process.env;
      if (env.USERPROFILE) out.push(env.USERPROFILE + "\\Desktop");
      if (env.PUBLIC) out.push(env.PUBLIC + "\\Desktop");
      if (env.APPDATA) out.push(env.APPDATA + "\\Microsoft\\Windows\\Start Menu\\Programs");
      if (env.ProgramData) out.push(env.ProgramData + "\\Microsoft\\Windows\\Start Menu\\Programs");
      if (env.APPDATA) out.push(env.APPDATA + "\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar");
      return out.filter(Boolean);
    })();
    function collectLnkFiles() {
      const out = [];
      for (const root of LNK_ROOTS) {
        const stack = [root];
        while (stack.length > 0 && out.length < 4e3) {
          const d = stack.pop();
          let en;
          try {
            en = fs2.readdirSync(d, { withFileTypes: true });
          } catch (e) {
            continue;
          }
          for (const e of en) {
            const p = path2.join(d, e.name);
            if (e.isDirectory()) {
              stack.push(p);
            } else if (e.isFile() && low(e.name).endsWith(".lnk")) out.push(p);
          }
        }
      }
      return out;
    }
    function psB64(script) {
      return Buffer.from(script, "utf16le").toString("base64");
    }
    function escPSStr(s) {
      return String(s).replace(/'/g, "''");
    }
    function runPS(script) {
      const cp = require("child_process");
      return cp.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", psB64(script)], { encoding: "utf8", maxBuffer: 16 << 20, windowsHide: true }) || "";
    }
    function psDataFile(obj) {
      const os2 = require("os");
      const tmpFile = path2.join(os2.tmpdir(), "dsk-psdata-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".json");
      fs2.writeFileSync(tmpFile, JSON.stringify(obj), "utf8");
      return tmpFile;
    }
    async function fixShortcuts(pairs) {
      const lnks = collectLnkFiles();
      if (lnks.length === 0) return { ok: true, scanned: 0, fixed: [] };
      const tmpFile = psDataFile({ pairs, lnks });
      const resFile = tmpFile + ".out.json";
      const script = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        "$sh = New-Object -ComObject WScript.Shell",
        "$data = Get-Content -Raw -Encoding UTF8 -LiteralPath '" + escPSStr(tmpFile) + "' | ConvertFrom-Json",
        "$fixed = @()",
        "foreach ($lnk in $data.lnks) {",
        "  try {",
        "    $s = $sh.CreateShortcut($lnk)",
        "    $t = [string]$s.TargetPath",
        "    if (-not $t) { continue }",
        "    $t2 = [Environment]::ExpandEnvironmentVariables($t)",
        "    $newTarget = $t2",
        "    $hit = $false",
        "    foreach ($p in $data.pairs) {",
        "      $src = [string]$p.src",
        "      if ($src -and $t2.Length -ge $src.Length -and $t2.Substring(0, $src.Length) -eq $src -and ($t2.Length -eq $src.Length -or $t2.Substring($src.Length, 1) -eq '\\')) {",
        "        $newTarget = ([string]$p.dst).TrimEnd('\\') + $t2.Substring($src.Length)",
        "        $s.TargetPath = $newTarget",
        "        $s.Save()",
        "        $hit = $true",
        "        break",
        "      }",
        "    }",
        "    if ($hit) { $fixed += [pscustomobject]@{ lnk = $lnk; oldTarget = $t; newTarget = $newTarget; oldArgs = [string]$s.Arguments; oldWorkDir = [string]$s.WorkingDirectory; oldIcon = [string]$s.IconLocation } }",
        "  } catch { }",
        "}",
        "$json = $fixed | ConvertTo-Json -Compress -Depth 4",
        "$null = [System.IO.File]::WriteAllText('" + escPSStr(resFile) + "', $json, (New-Object System.Text.UTF8Encoding($false)))"
      ].join("\n");
      try {
        runPS(script);
        let fixed = [];
        try {
          const raw = fs2.readFileSync(resFile, "utf8").trim();
          if (raw) {
            fixed = JSON.parse(raw);
            if (!Array.isArray(fixed)) fixed = fixed ? [fixed] : [];
          }
        } catch (e) {
          fixed = [];
        }
        return { ok: true, scanned: lnks.length, fixed };
      } catch (e) {
        return { ok: false, error: "\u5FEB\u6377\u65B9\u5F0F\u4FEE\u590D\u5931\u8D25\uFF1A" + (e && e.message ? e.message : String(e)), scanned: lnks.length, fixed: [] };
      } finally {
        try {
          fs2.unlinkSync(tmpFile);
        } catch (e) {
        }
        try {
          fs2.unlinkSync(resFile);
        } catch (e) {
        }
      }
    }
    async function restoreShortcuts(fixes) {
      if (!fixes || fixes.length === 0) return { ok: true, restored: 0 };
      const tmpFile = psDataFile(fixes);
      const script = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        "$sh = New-Object -ComObject WScript.Shell",
        "$fixes = Get-Content -Raw -Encoding UTF8 -LiteralPath '" + escPSStr(tmpFile) + "' | ConvertFrom-Json",
        "$ok = 0",
        "foreach ($f in $fixes) {",
        "  try {",
        "    $s = $sh.CreateShortcut([string]$f.lnk)",
        "    if ($f.oldTarget) { $s.TargetPath = [string]$f.oldTarget }",
        "    $s.Arguments = if ($f.oldArgs) { [string]$f.oldArgs } else { '' }",
        "    if ($f.oldWorkDir) { $s.WorkingDirectory = [string]$f.oldWorkDir }",
        "    if ($f.oldIcon) { $s.IconLocation = [string]$f.oldIcon }",
        "    $s.Save()",
        "    $ok++",
        "  } catch { }",
        "}",
        "Write-Output ('RESTORED ' + $ok)"
      ].join("\n");
      try {
        const out = runPS(script);
        const m = out.match(/RESTORED\s+(\d+)/);
        return { ok: true, restored: m ? Number(m[1]) : 0 };
      } catch (e) {
        return { ok: false, error: "\u5FEB\u6377\u65B9\u5F0F\u6062\u590D\u5931\u8D25\uFF1A" + (e && e.message ? e.message : String(e)) };
      } finally {
        try {
          fs2.unlinkSync(tmpFile);
        } catch (e) {
        }
      }
    }
    async function main2() {
      resetState();
      roots = (opt("--roots", "") || "").split(";").filter(Boolean);
      excludes = (opt("--exclude", "") || "").split(";").map((s) => s && s.toLowerCase()).filter(Boolean);
      progressFile = opt("--progress", "") || "";
      reportFile = opt("--report", "") || "";
      withTime = args.indexOf("--time") >= 0;
      suggestMode = args.indexOf("--suggest") >= 0;
      const t0 = Date.now();
      const modeDir = opt("--dir", "");
      const modeOrganize = args.indexOf("--organize") >= 0;
      if (modeOrganize) {
        const planFile = opt("--plan", "");
        const mapFile = opt("--map", "");
        if (!planFile || !mapFile) return { exitCode: 1, error: "\u7F3A\u5C11 --plan/--map \u53C2\u6570" };
        let plan;
        try {
          plan = JSON.parse(fs2.readFileSync(planFile, "utf8"));
        } catch (e) {
          return { exitCode: 1, error: "\u65E0\u6CD5\u8BFB\u53D6\u6574\u7406\u8BA1\u5212: " + (e.message || e) };
        }
        if (!Array.isArray(plan) || plan.length === 0) return { exitCode: 1, error: "\u6574\u7406\u8BA1\u5212\u4E3A\u7A7A" };
        const DANGER = ["\\windows\\", "\\program files\\", "\\program files (x86)\\", "\\programdata\\", "\\winsxs\\", "\\system volume information\\", "\\$recycle.bin\\"];
        const moved = [], failed = [];
        async function existsP(p) {
          try {
            await fsp.access(p);
            return true;
          } catch (e) {
            return false;
          }
        }
        async function ensureParent(dst) {
          const parent = path2.dirname(dst);
          try {
            const s = await fsp.stat(parent);
            if (s.isDirectory()) return;
          } catch (e) {
          }
          await fsp.mkdir(parent, { recursive: true });
        }
        async function movePath(src, dst, st) {
          const sameRoot = path2.parse(src).root.toLowerCase() === path2.parse(dst).root.toLowerCase();
          for (let attempt = 1; attempt <= 4; attempt++) {
            try {
              if (sameRoot) {
                try {
                  await fsp.rename(src, dst);
                } catch (e1) {
                  if (await existsP(dst)) throw e1;
                  if (st.isDirectory()) {
                    await fsp.cp(src, dst, { recursive: true });
                    await fsp.rm(src, { recursive: true });
                  } else {
                    await fsp.copyFile(src, dst, fs2.constants.COPYFILE_EXCL);
                    await fsp.unlink(src);
                  }
                }
              } else if (st.isDirectory()) {
                await fsp.cp(src, dst, { recursive: true });
                await fsp.rm(src, { recursive: true });
              } else {
                await fsp.copyFile(src, dst, fs2.constants.COPYFILE_EXCL);
                await fsp.unlink(src);
              }
              return;
            } catch (e) {
              if (attempt >= 4) throw e;
              await new Promise(function(r) {
                setTimeout(r, 2e3 * attempt);
              });
            }
          }
        }
        for (const item of plan) {
          const src = item && item.src, dst = item && item.dst;
          if (!src || !dst || src === dst) {
            failed.push({ src, dst, reason: "\u65E0\u6548\u8DEF\u5F84" });
            continue;
          }
          const dl = String(dst).toLowerCase();
          const sl = String(src).toLowerCase();
          if (DANGER.some((p) => dl.indexOf(p) >= 0 || sl.indexOf(p) >= 0)) {
            failed.push({ src, dst, reason: "\u6D89\u53CA\u7CFB\u7EDF\u76EE\u5F55" });
            continue;
          }
          try {
            await fsp.access(src);
            if (await existsP(dst)) {
              failed.push({ src, dst, reason: "\u76EE\u6807\u5DF2\u5B58\u5728" });
              continue;
            }
            await ensureParent(dst);
            const st = await fsp.stat(src);
            await movePath(src, dst, st);
            moved.push({ src, dst });
          } catch (e) {
            failed.push({ src, dst, reason: e && e.code || e && e.message || String(e) });
          }
        }
        let map = [];
        try {
          map = JSON.parse(fs2.readFileSync(mapFile, "utf8"));
          if (!Array.isArray(map)) map = [];
        } catch (e) {
          map = [];
        }
        if (moved.length > 0) {
          map.push({ ts: (/* @__PURE__ */ new Date()).toISOString(), items: moved });
          try {
            fs2.writeFileSync(mapFile, JSON.stringify(map, null, 2), "utf8");
          } catch (e) {
          }
        }
        return { exitCode: 0, data: { ok: true, movedCount: moved.length, failedCount: failed.length, moved: moved.slice(0, 200), failed: failed.slice(0, 50), mapFile } };
      }
      const fixFile = opt("--fix-shortcuts", "");
      if (fixFile) {
        let pairs;
        try {
          pairs = JSON.parse(fs2.readFileSync(fixFile, "utf8"));
        } catch (e) {
          return { exitCode: 1, error: "\u65E0\u6CD5\u8BFB\u53D6\u5FEB\u6377\u65B9\u5F0F\u4FEE\u590D\u6E05\u5355: " + (e.message || e) };
        }
        if (!Array.isArray(pairs) || pairs.length === 0) return { exitCode: 0, data: { ok: true, scanned: 0, fixed: [], note: "\u65E0\u4FEE\u590D\u9879" } };
        const r = await fixShortcuts(pairs);
        const mapFile2 = opt("--map", "");
        if (mapFile2 && Array.isArray(r.fixed) && r.fixed.length > 0) {
          try {
            let map = [];
            try {
              map = JSON.parse(fs2.readFileSync(mapFile2, "utf8"));
              if (!Array.isArray(map)) map = [];
            } catch (e) {
              map = [];
            }
            if (map.length > 0) {
              const last = map[map.length - 1];
              if (!last.shortcuts) last.shortcuts = [];
              last.shortcuts = last.shortcuts.concat(r.fixed);
              fs2.writeFileSync(mapFile2, JSON.stringify(map, null, 2), "utf8");
            }
          } catch (e) {
          }
        }
        return { exitCode: 0, data: r };
      }
      const restoreFile = opt("--restore-shortcuts", "");
      if (restoreFile) {
        let fixes;
        try {
          fixes = JSON.parse(fs2.readFileSync(restoreFile, "utf8"));
        } catch (e) {
          return { exitCode: 1, error: "\u65E0\u6CD5\u8BFB\u53D6\u6062\u590D\u6E05\u5355: " + (e.message || e) };
        }
        const r = await restoreShortcuts(Array.isArray(fixes) ? fixes : []);
        return { exitCode: 0, data: r };
      }
      if (modeDir) {
        await walk(modeDir, splitSegs(modeDir), 0, false);
        const base = low(modeDir).replace(/[\\/]+$/, "");
        const prefix = base + "\\";
        const direct = [];
        dirMap.forEach(function(v, k) {
          if (k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf("\\") < 0) direct.push({ name: v.path.slice(v.path.lastIndexOf("\\") + 1), bytes: v.bytes, files: v.files, dirs: v.dirs, cat: v.cat });
        });
        direct.sort((a, b) => b.bytes - a.bytes);
        let fileEntries = [];
        try {
          const en = await fsp.readdir(modeDir, { withFileTypes: true });
          for (const e of en) {
            if (e.isFile()) {
              let st;
              try {
                st = await fsp.stat(path2.join(modeDir, e.name));
              } catch (err) {
                continue;
              }
              fileEntries.push({ name: e.name, bytes: st.size });
            }
          }
        } catch (e) {
        }
        fileEntries.sort((a, b) => b.bytes - a.bytes);
        return { exitCode: 0, data: { ok: true, path: modeDir, dirs: direct.slice(0, 200), files: fileEntries.slice(0, 200) } };
      }
      for (const r of roots) {
        const segs = splitSegs(r);
        await walk(r, segs, 0, false);
      }
      const out = finalize();
      out.elapsedMs = Date.now() - t0;
      if (suggestMode) {
        try {
          await analyzeLooseDirs();
          out.suggestions = await buildSuggestions(out.junk, out.emptyDirSample, out.summary.emptyDirs);
          out.organizeCandidates = looseDirs.filter((d) => d.kind === "loose").slice(0, LOOSE_MAX).map((d) => ({ path: d.path, bytes: d.bytes, modified: d.modified, cat: d.cat, suggestDst: suggestDstOf(d) }));
        } catch (e) {
          out.suggestions = [];
          out.suggestError = e && e.message ? e.message : String(e);
        }
      }
      if (progressFile) {
        try {
          fs2.writeFileSync(progressFile, JSON.stringify({ done: true, files: stats.files, dirs: stats.dirs, bytes: stats.bytes }), "utf8");
        } catch (e) {
        }
      }
      if (reportFile) {
        try {
          fs2.writeFileSync(reportFile, JSON.stringify(out), "utf8");
        } catch (e) {
          out.reportWriteError = e && e.message ? e.message : String(e);
        }
        try {
          const md = buildMarkdown2(out, out.elapsedMs || 0);
          const mdFile = reportFile.replace(/\.json$/i, "") + ".md";
          fs2.writeFileSync(mdFile, md, "utf8");
          out.mdFile = mdFile;
        } catch (e) {
          out.mdError = e && e.message ? e.message : String(e);
        }
      }
      const compact = {
        ok: true,
        reportFile: reportFile || null,
        mdFile: out.mdFile || null,
        summary: out.summary,
        category: (out.category || []).slice(0, 20),
        extTop: (out.extTop || []).slice(0, 20),
        topDirs: (out.topDirs || []).slice(0, 30),
        topFiles: (out.topFiles || []).slice(0, 30),
        junk: (out.junk || []).slice(0, 20),
        emptyDirSample: (out.emptyDirSample || []).slice(0, 100),
        timeBuckets: out.timeBuckets || null,
        suggestions: out.suggestions || [],
        elapsedMs: out.elapsedMs,
        suggestError: out.suggestError || null,
        appZoneFiles: stats.appZoneFiles,
        appZoneBytes: stats.appZoneBytes,
        organizeCounts: { loose: looseDirs.filter((d) => d.kind === "loose").length, program: looseDirs.filter((d) => d.kind === "program").length }
      };
      return { exitCode: cancelled ? 3 : 0, data: compact };
    }
    async function run2(argv) {
      args = argv || process.argv.slice(2);
      return main2();
    }
    module2.exports = { run: run2, main: main2, buildMarkdown: buildMarkdown2, analyzeLooseDirs };
    if (require.main === module2) {
      run2(process.argv.slice(2)).then((res) => {
        if (res && res.error) {
          process.stdout.write("\n" + JSON.stringify({ ok: false, error: res.error }));
        } else {
          process.stdout.write("\n" + JSON.stringify(res.data));
        }
        process.exit(res && res.exitCode ? res.exitCode : 0);
      }).catch((e) => {
        process.stderr.write("HELPER_ERROR: " + (e && e.stack ? e.stack : String(e)));
        process.exit(2);
      });
    }
  }
});

// lib/audit.js
var require_audit = __commonJS({
  "lib/audit.js"(exports2, module2) {
    "use strict";
    var fs2 = require("fs");
    var path2 = require("path");
    var os2 = require("os");
    function dskDir() {
      const d = path2.join(os2.homedir(), ".disk-clean");
      try {
        fs2.mkdirSync(d, { recursive: true });
      } catch (e) {
      }
      return d;
    }
    function auditFile() {
      return path2.join(dskDir(), "audit.jsonl");
    }
    function mapFile() {
      return path2.join(dskDir(), "organize-map.json");
    }
    function reportFile() {
      return path2.join(dskDir(), "report.json");
    }
    function mdFile() {
      return path2.join(dskDir(), "report.md");
    }
    function fixFile() {
      return path2.join(dskDir(), "fix-shortcuts.json");
    }
    function restoreFile() {
      return path2.join(dskDir(), "restore-shortcuts.json");
    }
    function planFile() {
      return path2.join(dskDir(), "organize-plan.json");
    }
    function appendAudit(entry) {
      try {
        fs2.appendFileSync(auditFile(), JSON.stringify(entry) + "\n", "utf8");
      } catch (e) {
      }
    }
    function readAudit() {
      try {
        const raw = fs2.readFileSync(auditFile(), "utf8");
        const lines = raw.split("\n").filter(Boolean);
        return lines.map(function(l) {
          try {
            return JSON.parse(l);
          } catch (e) {
            return null;
          }
        }).filter(Boolean);
      } catch (e) {
        return [];
      }
    }
    function readJson(p) {
      try {
        let raw = fs2.readFileSync(p, "utf8");
        if (raw.charCodeAt(0) === 65279) raw = raw.slice(1);
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
    function writeJson(p, v) {
      try {
        fs2.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
        return true;
      } catch (e) {
        return false;
      }
    }
    module2.exports = {
      dskDir,
      auditFile,
      mapFile,
      reportFile,
      mdFile,
      fixFile,
      restoreFile,
      planFile,
      appendAudit,
      readAudit,
      readJson,
      writeJson
    };
  }
});

// lib/organize.js
var require_organize = __commonJS({
  "lib/organize.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var { run: run2 } = require_engine();
    var { mapFile, fixFile, restoreFile, appendAudit, readJson, writeJson } = require_audit();
    var BS = "\\";
    var SYS_PREFIX = ["\\windows\\", "\\program files\\", "\\program files (x86)\\", "\\programdata\\", "\\winsxs\\", "\\system volume information\\", "\\$recycle.bin\\"];
    var ORG_CAT = { "\u5A92\u4F53": "\u5A92\u4F53", "\u56FE\u7247": "\u56FE\u7247", "\u6587\u6863": "\u6587\u6863", "\u5B89\u88C5\u5305": "\u5B89\u88C5\u5305", "\u538B\u7F29\u5305": "\u538B\u7F29\u5305", "\u865A\u62DF\u78C1\u76D8": "\u865A\u62DF\u78C1\u76D8", "\u6570\u636E\u5E93": "\u6570\u636E\u5E93", "\u5907\u4EFD": "\u5907\u4EFD" };
    function low(s) {
      return String(s || "").toLowerCase();
    }
    function fmtBytes2(n) {
      if (!n || n < 0) return "0 B";
      const u = ["B", "KB", "MB", "GB", "TB"];
      let v = n, k = 0;
      while (v >= 1024 && k < u.length - 1) {
        v /= 1024;
        k++;
      }
      return v.toFixed(v >= 100 ? 0 : 1) + " " + u[k];
    }
    function inScanRoots(lp, roots) {
      return roots.some(function(r) {
        return lp.indexOf(low(r)) === 0;
      });
    }
    function isSafeZone(lp) {
      return SYS_PREFIX.every(function(pre) {
        return lp.indexOf(pre) < 0;
      });
    }
    async function plan(opts) {
      const reportFile = opts && opts.reportFile || require_audit().reportFile();
      const rep = readJson(reportFile);
      if (!rep) return { ok: false, error: "\u672A\u627E\u5230\u626B\u63CF\u62A5\u544A\uFF1A" + reportFile + "\uFF08\u8BF7\u5148\u8FD0\u884C scan\uFF09" };
      const includeProgram = !!(opts && opts.includeProgram);
      const plan2 = [];
      const seenDst = {};
      let dirCount = 0;
      const cands = rep && Array.isArray(rep.organizeCandidates) ? rep.organizeCandidates : [];
      for (const c of cands) {
        const m = low(c.path || "").match(/^([a-z]):/);
        const driveLetter = m ? m[1].toUpperCase() : "C";
        const name = (c.path || "").split(/[\\/]+/).filter(Boolean).pop() || "\u672A\u547D\u540D";
        const cat = ORG_CAT[c.cat] ? c.cat : "\u5176\u4ED6";
        const dst = driveLetter + ":" + BS + "\u6574\u7406\u533A" + BS + cat + BS + name;
        if (seenDst[low(dst)]) continue;
        seenDst[low(dst)] = 1;
        plan2.push({ src: c.path, dst, bytes: c.bytes || 0, cat, kind: "dir" });
        dirCount++;
      }
      let programCount = 0;
      if (includeProgram && rep && Array.isArray(rep.suggestions)) {
        for (const s of rep.suggestions) {
          if (s.type !== "organize-folders") continue;
          for (const it of s.items || []) {
            if (it.kind !== "program") continue;
            const m = low(it.path || "").match(/^([a-z]):/);
            const driveLetter = m ? m[1].toUpperCase() : "C";
            const name = (it.path || "").split(/[\\/]+/).filter(Boolean).pop() || "\u672A\u547D\u540D";
            const dst = driveLetter + ":" + BS + "\u6574\u7406\u533A" + BS + "\u5176\u4ED6" + BS + name;
            if (seenDst[low(dst)]) continue;
            seenDst[low(dst)] = 1;
            plan2.push({ src: it.path, dst, bytes: it.bytes || 0, cat: "\u5176\u4ED6", kind: "program", fixShortcuts: true, warn: it.warn || "\u79FB\u52A8\u5C06\u5BFC\u81F4\u5FEB\u6377\u65B9\u5F0F\u5931\u6548\uFF1B\u79FB\u52A8\u540E\u5C06\u81EA\u52A8\u91CD\u5199\u684C\u9762/\u5F00\u59CB\u83DC\u5355/\u4EFB\u52A1\u680F\u5FEB\u6377\u65B9\u5F0F" });
            programCount++;
          }
        }
      }
      if (plan2.length === 0) return { ok: true, items: [], totalBytes: 0, note: "\u672A\u53D1\u73B0\u53EF\u6574\u7406\u7684\u6563\u843D\u76EE\u5F55/\u6587\u4EF6" };
      const totalBytes = plan2.reduce(function(a, p) {
        return a + (p.bytes || 0);
      }, 0);
      const fileCount = plan2.length - dirCount - programCount;
      let note = "\u6574\u7406\u76EE\u6807\uFF1A<\u76D8>:\\\u6574\u7406\u533A\\<\u5206\u7C7B>\\\uFF08\u4E0D\u5220\u9664\uFF0C\u79FB\u52A8\u53EF\u56DE\u6EDA\uFF09\uFF1B\u542B " + dirCount + " \u4E2A\u76EE\u5F55\u3001" + fileCount + " \u4E2A\u6587\u4EF6";
      if (programCount > 0) note += "\u3001" + programCount + " \u4E2A\u7A0B\u5E8F\u76EE\u5F55\uFF08\u26A0 \u79FB\u52A8\u5C06\u81EA\u52A8\u91CD\u5199\u5FEB\u6377\u65B9\u5F0F fixShortcuts\uFF0C\u8C28\u614E\u9009\u62E9\uFF09";
      return { ok: true, items: plan2.slice(0, 200), totalBytes, dirCount, fileCount, programCount, note };
    }
    async function apply(items, opts) {
      const roots = opts && Array.isArray(opts.roots) ? opts.roots : [];
      const dryRun = !!(opts && opts.dryRun);
      if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "\u7F3A\u5C11\u6574\u7406\u8BA1\u5212" };
      if (items.length > 200) return { ok: false, error: "\u5355\u6B21\u6574\u7406\u9879\u8FC7\u591A\uFF08>200\uFF09" };
      let fixCount = 0;
      for (const it of items) {
        const lp = low(it.src || "");
        if (!inScanRoots(lp, roots)) return { ok: false, error: "\u6E90\u8DEF\u5F84\u4E0D\u5728\u626B\u63CF\u8303\u56F4\u5185\uFF1A" + (it.src || "") };
        if (!isSafeZone(lp)) return { ok: false, error: "\u62D2\u7EDD\u6574\u7406\u7CFB\u7EDF\u76EE\u5F55\uFF1A" + (it.src || "") };
        const dl = low(it.dst || "");
        if (!/^[a-z]:\\整理区\\/.test(dl)) return { ok: false, error: "\u76EE\u6807\u5FC5\u987B\u5728\u76D8\u7B26\u6839\u4E0B\u7684\u6574\u7406\u533A\u76EE\u5F55\uFF1A" + (it.dst || "") };
        if (it.kind === "program" && !it.fixShortcuts) return { ok: false, error: "\u7A0B\u5E8F\u76EE\u5F55 " + (it.src || "") + " \u5FC5\u987B\u542F\u7528 fixShortcuts\uFF08\u81EA\u52A8\u91CD\u5199\u5FEB\u6377\u65B9\u5F0F\uFF09\u624D\u80FD\u79FB\u52A8" };
        if (it.fixShortcuts) fixCount++;
      }
      const total = items.reduce(function(a, it) {
        return a + (it.bytes || 0);
      }, 0);
      if (dryRun) {
        return { ok: true, dryRun: true, planned: items.length, totalBytes: total, fixCount, note: "\uFF08dry-run \u9884\u89C8\uFF09\u5C06\u79FB\u52A8 " + items.length + " \u9879\uFF0C\u7EA6 " + fmtBytes2(total) + (fixCount > 0 ? "\uFF0C\u5176\u4E2D " + fixCount + " \u4E2A\u7A0B\u5E8F\u76EE\u5F55\u5C06\u91CD\u5199\u5FEB\u6377\u65B9\u5F0F" : "") };
      }
      const planForEngine = items.map(function(it) {
        return { src: it.src, dst: it.dst };
      });
      const planTmp = path2.join(require("os").tmpdir(), "dsk-organize-plan-" + process.pid + ".json");
      writeJson(planTmp, planForEngine);
      const mapF = mapFile();
      const r = await run2(["--organize", "--plan", planTmp, "--map", mapF]);
      try {
        require("fs").unlinkSync(planTmp);
      } catch (e) {
      }
      if (!r || r.exitCode !== 0) {
        const err = r && r.error || "\u6574\u7406\u6267\u884C\u5931\u8D25";
        appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type: "organize", action: "apply", paths: items.map(function(it) {
          return it.src;
        }), executed: 0, result: "error", detail: err });
        return { ok: false, error: err };
      }
      const rdata = r.data || {};
      let shortcutFixed = 0, shortcutError = null;
      if (fixCount > 0) {
        const movedSrc = {};
        for (const mv of rdata.moved || []) movedSrc[low(mv.src)] = mv.dst;
        const fixPairs = [];
        for (const it of items) {
          if (!it.fixShortcuts) continue;
          const dst = movedSrc[low(it.src)];
          if (dst) fixPairs.push({ src: it.src, dst });
        }
        if (fixPairs.length > 0) {
          const fr = await fixShortcuts(fixPairs);
          if (fr.ok) shortcutFixed = (fr.fixed || []).length;
          else shortcutError = fr.error || "\u5FEB\u6377\u65B9\u5F0F\u4FEE\u590D\u5931\u8D25";
        }
      }
      appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type: "organize", action: "apply", paths: items.map(function(it) {
        return it.src;
      }), freedBytes: 0, executed: rdata.movedCount || 0, result: "ok", detail: JSON.stringify({ failed: rdata.failed || [], shortcutFixed, shortcutError }).slice(0, 500) });
      return { ok: true, movedCount: rdata.movedCount, failedCount: rdata.failedCount, failed: rdata.failed, shortcutFixed, shortcutError, note: "\u5DF2\u6574\u7406 " + rdata.movedCount + "/" + items.length + " \u9879" + (shortcutFixed > 0 ? "\uFF0C\u81EA\u52A8\u91CD\u5199\u5FEB\u6377\u65B9\u5F0F " + shortcutFixed + " \u4E2A" : "") + "\uFF0C\u53EF\u56DE\u6EDA" };
    }
    async function rollback(opts) {
      const dryRun = !!(opts && opts.dryRun);
      const mapF = mapFile();
      const map = readJson(mapF);
      if (!map || !Array.isArray(map) || map.length === 0) return { ok: false, error: "\u6CA1\u6709\u53EF\u56DE\u6EDA\u7684\u6574\u7406\u8BB0\u5F55" };
      const last = map[map.length - 1];
      const items = (last.items || []).map(function(m) {
        return { src: m.dst, dst: m.src };
      });
      const shortcuts = last.shortcuts && Array.isArray(last.shortcuts) ? last.shortcuts : [];
      if (items.length === 0 && shortcuts.length === 0) return { ok: false, error: "\u6700\u540E\u4E00\u6279\u6574\u7406\u8BB0\u5F55\u4E3A\u7A7A" };
      if (dryRun) {
        return { ok: true, dryRun: true, items: items.length, shortcuts: shortcuts.length, note: "\uFF08dry-run \u9884\u89C8\uFF09\u5C06\u56DE\u6EDA " + items.length + " \u9879" + (shortcuts.length > 0 ? "\uFF0C\u6062\u590D " + shortcuts.length + " \u4E2A\u5FEB\u6377\u65B9\u5F0F" : "") };
      }
      let restoredShortcuts = 0;
      if (shortcuts.length > 0) {
        const restoreTmp = path2.join(require("os").tmpdir(), "dsk-restore-" + process.pid + ".json");
        writeJson(restoreTmp, shortcuts);
        const sr = await run2(["--restore-shortcuts", restoreTmp]);
        try {
          require("fs").unlinkSync(restoreTmp);
        } catch (e) {
        }
        if (sr && sr.exitCode === 0 && sr.data) restoredShortcuts = sr.data.restored || 0;
      }
      const planTmp = path2.join(require("os").tmpdir(), "dsk-organize-plan-" + process.pid + ".json");
      writeJson(planTmp, items);
      const r = await run2(["--organize", "--plan", planTmp, "--map", mapF]);
      try {
        require("fs").unlinkSync(planTmp);
      } catch (e) {
      }
      if (!r || r.exitCode !== 0) {
        const err = r && r.error || "\u56DE\u6EDA\u6267\u884C\u5931\u8D25";
        appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type: "organize", action: "rollback", paths: items.map(function(it) {
          return it.dst;
        }), executed: 0, result: "error", detail: err });
        return { ok: false, error: err };
      }
      const rdata = r.data || {};
      appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type: "organize", action: "rollback", paths: items.map(function(it) {
        return it.dst;
      }), freedBytes: 0, executed: rdata.movedCount || 0, result: "ok", detail: JSON.stringify({ failed: rdata.failed || [], restoredShortcuts }).slice(0, 500) });
      return { ok: true, movedCount: rdata.movedCount, failedCount: rdata.failedCount, failed: rdata.failed, restoredShortcuts, note: "\u5DF2\u56DE\u6EDA " + rdata.movedCount + "/" + items.length + " \u9879" + (restoredShortcuts > 0 ? "\uFF0C\u6062\u590D\u5FEB\u6377\u65B9\u5F0F " + restoredShortcuts + " \u4E2A" : "") };
    }
    async function fixShortcuts(pairs) {
      const fixTmp = path2.join(require("os").tmpdir(), "dsk-fix-" + process.pid + ".json");
      writeJson(fixTmp, pairs);
      const mapF = mapFile();
      const r = await run2(["--fix-shortcuts", fixTmp, "--map", mapF]);
      try {
        require("fs").unlinkSync(fixTmp);
      } catch (e) {
      }
      if (!r || r.exitCode !== 0) {
        return { ok: false, error: r && r.error || "\u5FEB\u6377\u65B9\u5F0F\u4FEE\u590D\u5931\u8D25" };
      }
      const d = r.data || {};
      appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type: "shortcuts", action: "fix", paths: (d.fixed || []).map(function(f) {
        return f.lnk;
      }).slice(0, 50), executed: (d.fixed || []).length, result: "ok" });
      return { ok: true, scanned: d.scanned || 0, fixed: d.fixed || [] };
    }
    module2.exports = { plan, apply, rollback, fixShortcuts, low, fmtBytes: fmtBytes2 };
  }
});

// lib/clean.js
var require_clean = __commonJS({
  "lib/clean.js"(exports2, module2) {
    "use strict";
    var { spawnSync } = require("child_process");
    var { appendAudit, readJson } = require_audit();
    var BS = "\\";
    var SYS_PREFIX = ["\\windows\\", "\\program files\\", "\\program files (x86)\\", "\\programdata\\", "\\winsxs\\", "\\system volume information\\", "\\$recycle.bin\\"];
    var TEMP_SEG = ["temp", "tmp", "cache", "prefetch", "thumbcache", "iconcache"];
    function low(s) {
      return String(s || "").toLowerCase();
    }
    function fmtBytes2(n) {
      if (!n || n < 0) return "0 B";
      const u = ["B", "KB", "MB", "GB", "TB"];
      let v = n, k = 0;
      while (v >= 1024 && k < u.length - 1) {
        v /= 1024;
        k++;
      }
      return v.toFixed(v >= 100 ? 0 : 1) + " " + u[k];
    }
    function escPS(p) {
      return String(p).replace(/'/g, "''");
    }
    function utf16leB64(str) {
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        bytes.push(c & 255, c >> 8 & 255);
      }
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
      }
      return Buffer.from(bin, "binary").toString("base64");
    }
    function isSafeZone(lp) {
      return SYS_PREFIX.every(function(pre) {
        return lp.indexOf(pre) < 0;
      });
    }
    function hasTempSegment(lp) {
      const segs = lp.split(BS);
      return segs.some(function(s) {
        return TEMP_SEG.some(function(t) {
          return s === t || s.indexOf(t) === 0;
        });
      });
    }
    function validate(type, paths, report) {
      const err = function(msg) {
        return { ok: false, error: msg };
      };
      if (!report) return err("\u672A\u627E\u5230\u626B\u63CF\u62A5\u544A\uFF08\u8BF7\u5148\u8FD0\u884C scan\uFF09");
      const sugg = report.suggestions || [];
      if (type === "recycle-bin") return { ok: true, paths: [], estBytes: 0 };
      if (!Array.isArray(paths) || paths.length === 0) return err("\u7F3A\u5C11\u6E05\u7406\u8DEF\u5F84");
      if (paths.length > 500) return err("\u5355\u6B21\u6E05\u7406\u8DEF\u5F84\u8FC7\u591A\uFF08>500\uFF09");
      for (const p of paths) {
        const lp = low(p);
        if (!isSafeZone(lp)) return err("\u62D2\u7EDD\u6E05\u7406\u7CFB\u7EDF\u76EE\u5F55\uFF1A" + p);
      }
      if (type === "duplicates") {
        const dupGroups = sugg.filter(function(s) {
          return s.type === "duplicates";
        }).reduce(function(a, s) {
          return a.concat(s.groups || []);
        }, []);
        const removableSet = {};
        for (const g of dupGroups) for (const p of g.removable) removableSet[low(p)] = g.size;
        for (const p of paths) {
          if (!removableSet[low(p)]) return err("\u8DEF\u5F84\u4E0D\u5728\u91CD\u590D\u6587\u4EF6\u5EFA\u8BAE\u6E05\u5355\u4E2D\uFF1A" + p);
        }
        return { ok: true, paths, estBytes: paths.reduce(function(a, p) {
          return a + (removableSet[low(p)] || 0);
        }, 0) };
      }
      if (type === "empty-dirs") {
        const emptySet = {};
        for (const p of report.emptyDirSample || []) emptySet[low(p)] = 1;
        for (const p of paths) if (!emptySet[low(p)]) return err("\u8DEF\u5F84\u4E0D\u5728\u7A7A\u6587\u4EF6\u5939\u6E05\u5355\u4E2D\uFF1A" + p);
        return { ok: true, paths, estBytes: 0 };
      }
      if (type === "junk-temp") {
        for (const p of paths) {
          if (!hasTempSegment(low(p))) return err("\u8DEF\u5F84\u4E0D\u5728\u4E34\u65F6/\u7F13\u5B58\u76EE\u5F55\u4E2D\uFF1A" + p);
        }
        const tempSugg = sugg.find(function(s) {
          return s.type === "junk-temp";
        });
        let est = 0;
        if (tempSugg) for (const it of tempSugg.items || []) est += it.bytes || 0;
        return { ok: true, paths, estBytes: est };
      }
      return err("\u672A\u77E5\u6E05\u7406\u7C7B\u578B\uFF1A" + type);
    }
    async function execute(type, paths, report, dryRun) {
      const v = validate(type, paths, report);
      if (!v.ok) return v;
      if (dryRun) {
        return { ok: true, dryRun: true, type, paths: v.paths, estBytes: v.estBytes, note: "\uFF08dry-run \u9884\u89C8\uFF09\u5C06\u6E05\u7406 " + v.paths.length + " \u4E2A\u8DEF\u5F84" + (v.estBytes > 0 ? "\uFF0C\u7EA6\u53EF\u91CA\u653E " + fmtBytes2(v.estBytes) : "") + "\uFF08\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u6062\u590D\uFF09" };
      }
      let result;
      try {
        if (type === "recycle-bin") {
          result = runPS('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Output "OK"');
          const freed = (report.junk || []).find(function(j) {
            return j.label === "\u56DE\u6536\u7AD9";
          });
          appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type, action: "empty-recycle-bin", paths: ["C:" + BS + "$RECYCLE.BIN"], freedBytes: freed ? freed.bytes : 0, result: result.ok ? "ok" : "error", detail: result.err || "" });
          return { ok: true, executed: 1, freedBytes: freed ? freed.bytes : 0, note: "\u56DE\u6536\u7AD9\u5DF2\u6E05\u7A7A" };
        }
        const arrLit = "@(" + v.paths.map(function(p) {
          return "'" + escPS(p) + "'";
        }).join(",") + ")";
        const script = '$ErrorActionPreference="Continue"; Add-Type -AssemblyName Microsoft.VisualBasic; $paths = ' + arrLit + '; $ok = 0; foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; if ($i -and $i.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } elseif ($i) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } } }; Write-Output ("OK " + $ok)';
        result = runPS(script);
        const m = result.out.match(/OK (\d+)/);
        const executed = m ? Number(m[1]) : 0;
        appendAudit({ ts: (/* @__PURE__ */ new Date()).toISOString(), type, action: "move-to-recycle-bin", paths: v.paths, freedBytes: v.estBytes, executed, result: result.ok ? "ok" : "error", detail: result.err || "" });
        return { ok: true, executed, total: v.paths.length, freedBytes: v.estBytes, note: "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9 " + executed + "/" + v.paths.length + " \u9879" };
      } catch (e) {
        return { ok: false, error: "\u6267\u884C\u5931\u8D25\uFF1A" + (e && e.message ? e.message : String(e)) };
      }
    }
    function runPS(script) {
      try {
        const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", utf16leB64(script)], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 12e4,
          maxBuffer: 1 << 20,
          windowsHide: true
        });
        const out = (r.stdout || "").toString("utf8");
        const err = (r.stderr || "").toString("utf8");
        return { ok: r.status === 0, out, err };
      } catch (e) {
        return { ok: false, out: "", err: e && e.message ? e.message : String(e) };
      }
    }
    module2.exports = { validate, execute, runPS, fmtBytes: fmtBytes2, low };
  }
});

// bin/disk-clean.js
var fs = require("fs");
var path = require("path");
var os = require("os");
var { spawn } = require("child_process");
var { run, buildMarkdown } = require_engine();
var audit = require_audit();
var organize = require_organize();
var clean = require_clean();
if (process.argv[2] === "--internal-scan") {
  const engArgs = process.argv.slice(3);
  run(engArgs).then(function(res) {
    if (res && res.error) process.stdout.write("\n" + JSON.stringify({ ok: false, error: res.error }));
    else process.stdout.write("\n" + JSON.stringify(res.data));
    process.exit(res && res.exitCode ? res.exitCode : 0);
  }).catch(function(e) {
    process.stderr.write("HELPER_ERROR: " + (e && e.stack ? e.stack : String(e)));
    process.exit(2);
  });
  return;
}
var VER = "0.1.0";
var IS_SEA = false;
try {
  IS_SEA = !!(require("node:sea") && require("node:sea").isSea());
} catch (e) {
  IS_SEA = false;
}
var C = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  cyan: "\x1B[36m",
  gray: "\x1B[90m"
};
function useColor() {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}
function col(code, s) {
  return useColor() ? code + s + C.reset : s;
}
function fmtBytes(n) {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) {
    v /= 1024;
    k++;
  }
  return v.toFixed(v >= 100 ? 0 : 1) + " " + u[k];
}
function parseOpts(argv) {
  const o = { _: [], flags: {}, values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      o._.push.apply(o._, argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        o.values[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== void 0 && !next.startsWith("--") && next !== "-" && /^[A-Za-z]:[\\/]/.test(next)) {
        o.values[a.slice(2)] = next;
        i++;
        continue;
      }
      if (next !== void 0 && !next.startsWith("--")) {
        o.values[a.slice(2)] = next;
        i++;
        continue;
      }
      o.flags[a.slice(2)] = true;
    } else if (a.startsWith("-") && a.length === 2) {
      o.flags[a.slice(1)] = true;
    } else {
      o._.push(a);
    }
  }
  return o;
}
async function cmdScan(o) {
  const roots = o._.length ? o._ : await listDrives();
  if (roots.length === 0) return fail("\u672A\u6307\u5B9A\u626B\u63CF\u6839\u76EE\u5F55");
  const reportPath = o.values.report || audit.reportFile();
  const progressPath = path.join(os.tmpdir(), "dsk-progress-" + process.pid + ".json");
  const ex = (o.values.exclude || "").split(";").filter(Boolean);
  const argv = ["--roots", roots.join(";"), "--suggest"];
  if (o.values.exclude) argv.push("--exclude", o.values.exclude);
  argv.push("--report", reportPath, "--progress", progressPath);
  console.log(col(C.cyan, "\u25B6 \u6B63\u5728\u626B\u63CF:") + " " + col(C.bold, roots.join(", ")));
  const selfArgs = IS_SEA ? ["--internal-scan"] : [__filename, "--internal-scan"];
  const proc = spawn(process.execPath, selfArgs.concat(argv), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdoutBuf = "", stderrBuf = "";
  proc.stdout.on("data", function(d) {
    stdoutBuf += d.toString("utf8");
  });
  proc.stderr.on("data", function(d) {
    stderrBuf += d.toString("utf8");
  });
  const t0 = Date.now();
  const timer = setInterval(function() {
    let p = null;
    try {
      p = JSON.parse(fs.readFileSync(progressPath, "utf8"));
    } catch (e) {
    }
    if (p && !p.done) {
      process.stdout.write("\r" + col(C.dim, "  \u6587\u4EF6 " + p.files + " | \u76EE\u5F55 " + p.dirs + " | " + fmtBytes(p.bytes || 0) + (p.currentPath ? " | " + p.currentPath : "")) + "   ");
    }
  }, 800);
  const code = await new Promise(function(resolve) {
    proc.on("close", resolve);
    proc.on("error", function(e) {
      stderrBuf += "\n" + e.message;
      resolve(-1);
    });
  });
  clearInterval(timer);
  process.stdout.write("\r\x1B[K");
  const elapsed = ((Date.now() - t0) / 1e3).toFixed(1);
  if (code !== 0) {
    const lastLine = stdoutBuf.trim().split("\n").pop();
    let msg = stderrBuf.trim() || "\u626B\u63CF\u5931\u8D25 (exit " + code + ")";
    try {
      const j = JSON.parse(lastLine);
      if (j && j.error) msg = j.error;
    } catch (e) {
    }
    return fail("\u626B\u63CF\u5931\u8D25: " + msg);
  }
  const rep = audit.readJson(reportPath);
  if (!rep) return fail("\u626B\u63CF\u5B8C\u6210\u4F46\u65E0\u6CD5\u8BFB\u53D6\u62A5\u544A: " + reportPath);
  try {
    const md = buildMarkdown(rep, rep.elapsedMs || 0);
    fs.writeFileSync(audit.mdFile(), md, "utf8");
  } catch (e) {
  }
  const s = rep.summary || {};
  console.log(col(C.green, "\u2714 \u626B\u63CF\u5B8C\u6210") + "  (" + elapsed + "s)");
  console.log("  \u6839\u76EE\u5F55   : " + (s.roots || []).join(", "));
  console.log("  \u603B\u5927\u5C0F   : " + col(C.bold, fmtBytes(s.totalBytes)));
  console.log("  \u6587\u4EF6     : " + (s.totalFiles || 0) + "  \u76EE\u5F55: " + (s.totalDirs || 0) + "  \u7A7A\u76EE\u5F55: " + (s.emptyDirs || 0));
  console.log("  \u62A5\u544A     : " + reportPath);
  console.log("  Markdown : " + audit.mdFile());
  printSuggestSummary(rep);
  if (rep.suggestions && rep.suggestions.length === 0 && !rep.suggestError) {
    console.log(col(C.gray, "  (\u65E0\u667A\u80FD\u5EFA\u8BAE)"));
  }
  return 0;
}
function printSuggestSummary(rep) {
  const sugg = rep.suggestions || [];
  if (sugg.length === 0) return;
  console.log(col(C.cyan, "\n\u2500\u2500 \u667A\u80FD\u5EFA\u8BAE \u2500\u2500"));
  for (const s of sugg) {
    const n = (s.items || []).length;
    let b = 0;
    for (const it of s.items || []) b += it.bytes || 0;
    const tag = col(C.yellow, "[" + (s.type || "?") + "]");
    const count = n + " \u9879";
    console.log("  " + tag + " " + (s.label || s.type) + " \u2014 " + count + (b > 0 ? " (" + fmtBytes(b) + ")" : ""));
  }
  const oc = rep.organizeCandidates || [];
  if (oc.length > 0) {
    console.log(col(C.cyan, "\u2500\u2500 \u6563\u843D\u76EE\u5F55\u5019\u9009 \u2500\u2500"));
    for (const c of oc.slice(0, 10)) {
      console.log("  \xB7 " + c.path + col(C.gray, " (" + fmtBytes(c.bytes) + ", " + c.cat + ")"));
    }
  }
}
async function listDrives() {
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const ch = String.fromCharCode(i);
    try {
      fs.accessSync(ch + ":\\");
      out.push(ch + ":\\");
    } catch (e) {
    }
  }
  return out;
}
async function cmdReport(o) {
  const p = o._[0] || audit.reportFile();
  const rep = audit.readJson(p);
  if (!rep) return fail("\u65E0\u6CD5\u8BFB\u53D6\u62A5\u544A: " + p + "\uFF08\u8BF7\u5148\u8FD0\u884C scan\uFF09");
  const s = rep.summary || {};
  console.log(col(C.cyan, "\u2500\u2500 \u78C1\u76D8\u5206\u6790\u62A5\u544A \u2500\u2500"));
  console.log("  \u6839\u76EE\u5F55   : " + (s.roots || []).join(", "));
  console.log("  \u603B\u5927\u5C0F   : " + col(C.bold, fmtBytes(s.totalBytes)) + "  \u6587\u4EF6: " + (s.totalFiles || 0) + "  \u76EE\u5F55: " + (s.totalDirs || 0));
  if (rep.category && rep.category.length) {
    console.log(col(C.cyan, "\u2500\u2500 \u7C7B\u522B\u5206\u5E03 \u2500\u2500"));
    const max = rep.category.reduce(function(a, c) {
      return Math.max(a, c.bytes || 0);
    }, 1);
    for (const c of rep.category.slice(0, 12)) {
      const w = Math.round((c.bytes || 0) / max * 24);
      console.log("  " + (c.label || "?").padEnd(8) + " " + col(C.blue, "\u2588".repeat(w)) + col(C.gray, "\u2588".repeat(Math.max(0, 24 - w))) + " " + fmtBytes(c.bytes) + "  " + (c.count || 0) + " \u6587\u4EF6");
    }
  }
  printSuggestSummary(rep);
  try {
    const md = buildMarkdown(rep, rep.elapsedMs || 0);
    const mdPath = p.replace(/\.json$/i, "") + ".md";
    fs.writeFileSync(mdPath, md, "utf8");
    console.log(col(C.green, "\u2714 Markdown \u62A5\u544A: ") + mdPath);
  } catch (e) {
    console.log(col(C.yellow, "! Markdown \u751F\u6210\u5931\u8D25: " + e.message));
  }
  return 0;
}
async function cmdOrganize(o) {
  const sub = o._[0];
  const reportFile = o.values.report || audit.reportFile();
  if (sub === "plan") {
    const includeProgram = o.flags["include-program"] || o.flags.includeProgram;
    const r = await organize.plan({ includeProgram, reportFile });
    if (!r.ok) return fail(r.error);
    if (r.items.length === 0) {
      console.log(col(C.yellow, "\uFF08" + r.note + "\uFF09"));
      return 0;
    }
    console.log(col(C.cyan, "\u2500\u2500 \u6574\u7406\u8BA1\u5212 \u2500\u2500") + " " + r.note);
    for (const it of r.items) {
      const tag = it.kind === "program" ? col(C.red, "[\u7A0B\u5E8F]") : it.kind === "dir" ? col(C.blue, "[\u76EE\u5F55]") : col(C.green, "[\u6587\u4EF6]");
      console.log("  " + tag + " " + it.src + col(C.gray, " \u2192 " + it.dst + " (" + fmtBytes(it.bytes) + ")"));
      if (it.kind === "program" && it.warn) console.log("        " + col(C.yellow, "\u26A0 " + it.warn));
    }
    audit.writeJson(audit.planFile(), r.items);
    console.log(col(C.gray, "  \u8BA1\u5212\u5DF2\u4FDD\u5B58: ") + audit.planFile());
    console.log(col(C.gray, "  \u6267\u884C: disk-clean organize apply --yes"));
    return 0;
  }
  if (sub === "apply") {
    const dryRun = o.flags["dry-run"] || o.flags.dryRun;
    const yes = o.flags.yes || o.flags.y;
    const planItems = audit.readJson(o._[1] || audit.planFile());
    if (!Array.isArray(planItems) || planItems.length === 0) return fail("\u7F3A\u5C11\u6574\u7406\u8BA1\u5212\uFF08\u5148\u8FD0\u884C organize plan\uFF09");
    const roots = await currentScanRoots(reportFile);
    const r = await organize.apply(planItems, { roots, dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, "\uFF08dry-run \u9884\u89C8\uFF09" + r.note));
      console.log(col(C.gray, "  \u786E\u8BA4\u6267\u884C\u8BF7\u52A0 --yes"));
      return 0;
    }
    console.log(col(C.green, "\u2714 " + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, "  \u2717 " + f.src + " \u2192 " + f.dst + " (" + f.reason + ")"));
    return 0;
  }
  if (sub === "rollback") {
    const dryRun = o.flags["dry-run"] || o.flags.dryRun;
    const yes = o.flags.yes || o.flags.y;
    const r = await organize.rollback({ dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, "\uFF08dry-run \u9884\u89C8\uFF09" + r.note));
      console.log(col(C.gray, "  \u786E\u8BA4\u56DE\u6EDA\u8BF7\u52A0 --yes"));
      return 0;
    }
    console.log(col(C.green, "\u2714 " + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, "  \u2717 " + f.src + " (" + f.reason + ")"));
    return 0;
  }
  return fail("organize \u5B50\u547D\u4EE4: plan | apply | rollback");
}
async function currentScanRoots(reportFile) {
  const rep = audit.readJson(reportFile);
  if (rep && rep.summary && Array.isArray(rep.summary.roots)) return rep.summary.roots;
  return [];
}
async function cmdFixShortcuts(o) {
  const p = o._[0];
  if (!p) return fail("\u7528\u6CD5: disk-clean fix-shortcuts <pairs.json>");
  const pairs = audit.readJson(p);
  if (!Array.isArray(pairs) || pairs.length === 0) return fail("\u65E0\u6548\u7684\u4FEE\u590D\u6E05\u5355");
  const r = await organize.fixShortcuts(pairs);
  if (!r.ok) return fail(r.error);
  console.log(col(C.green, "\u2714 \u626B\u63CF " + r.scanned + " \u4E2A\u5FEB\u6377\u65B9\u5F0F\uFF0C\u4FEE\u590D " + (r.fixed || []).length + " \u4E2A"));
  for (const f of (r.fixed || []).slice(0, 10)) console.log("  \xB7 " + f.lnk);
  return 0;
}
async function cmdClean(o) {
  const type = o._[0];
  const reportFile = o.values.report || audit.reportFile();
  const rep = audit.readJson(reportFile);
  if (!rep) return fail("\u672A\u627E\u5230\u626B\u63CF\u62A5\u544A\uFF08\u8BF7\u5148\u8FD0\u884C scan\uFF09");
  let paths = [];
  if (type === "recycle-bin") {
    paths = [];
  } else if (o._.length > 1) {
    paths = o._.slice(1);
  } else {
    const sugg = rep.suggestions || [];
    const safeOnly = function(list) {
      return (list || []).filter(function(p) {
        return !/\\windows\\|\\program files\\|\\program files \(x86\)\\|\\programdata\\|\\winsxs\\|\\system volume information\\|\\\$recycle\.bin\\/i.test(String(p).toLowerCase());
      });
    };
    if (type === "duplicates") {
      for (const s of sugg) if (s.type === "duplicates") for (const g of s.groups || []) paths = paths.concat(safeOnly(g.removable || []));
    } else if (type === "empty-dirs") {
      paths = safeOnly((rep.emptyDirSample || []).slice(0, 200));
    } else if (type === "junk-temp") {
      paths = safeOnly((rep.emptyDirSample || []).filter(function(p) {
        return /(\\temp\\|\\tmp\\|\\cache\\|\\prefetch\\|\\thumbcache\\|\\iconcache\\|(^|[\\/])(temp|tmp|cache|prefetch|thumbcache|iconcache)([\\/]|$))/i.test(String(p));
      })).slice(0, 200);
      if (paths.length === 0) return fail("\u672A\u4ECE\u62A5\u544A\u4E2D\u63D0\u53D6\u5230\u4E34\u65F6/\u7F13\u5B58\u8DEF\u5F84\uFF0C\u8BF7\u663E\u5F0F\u4F20\u5165\uFF1Adisk-clean clean junk-temp <path1> <path2> ...");
    } else {
      return fail("\u672A\u77E5\u6E05\u7406\u7C7B\u578B: " + type + "\uFF08junk-temp | empty-dirs | duplicates | recycle-bin\uFF09");
    }
  }
  const dryRun = o.flags["dry-run"] || o.flags.dryRun;
  const yes = o.flags.yes || o.flags.y;
  const v = clean.validate(type, paths, rep);
  if (!v.ok) return fail(v.error);
  const r = await clean.execute(type, v.paths, rep, dryRun || !yes);
  if (!r.ok) return fail(r.error);
  if (r.dryRun) {
    console.log(col(C.yellow, r.note));
    console.log(col(C.gray, "  \u786E\u8BA4\u6267\u884C\u8BF7\u52A0 --yes"));
    return 0;
  }
  console.log(col(C.green, "\u2714 " + r.note));
  return 0;
}
async function cmdAudit() {
  const entries = audit.readAudit();
  if (entries.length === 0) {
    console.log("\uFF08\u6682\u65E0\u5BA1\u8BA1\u8BB0\u5F55\uFF09");
    return 0;
  }
  console.log(col(C.cyan, "\u2500\u2500 \u5BA1\u8BA1\u65E5\u5FD7 (" + entries.length + " \u6761) \u2500\u2500"));
  for (const e of entries.slice(-20)) {
    const t = (e.ts || "").replace("T", " ").slice(0, 19);
    console.log("  " + t + "  " + (e.type || "") + "/" + (e.action || "") + "  " + (e.result || "") + "  " + (e.paths || []).length + " \u8DEF\u5F84");
  }
  console.log(col(C.gray, "  \u5B8C\u6574\u65E5\u5FD7: " + audit.auditFile()));
  return 0;
}
function help() {
  console.log(col(C.bold, "disk-clean v" + VER + " \u2014 Windows \u78C1\u76D8\u6E05\u7406\u4E0E\u5206\u6790 CLI"));
  console.log("");
  console.log("\u7528\u6CD5: disk-clean <command> [options]");
  console.log("");
  console.log("\u547D\u4EE4:");
  console.log("  scan [roots...]            \u626B\u63CF\u78C1\u76D8/\u76EE\u5F55\uFF0C\u751F\u6210\u62A5\u544A (JSON+Markdown)");
  console.log("                              \u793A\u4F8B: disk-clean scan C:\\ D:\\");
  console.log("  report [file]              \u8BFB\u53D6\u62A5\u544A\u5E76\u6E32\u67D3 (\u7EC8\u7AEF + Markdown)");
  console.log("  organize plan              \u751F\u6210\u6574\u7406\u8BA1\u5212 (\u76EE\u5F55\u2192\u6574\u7406\u533A, \u53EF\u56DE\u6EDA)");
  console.log("      --include-program      \u8FFD\u52A0\u7A0B\u5E8F/\u6E38\u620F\u76EE\u5F55\u5019\u9009(\u26A0\u5FEB\u6377\u65B9\u5F0F)");
  console.log("  organize apply [file]      \u6267\u884C\u6574\u7406 (\u9ED8\u8BA4\u9884\u89C8, --yes \u6267\u884C)");
  console.log("  organize rollback          \u56DE\u6EDA\u6700\u540E\u4E00\u6279\u6574\u7406 (--yes \u6267\u884C)");
  console.log("  fix-shortcuts <pairs.json> \u5355\u72EC\u4FEE\u590D\u6307\u5411\u65E7\u8DEF\u5F84\u7684\u5FEB\u6377\u65B9\u5F0F");
  console.log("  clean <type> [paths...]    \u6E05\u7406: junk-temp|empty-dirs|duplicates|recycle-bin");
  console.log("                              (\u9ED8\u8BA4\u9884\u89C8, --yes \u6267\u884C; \u79FB\u5165\u56DE\u6536\u7AD9\u53EF\u6062\u590D)");
  console.log("  audit                      \u67E5\u770B\u64CD\u4F5C\u5BA1\u8BA1\u65E5\u5FD7");
  console.log("");
  console.log("\u901A\u7528\u9009\u9879:");
  console.log("  --report <file>  \u6307\u5B9A\u62A5\u544A\u6587\u4EF6\u4F4D\u7F6E");
  console.log("  --exclude a;b    \u626B\u63CF\u6392\u9664\u8DEF\u5F84");
  console.log("  --dry-run        \u53EA\u9884\u89C8\u4E0D\u6267\u884C");
  console.log("  --yes / -y       \u786E\u8BA4\u6267\u884C\u7834\u574F\u6027\u64CD\u4F5C");
  console.log("  --help / -h      \u5E2E\u52A9   --version / -v \u7248\u672C");
  return 0;
}
function fail(msg) {
  console.error(col(C.red, "\u2717 " + msg));
  return 1;
}
async function main() {
  const argv = process.argv.slice(2);
  const o = parseOpts(argv);
  const cmd = o._[0];
  o._ = o._.slice(1);
  try {
    switch (cmd) {
      case "scan":
        return await cmdScan(o);
      case "report":
        return await cmdReport(o);
      case "organize":
        return await cmdOrganize(o);
      case "fix-shortcuts":
        return await cmdFixShortcuts(o);
      case "clean":
        return await cmdClean(o);
      case "audit":
        return await cmdAudit();
      case "version":
      case "-v":
      case "--version":
        console.log("disk-clean v" + VER);
        return 0;
      case "help":
      case "-h":
      case "--help":
      case void 0:
        if (o.flags.version || o.flags.v) {
          console.log("disk-clean v" + VER);
          return 0;
        }
        return help();
      default:
        return fail("\u672A\u77E5\u547D\u4EE4: " + cmd + "\uFF08--help \u67E5\u770B\u7528\u6CD5\uFF09");
    }
  } catch (e) {
    return fail("\u8FD0\u884C\u65F6\u9519\u8BEF: " + (e && e.stack ? e.stack : String(e)));
  }
}
main().then(function(code) {
  process.exit(code || 0);
});
