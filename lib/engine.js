// engine.js — 磁盘分析引擎（原生 fs 遍历）
// 双形态：
//   1) 模块：const { run } = require('./engine.js'); const res = await run(argv);
//   2) 直接执行：node engine.js --roots "C:\;D:\" --suggest [--time]
//      （直接执行时 stdout 输出 '\n' + JSON.stringify(结果)，兼容原 dsk-helper 行为）
// 模式:
//   --roots "C:\;D:\" --exclude "x;y" [--suggest] [--progress <file>] [--report <file>] [--time]
//   --dir <path>                       # 下钻模式
//   --organize --plan <file> --map <file>       # 目录整理
//   --fix-shortcuts <file> [--map <file>]       # 快捷方式修复
//   --restore-shortcuts <file>                 # 快捷方式恢复
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// ---------- 参数（run() 开头重算） ----------
let args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined ? def : v;
}
let roots = [];
let excludes = [];
let progressFile = '';
let reportFile = '';
let withTime = false;
let suggestMode = false;

const DAYS = 24 * 3600 * 1000;
// 阈值（默认值；run() 时可由配置文件覆盖）
let STALE_MS = 730 * DAYS;            // 陈旧阈值：修改时间超过 730 天
let STALE_LARGE_MIN = 500 * 1024 * 1024; // 陈旧大文件阈值：≥ 500MB
let DUP_MIN_SIZE = 1 << 20;           // 重复候选最小字节：1MB（原 512B，避免为小文件哈希浪费时间）
const DUP_FULL_LIMIT = 32 * 1024 * 1024;  // 全哈希确认上限
const DUP_HEAD = 64 * 1024;             // head 哈希长度（阶段 1）
const DUP_TAIL = 64 * 1024;             // tail 哈希长度（阶段 2，仅 head 命中后读取）

// ---------- 规则库（与插件一致） ----------
const EXT_CAT = {
  mp4:'媒体',mkv:'媒体',mov:'媒体',avi:'媒体',wmv:'媒体',flv:'媒体',webm:'媒体',m4v:'媒体',ts:'媒体',
  mp3:'媒体',flac:'媒体',wav:'媒体',aac:'媒体',ogg:'媒体',m4a:'媒体',wma:'媒体',opus:'媒体',mid:'媒体',
  jpg:'图片',jpeg:'图片',png:'图片',gif:'图片',webp:'图片',bmp:'图片',svg:'图片',ico:'图片',tif:'图片',tiff:'图片',raw:'图片',heic:'图片',psd:'图片',ai:'图片',avif:'图片',
  doc:'文档',docx:'文档',xls:'文档',xlsx:'文档',ppt:'文档',pptx:'文档',pdf:'文档',txt:'文档',md:'文档',rtf:'文档',csv:'文档',epub:'文档',pages:'文档',numbers:'文档',key:'文档',
  zip:'压缩包',rar:'压缩包','7z':'压缩包',tar:'压缩包',gz:'压缩包',bz2:'压缩包',xz:'压缩包',iso:'压缩包',cab:'压缩包',zst:'压缩包',
  exe:'安装包',msi:'安装包',msix:'安装包',appx:'安装包',dmg:'安装包',
  js:'代码',ts:'代码',jsx:'代码',tsx:'代码',py:'代码',java:'代码',c:'代码',h:'代码',cpp:'代码',cc:'代码',hpp:'代码',cs:'代码',go:'代码',rs:'代码',rb:'代码',php:'代码',swift:'代码',kt:'代码',scala:'代码',sh:'代码',bat:'代码',ps1:'代码',sql:'代码',html:'代码',css:'代码',vue:'代码',json:'代码',xml:'代码',yaml:'代码',yml:'代码',toml:'代码',ini:'代码',cfg:'代码',
  log:'日志',tmp:'临时',temp:'临时',bak:'备份',
  dll:'系统',sys:'系统',drv:'系统',mui:'系统',cat:'系统',ocx:'系统',
  db:'数据库',sqlite:'数据库',sqlite3:'数据库',mdf:'数据库',ldf:'数据库',accdb:'数据库',mdb:'数据库',
  vhd:'虚拟磁盘',vhdx:'虚拟磁盘',vmdk:'虚拟磁盘',vdi:'虚拟磁盘',
  node_modules:'依赖包',jar:'依赖包',whl:'依赖包',gem:'依赖包',nupkg:'依赖包'
};
const EXT_JUNK = { dmp:'崩溃转储', mdmp:'崩溃转储', tmp:'临时文件', temp:'临时文件' };
const DIR_CAT_RULES = [
  { segs:['windows'], cat:'系统目录' },
  { segs:['windows.old'], cat:'旧系统' },
  { segs:['program files','program files (x86)'], cat:'程序目录' },
  { segs:['programdata'], cat:'应用数据' },
  { segs:['appdata'], cat:'应用数据' },
  { segs:['users'], cat:'用户数据' },
  { segs:['documents','downloads','desktop','pictures','videos','music','onedrive'], cat:'用户数据' },
  { segs:['node_modules','.git','dist','build','target','__pycache__','venv','.venv','.gradle','.idea','.vscode'], cat:'开发工程' },
  { segs:['temp','tmp','cache','caches'], cat:'临时/缓存' },
  { segs:['$recycle.bin'], cat:'回收站' }
];
const JUNK_RULES = [
  { label:'回收站', match:s => s.indexOf('$recycle.bin') >= 0 },
  { label:'用户临时目录', match:s => s.indexOf('appdata') >= 0 && s.indexOf('temp') >= 0 },
  { label:'Windows 临时', match:s => s.indexOf('windows') >= 0 && s.indexOf('temp') >= 0 },
  { label:'Windows 预读取', match:s => s.indexOf('windows') >= 0 && s.indexOf('prefetch') >= 0 },
  { label:'Windows 更新缓存', match:s => s.indexOf('windows') >= 0 && s.indexOf('softwaredistribution') >= 0 && s.indexOf('download') >= 0 },
  { label:'浏览器缓存', match:s => (s.indexOf('chrome') >= 0 || s.indexOf('msedge') >= 0 || s.indexOf('microsoft edge') >= 0 || s.indexOf('firefox') >= 0 || s.indexOf('chromium') >= 0) && (s.indexOf('cache') >= 0 || s.indexOf('cacheddata') >= 0 || s.indexOf('code cache') >= 0 || s.indexOf('gpucache') >= 0) },
  { label:'缩略图缓存', match:s => s.indexOf('explorer') >= 0 && (s.indexOf('thumbcache') >= 0 || s.indexOf('thumbnails') >= 0 || s.indexOf('iconcache') >= 0) },
  { label:'Windows.old', match:s => s.indexOf('windows.old') >= 0 }
];
const AUTO_SKIP = ['system volume information'];
const MAX_DEPTH = 64;
const CONCURRENCY = 64;

// 用户数据目录段（重复检测 / 历史目录检测只针对这些区域）
const USER_ZONE_SEGS = ['downloads', 'documents', 'desktop', 'pictures', 'videos', 'music', 'onedrive'];
// 游戏库目录段：这些目录由启动器（Steam/WeGame/Epic 等）校验完整性，
// 无需重复哈希 / 陈旧 / 垃圾检测，仍统计大小与文件数（报告需要）。
const APP_ZONE_SEGS = [
  'steamapps', 'wegameapps', 'rail_apps', 'epic games', 'gog games', 'gog galaxy',
  'battle.net', 'origin games', 'xboxgames', 'ubisoft game launcher', 'blizzard', 'ubisoft'
];
// ---------- 目录整理建议（散落目录检测） ----------
let LOOSE_MS = 30 * DAYS;            // 散落判定：目录修改时间 > 30 天
let LOOSE_MIN = 100 * 1024 * 1024;   // 散落判定：目录大小 ≥ 100MB
const LOOSE_MAX = 100;                 // 报告 organizeCandidates 上限
// 盘根下忽略的标准/系统目录（不当作散落候选）
const DRIVE_ROOT_SKIP = [
  'windows', 'program files', 'program files (x86)', 'programdata', 'users',
  '$recycle.bin', 'system volume information', 'recovery', 'perflogs',
  'intel', 'msocache', 'config.msi', 'onekey', 'oneclick', 'dsh', '.dsh',
  '整理区', 'temp', 'tmp'
];
// 程序/游戏目录名特征（B 类：仅提示，不移动）
const PROG_NAME_HINTS = [
  'steam', 'wegame', 'epic', 'gog', 'battle.net', 'origin', 'xbox', 'ubisoft', 'blizzard', 'razer', 'logitech',
  'qq', 'wechat', 'weixin', '微信', 'tim', '钉钉', 'dingtalk', 'alipay', '支付宝', 'wps', 'office', 'vs code', 'vscode',
  'visual studio', 'jetbrains', 'idea', 'pycharm', 'goland', 'webstorm', 'android', 'sdk', 'ndk', 'nodejs', 'node',
  'python', 'anaconda', 'miniconda', 'rust', 'cargo', 'golang', 'unity', 'unreal', 'ue4', 'ue5', 'blender', 'photoshop', 'adobe',
  'autocad', 'cad', 'chrome', 'firefox', 'edge', '360', 'tencent', 'baidu', 'alibaba', 'netease', 'youdao', 'obs', 'bandizip',
  'winrar', '7-zip', '7zip', 'vmware', 'virtualbox', 'docker', 'wsl', 'git', 'svn', 'maven', 'gradle', 'npm', 'yarn', 'pnpm',
  'mysql', 'postgresql', 'oracle', 'mongodb', 'redis', 'nginx', 'tomcat', 'java', 'jdk', 'jre', 'dotnet', 'vcredist', 'directx',
  'vulkan', 'cuda', 'nvidia', 'amd', 'driver', '驱动', '游戏', 'games', 'game', 'lol', '英雄联盟', 'dota', 'csgo', 'cs2', 'valorant',
  'genshin', '原神', 'mihoyo', 'miyoho', 'star rail', '崩坏', 'apex', 'pubg', '绝地求生', 'minecraft', '我的世界'
];
// 程序/游戏目录结构特征（浅层子目录命中任一即 B 类；.git/node_modules 属项目目录，归 A 类可移动）
const PROG_DIR_HINTS = ['steamapps', 'wegameapps', 'rail_apps', 'bin', 'exe', 'release', 'debug'];
// 可执行/系统文件扩展（浅层计数 ≥3 即 B 类）
const PROG_EXT = { exe: 1, dll: 1, msi: 1, msix: 1, appx: 1, sys: 1, bat: 1, cmd: 1 };
// 引擎主导分类 → 整理区子目录（其余归「其他」）
const ORG_CAT_MAP = { '媒体': '媒体', '图片': '图片', '文档': '文档', '安装包': '安装包', '压缩包': '压缩包', '虚拟磁盘': '虚拟磁盘', '数据库': '数据库', '备份': '备份' };

function low(s) { return String(s || '').toLowerCase() }
function isDedupZone(p) {
  const segs = splitSegs(p);
  return segs.some(s => USER_ZONE_SEGS.indexOf(s) >= 0);
}
function isAppZone(segs) {
  return segs.some(s => APP_ZONE_SEGS.indexOf(s) >= 0);
}
function splitSegs(p) { return low(p).replace(/^[a-z]:[\\/]/, '').replace(/^[a-z]:/, '').split(/[\\/]+/).filter(Boolean) }
function extOf(name) { const i = name.lastIndexOf('.'); if (i <= 0 || i === name.length - 1) return ''; return low(name.slice(i + 1)) }
function classifyDir(segs) { for (const r of DIR_CAT_RULES) for (const s of r.segs) if (segs.indexOf(s) >= 0) return r.cat; return '其他' }
function junkFor(segs, ext) { for (const r of JUNK_RULES) if (r.match(segs)) return r.label; return EXT_JUNK[ext] || null }

// ---------- 状态（run() 开头 resetState() 重置） ----------
let cancelled = false;
if (!process._dskSigBound) {
  process._dskSigBound = true;
  process.on('SIGTERM', function() { cancelled = true });
}
let visited = new Set();
let dirMap = new Map();
let stats = {
  files: 0, dirs: 0, bytes: 0, emptyDirs: 0, currentPath: '',
  skipped: { permission: 0, cycle: 0, protected: 0, excluded: 0, deep: 0, error: 0 },
  appZoneFiles: 0, appZoneBytes: 0
};
let results = {
  fileCat: {}, fileCatCount: {}, ext: {}, junk: {}, junkCount: {},
  topFiles: [], emptyDirs: [], createdBuckets: {}, modifiedBuckets: {}
};
// 建议模式数据
let bySize = new Map();      // size -> [{path, size}]（仅用户区且 ≥1MB）
let staleFiles = [];         // {path, size, mtimeMs} 修改时间超阈值（非游戏库区）
let dirOld = new Map();      // dir -> {count, oldCount}（目录内创建时间统计，仅用户区）
let looseCandidates = [];    // {path, name, zone:'drive'|'user'} 散落目录候选（walk 收集）
let looseDirs = [];          // {path, bytes, modified, kind:'loose'|'program', cat} 分析结果
let now = Date.now();
let lastProg = 0;

function resetState() {
  cancelled = false;
  visited = new Set();
  dirMap = new Map();
  stats = {
    files: 0, dirs: 0, bytes: 0, emptyDirs: 0, currentPath: '',
    skipped: { permission: 0, cycle: 0, protected: 0, excluded: 0, deep: 0, error: 0 },
    appZoneFiles: 0, appZoneBytes: 0
  };
  results = {
    fileCat: {}, fileCatCount: {}, ext: {}, junk: {}, junkCount: {},
    topFiles: [], emptyDirs: [], createdBuckets: {}, modifiedBuckets: {}
  };
  bySize = new Map();
  staleFiles = [];
  dirOld = new Map();
  looseCandidates = [];
  looseDirs = [];
  now = Date.now();
  lastProg = 0;
}

function writeProgress() {
  if (!progressFile) return;
  try {
    fs.writeFileSync(progressFile, JSON.stringify({
      files: stats.files, dirs: stats.dirs, bytes: stats.bytes,
      emptyDirs: stats.emptyDirs, currentPath: stats.currentPath,
      skipped: stats.skipped
    }), 'utf8');
  } catch (e) { /* 忽略 */ }
}

async function walk(dir, segs, depth, inAppZone) {
  if (cancelled) throw new Error('CANCELLED');
  let key;
  try { key = await fsp.realpath(dir); } catch (e) { stats.skipped.permission++; return null; }
  if (visited.has(key)) { stats.skipped.cycle++; return null; }
  if (depth > MAX_DEPTH) { stats.skipped.deep++; return null; }
  const lp = low(dir);
  for (const ex of excludes) { if (lp === ex || lp.indexOf(ex + '\\') === 0) { stats.skipped.excluded++; return null; } }
  for (const s of AUTO_SKIP) { if (segs.indexOf(s) >= 0) { stats.skipped.protected++; return null; } }
  visited.add(key);
  const appZone = inAppZone || isAppZone(segs);
  // 目录整理建议：盘根 / 用户区根部的第一层目录为「散落候选」（仅建议模式收集）
  const thisRoot = low(dir).replace(/[\\/]+$/, '');
  const isDriveRoot = /^[a-z]:$/.test(thisRoot);
  const isUserZoneRoot = !isDriveRoot && segs.indexOf('users') >= 0 && USER_ZONE_SEGS.indexOf(segs[segs.length - 1]) >= 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { stats.skipped.permission++; return null; }
  if (entries.length === 0) { stats.emptyDirs++; if (results.emptyDirs.length < 2000) results.emptyDirs.push(dir); }
  const childDirs = [];
  const fileEntries = [];
  for (const en of entries) {
    if (en.isDirectory() || en.isSymbolicLink()) childDirs.push(en);
    else if (en.isFile()) fileEntries.push(en);
  }
  if (suggestMode && (isDriveRoot || isUserZoneRoot)) {
    for (const en of childDirs) {
      const n = low(en.name);
      if (n.charAt(0) === '$') continue;
      if (isDriveRoot && DRIVE_ROOT_SKIP.indexOf(n) >= 0) continue;
      looseCandidates.push({ path: path.join(dir, en.name), name: en.name, zone: isDriveRoot ? 'drive' : 'user' });
    }
  }
  const agg = { bytes: 0, files: 0, dirs: childDirs.length };
  // F: 目录内文件 stat 并发（原为串行 await）
  if (fileEntries.length > 0) {
    await pool(fileEntries, async function(en) {
      let st;
      try { st = await fsp.stat(path.join(dir, en.name)); } catch (e) { return; }
      const sz = st.size;
      agg.bytes += sz; agg.files++;
      stats.files++; stats.bytes += sz;
      const ext = extOf(en.name);
      const cat = EXT_CAT[ext] || '其他';
      results.fileCat[cat] = (results.fileCat[cat] || 0) + sz;
      results.fileCatCount[cat] = (results.fileCatCount[cat] || 0) + 1;
      const ek = ext === '' ? '(无扩展名)' : ext;
      results.ext[ek] = (results.ext[ek] || 0) + sz;
      if (appZone) { stats.appZoneFiles++; stats.appZoneBytes += sz; }
      const jl = junkFor(segs, ext);
      if (jl) { results.junk[jl] = (results.junk[jl] || 0) + sz; results.junkCount[jl] = (results.junkCount[jl] || 0) + 1; }
      if (sz > 0) {
        const tf = results.topFiles;
        if (tf.length < 100) { tf.push({ path: path.join(dir, en.name), bytes: sz }); tf.sort((a, b) => b.bytes - a.bytes); }
        else if (sz > tf[tf.length - 1].bytes) { tf[tf.length - 1] = { path: path.join(dir, en.name), bytes: sz }; tf.sort((a, b) => b.bytes - a.bytes); }
      }
      if (withTime) {
        if (st.birthtime && !isNaN(st.birthtime.getTime())) { const y = st.birthtime.getFullYear(); results.createdBuckets[y] = (results.createdBuckets[y] || 0) + sz; }
        const y = st.mtime.getFullYear(); results.modifiedBuckets[y] = (results.modifiedBuckets[y] || 0) + sz;
      }
      if (suggestMode && !appZone) {
        // 去重候选：仅用户区且 ≥1MB（A+C）
        if (sz >= DUP_MIN_SIZE && isDedupZone(dir)) {
          const arr = bySize.get(sz);
          if (arr) arr.push({ path: path.join(dir, en.name), size: sz }); else bySize.set(sz, [{ path: path.join(dir, en.name), size: sz }]);
        }
        if (now - st.mtimeMs > STALE_MS && sz > 0) staleFiles.push({ path: path.join(dir, en.name), size: sz, modified: st.mtime.toISOString().slice(0, 10) });
        if (isDedupZone(dir)) {
          const dob = dirOld.get(dir);
          if (dob) {
            dob.count++;
            if (st.birthtime && !isNaN(st.birthtime.getTime()) && now - st.birthtimeMs > STALE_MS) dob.oldCount++;
          } else {
            dirOld.set(dir, { count: 1, oldCount: (st.birthtime && !isNaN(st.birthtime.getTime()) && now - st.birthtimeMs > STALE_MS) ? 1 : 0 });
          }
        }
      }
    });
  }
  if (childDirs.length > 0) {
    await pool(childDirs, async function(en) {
      const r = await walk(path.join(dir, en.name), segs.concat(splitSegs(en.name)).filter(Boolean), depth + 1, appZone);
      if (r) { agg.bytes += r.bytes; agg.files += r.files; agg.dirs += r.dirs; }
    });
  }
  dirMap.set(lp, { path: dir, bytes: agg.bytes, files: agg.files, dirs: agg.dirs, cat: classifyDir(segs) });
  stats.dirs++;
  if (Date.now() - lastProg > 250) { lastProg = Date.now(); stats.currentPath = dir; writeProgress(); }
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
        try { await fn(item); }
        catch (e) { if (e && e.message === 'CANCELLED') throw e; stats.skipped.error++; }
      }
    })());
  }
  await Promise.all(workers);
}

function finalize() {
  const extArr = Object.keys(results.ext).map(k => ({ ext: k, bytes: results.ext[k] }));
  extArr.sort((a, b) => b.bytes - a.bytes);
  const extTop = extArr.slice(0, 30);
  const rest = extArr.slice(30).reduce((a, x) => a + x.bytes, 0);
  if (rest > 0) extTop.push({ ext: '(其他)', bytes: rest });
  const category = Object.keys(results.fileCat).map(k => ({ label: k, bytes: results.fileCat[k], count: results.fileCatCount[k] || 0 }));
  category.sort((a, b) => b.bytes - a.bytes);
  const dirArr = [];
  dirMap.forEach(v => dirArr.push(v));
  dirArr.sort((a, b) => b.bytes - a.bytes);
  const topDirs = dirArr.slice(0, 50).map(d => ({ path: d.path, bytes: d.bytes, files: d.files, dirs: d.dirs, cat: d.cat }));
  const junk = Object.keys(results.junk).map(k => ({ label: k, bytes: results.junk[k], count: results.junkCount[k] || 0 }));
  junk.sort((a, b) => b.bytes - a.bytes);
  const timeBuckets = withTime ? {
    created: results.createdBuckets, modified: results.modifiedBuckets
  } : null;
  return {
    summary: {
      roots, totalFiles: stats.files, totalDirs: dirMap.size, totalBytes: stats.bytes,
      emptyDirs: stats.emptyDirs, skipped: stats.skipped, scannedAt: new Date().toISOString(),
      status: cancelled ? 'cancelled' : 'done',
      appZoneFiles: stats.appZoneFiles, appZoneBytes: stats.appZoneBytes
    },
    category, extTop, topDirs, topFiles: results.topFiles, junk,
    emptyDirSample: results.emptyDirs, timeBuckets
  };
}

// ---------- 建议引擎（--suggest） ----------
// E: 两阶段哈希 —— 阶段1 只读 head；head 命中（同尺寸组≥2）才读 tail；tail 命中且 ≤32MB 才全哈希。
async function hashRange(p, start, len) {
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return crypto.createHash('sha256').update(bytesRead === len ? buf : buf.slice(0, bytesRead)).digest('hex');
  } finally { await fh.close().catch(function(){}); }
}

async function headHash(p, size) {
  return hashRange(p, 0, Math.min(DUP_HEAD, size));
}

async function tailHash(p, size) {
  return hashRange(p, Math.max(0, size - DUP_TAIL), Math.min(DUP_TAIL, size));
}

async function fullHash(p) {
  const h = crypto.createHash('sha256');
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let pos = 0;
    while (true) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      h.update(bytesRead === buf.length ? buf : buf.slice(0, bytesRead));
      pos += bytesRead;
    }
    return h.digest('hex');
  } finally { await fh.close().catch(function(){}); }
}

// B: 并发分组哈希。items: [{f, size}]，step: 'head'|'tail'|'full'。
// 返回 Map<key, files[]>，仅保留组内 ≥2 的组。
async function hashGroup(items, step) {
  const map = new Map();
  await pool(items, async function(t) {
    let h;
    try {
      if (step === 'head') h = await headHash(t.f.path, t.size);
      else if (step === 'tail') h = await tailHash(t.f.path, t.size);
      else h = await fullHash(t.f.path);
    } catch (e) { return; }
    const key = t.size + '|' + h;
    const arr = map.get(key);
    if (arr) arr.push(t.f); else map.set(key, [t.f]);
  });
  const out = [];
  for (const files of map.values()) if (files.length >= 2) out.push(files);
  return out;
}

async function buildSuggestions(junkArr, emptySample, emptyCount) {
  const s = [];
  // 1) 临时缓存清理（低风险）
  const tempLabels = ['用户临时目录', 'Windows 临时', 'Windows 预读取', 'Windows 更新缓存', '浏览器缓存', '缩略图缓存'];
  let tempBytes = 0;
  const tempItems = [];
  for (const j of junkArr) {
    if (tempLabels.indexOf(j.label) >= 0) { tempBytes += j.bytes; tempItems.push({ label: j.label, bytes: j.bytes, count: j.count }); }
  }
  if (tempBytes > 0) s.push({ type: 'junk-temp', title: '清理临时与缓存文件', risk: 'low', estBytes: tempBytes, items: tempItems, note: '临时文件/浏览器缓存/预读取等，删除后可重新生成' });
  // 2) 清空回收站（高-不可逆）
  const rb = junkArr.find(j => j.label === '回收站');
  if (rb && rb.bytes > 0) s.push({ type: 'recycle-bin', title: '清空回收站', risk: 'high-irreversible', estBytes: rb.bytes, items: [{ path: rb.label, bytes: rb.bytes, count: rb.count }], note: '永久删除，不可恢复' });
  // 3) 删除空文件夹（低）
  if (emptyCount > 0) s.push({ type: 'empty-dirs', title: '删除空文件夹', risk: 'low', estBytes: 0, count: emptyCount, items: emptySample.slice(0, 100).map(p => ({ path: p })), note: '共 ' + emptyCount + ' 个空文件夹' });
  // 4) 重复文件（中）—— 两阶段哈希 + 并发（A/B/C/E）
  const dupGroups = [];
  const sizeBuckets = [];
  for (const [size, list] of bySize) if (list.length >= 2) sizeBuckets.push({ size: size, list: list });
  if (sizeBuckets.length > 0) {
    const headItems = [];
    for (const b of sizeBuckets) for (const f of b.list) headItems.push({ f: f, size: b.size });
    const headGroups = await hashGroup(headItems, 'head');
    // head 命中组：size ≤ 64KB 时 head 已覆盖全文件 → 直接算重复组；否则进入 tail
    // （64KB < size ≤ 128KB 时 head 覆盖 [0,64KB)，tail 覆盖 [size-64KB,size)，二者拼合覆盖全文件）
    const tailItems = [];
    for (const g of headGroups) {
      if (g[0].size <= DUP_HEAD) { dupGroups.push(g); continue; }
      for (const f of g) tailItems.push({ f: f, size: f.size });
    }
    if (tailItems.length > 0) {
      const tailGroups = await hashGroup(tailItems, 'tail');
      // tail 命中组：≤32MB 全哈希确认；>32MB 视为重复（head+tail 已足够）
      const fullItems = [];
      for (const g of tailGroups) {
        if (g[0].size <= DUP_FULL_LIMIT) { for (const f of g) fullItems.push({ f: f, size: f.size }); }
        else dupGroups.push(g);
      }
      if (fullItems.length > 0) {
        const fullGroups = await hashGroup(fullItems, 'full');
        for (const g of fullGroups) dupGroups.push(g);
      }
    }
  }
  // 仅保留用户区可安全删除的重复（Downloads/Documents/Desktop/Pictures 等），保留路径最短者
  const removable = [];
  let dupBytes = 0;
  for (const g of dupGroups) {
    const userFiles = g.filter(f => isDedupZone(f.path));
    if (userFiles.length < 2) continue;
    userFiles.sort((a, b) => a.path.length - b.path.length);
    const keep = userFiles[0];
    const dups = userFiles.slice(1);
    dupBytes += dups.reduce((a, f) => a + f.size, 0);
    removable.push({ size: g[0].size, keep: keep.path, removable: dups.map(f => f.path) });
  }
  if (removable.length > 0) s.push({ type: 'duplicates', title: '删除重复文件', risk: 'medium', estBytes: dupBytes, groups: removable.slice(0, 50), note: '保留路径最短者，其余移入回收站（仅用户区）' });
  // 5) 大陈旧文件（中，非游戏库区）
  const staleLarge = staleFiles.filter(f => f.size >= STALE_LARGE_MIN).sort((a, b) => b.size - a.size);
  if (staleLarge.length > 0) s.push({ type: 'stale-large', title: '清理长期未使用的大文件', risk: 'medium', estBytes: staleLarge.reduce((a, f) => a + f.size, 0), items: staleLarge.slice(0, 50).map(f => ({ path: f.path, bytes: f.size, modified: f.modified })), note: '修改时间超过 730 天且 ≥ 500MB' });
  // 6) 卸载残留（高，需人工判断）
  s.push({ type: 'uninstall-orphans', title: '卸载残留检查', risk: 'high', estBytes: null, note: '检查 AppData/ProgramData 中已卸载程序的残留目录（需结合注册表交叉验证，建议人工确认）' });
  // 7) 创建时间久远的历史目录（低，仅用户区）
  const oldDirs = [];
  for (const [dir, rec] of dirOld) {
    if (rec.count < 2 || rec.count > 1000) continue;
    if (rec.oldCount === rec.count) {
      const agg = dirMap.get(low(dir));
      if (agg && agg.bytes > 0) oldDirs.push({ path: dir, bytes: agg.bytes, files: rec.count });
    }
  }
  oldDirs.sort((a, b) => b.bytes - a.bytes);
  if (oldDirs.length > 0) s.push({ type: 'created-old', title: '创建时间久远的历史目录', risk: 'low', estBytes: oldDirs.reduce((a, d) => a + d.bytes, 0), items: oldDirs.slice(0, 50).map(d => ({ path: d.path, bytes: d.bytes, files: d.files })), note: '目录内所有文件创建时间超过 730 天，可能是历史遗留' });
  // 8) 目录整理建议（散落目录：A 类可整理 / B 类仅提示）
  if (looseDirs.length > 0) {
    const loose = looseDirs.filter(d => d.kind === 'loose');
    const prog = looseDirs.filter(d => d.kind === 'program');
    const items = [];
    for (const d of loose.slice(0, 50)) items.push({ path: d.path, bytes: d.bytes, modified: d.modified, kind: 'loose', cat: d.cat, suggestDst: suggestDstOf(d) });
    for (const d of prog.slice(0, 50)) items.push({ path: d.path, bytes: d.bytes, modified: d.modified, kind: 'program', warn: '移动将导致快捷方式失效；如需移动请使用 fixShortcuts 自动重写桌面/开始菜单/任务栏快捷方式' });
    s.push({ type: 'organize-folders', title: '目录整理建议', risk: 'low', estBytes: loose.reduce((a, d) => a + d.bytes, 0), items: items, note: '散落目录检测（修改 >30 天 且 ≥100MB）：loose 类可归入 <盘>:\\整理区\\<分类>\\；program 类为程序/游戏目录仅提示（移动会破坏安装），可配合 fixShortcuts 移动并自动重写快捷方式。可用 disk_organize plan 生成整理计划' });
  }
  s.sort((a, b) => (b.estBytes || 0) - (a.estBytes || 0));
  return s;
}

function suggestDstOf(d) {
  const m = d.path.match(/^([A-Za-z]):/);
  const drv = m ? m[1].toUpperCase() : 'C';
  const name = d.path.split(/[\\/]+/).filter(Boolean).pop() || '未命名';
  return drv + ':\\整理区\\' + d.cat + '\\' + name;
}

// 散落目录分析：阈值过滤（大小/修改时间）+ 浅层扫描（程序特征 / 主导分类）
async function analyzeLooseDirs() {
  if (looseCandidates.length === 0) return;
  const seen = new Set();
  const uniq = [];
  for (const c of looseCandidates) {
    const k = low(c.path);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  await pool(uniq, async function(c) {
    let st;
    try { st = await fsp.stat(c.path); } catch (e) { return; }
    const agg = dirMap.get(low(c.path));
    const bytes = agg && agg.bytes ? agg.bytes : 0;
    const mtimeMs = st.mtimeMs || 0;
    if (bytes < LOOSE_MIN) return;   // 大小阈值
    if (now - mtimeMs < LOOSE_MS) return; // 修改时间阈值
    // 浅层扫描：程序特征计数 + 主导分类（直接子文件扩展名）
    let exeCount = 0, dirHits = 0;
    const catCount = {};
    try {
      const en = await fsp.readdir(c.path, { withFileTypes: true });
      for (const e of en) {
        if (e.isFile()) {
          const ext = extOf(e.name);
          if (PROG_EXT[ext]) exeCount++;
          const c2 = EXT_CAT[ext] || '其他';
          catCount[c2] = (catCount[c2] || 0) + 1;
        } else if (e.isDirectory() && PROG_DIR_HINTS.indexOf(low(e.name)) >= 0) {
          dirHits++;
        }
      }
    } catch (e) { /* 权限：按已收集信息判定 */ }
    // 程序/游戏目录判定：浅层 ≥3 个可执行文件 / 含典型子目录 / 盘根目录名匹配程序特征
    const n = low(c.name);
    const nameHint = c.zone === 'drive' && PROG_NAME_HINTS.some(function(h) {
      return (h.length >= 4 && n.indexOf(h) >= 0) || n.split(/[^a-z0-9\u4e00-\u9fa5]+/).indexOf(h) >= 0;
    });
    const kind = (exeCount >= 3 || dirHits > 0 || nameHint) ? 'program' : 'loose';
    let cat = '其他', best = 0;
    for (const k2 of Object.keys(catCount)) if (catCount[k2] > best) { best = catCount[k2]; cat = k2; }
    cat = ORG_CAT_MAP[cat] || '其他';
    looseDirs.push({ path: c.path, bytes: bytes, modified: new Date(mtimeMs).toISOString().slice(0, 10), kind: kind, cat: cat });
  });
  looseDirs.sort(function(a, b) { return b.bytes - a.bytes });
}

// ---------- Markdown 报告生成 ----------
function fmtBytesMD(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}
function mdBar(ratio, width) {
  const w = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(w) + '░'.repeat(width - w);
}
function buildMarkdown(out, elapsedMs) {
  const sm = out.summary || {};
  const L = [];
  L.push('# 磁盘扫描报告');
  L.push('');
  L.push('> 生成时间：' + (sm.scannedAt || '—') + ' ｜ 耗时：' + (elapsedMs ? (elapsedMs / 1000).toFixed(1) + ' 秒' : '—') + ' ｜ 状态：' + (sm.status || '—'));
  L.push('');
  L.push('## 概览');
  L.push('');
  L.push('| 项目 | 数值 |');
  L.push('|---|---|');
  L.push('| 扫描范围 | ' + ((sm.roots || []).join('、') || '—') + ' |');
  L.push('| 总大小 | ' + fmtBytesMD(sm.totalBytes || 0) + ' |');
  L.push('| 文件数 | ' + (sm.totalFiles || 0) + ' |');
  L.push('| 目录数 | ' + (sm.totalDirs || 0) + ' |');
  L.push('| 空目录 | ' + (sm.emptyDirs || 0) + ' |');
  L.push('| 应用/游戏库 | ' + fmtBytesMD(sm.appZoneBytes || 0) + '（' + (sm.appZoneFiles || 0) + ' 个文件，仅统计不深度分析） |');
  const sk = sm.skipped || {};
  const skKeys = Object.keys(sk).filter(k2 => sk[k2]);
  if (skKeys.length > 0) L.push('| 跳过 | ' + skKeys.map(k2 => k2 + ':' + sk[k2]).join('，') + ' |');
  L.push('');
  const cat = (out.category || []).slice(0, 15);
  const catRest = (out.category || []).slice(15).reduce((a, c) => a + (c.bytes || 0), 0);
  if (cat.length > 0) {
    L.push('## 类别统计');
    L.push('');
    L.push('| 类别 | 文件数 | 大小 | 占比 |');
    L.push('|---|---|---|---|');
    const total = sm.totalBytes || 1;
    for (const c of cat) {
      const pct = c.bytes / total;
      L.push('| ' + c.label + ' | ' + (c.count || 0) + ' | ' + fmtBytesMD(c.bytes) + ' | ' + mdBar(pct, 12) + ' ' + (pct * 100).toFixed(1) + '% |');
    }
    if (catRest > 0) L.push('| 其他类别 | — | ' + fmtBytesMD(catRest) + ' | — |');
    L.push('');
  }
  const tf = (out.topFiles || []).slice(0, 10);
  if (tf.length > 0) {
    L.push('## 大文件 Top 10');
    L.push('');
    L.push('| # | 文件 | 大小 |');
    L.push('|---|---|---|');
    tf.forEach((f, i) => L.push('| ' + (i + 1) + ' | `' + f.path + '` | ' + fmtBytesMD(f.bytes) + ' |'));
    L.push('');
  }
  const td = (out.topDirs || []).slice(0, 10);
  if (td.length > 0) {
    L.push('## 大目录 Top 10');
    L.push('');
    L.push('| # | 目录 | 大小 | 文件 |');
    L.push('|---|---|---|---|');
    td.forEach((d, i) => L.push('| ' + (i + 1) + ' | `' + d.path + '` | ' + fmtBytesMD(d.bytes) + ' | ' + (d.files || 0) + ' |'));
    L.push('');
  }
  const sugg = out.suggestions || [];
  if (sugg.length > 0) {
    L.push('## 智能建议（' + sugg.length + ' 类）');
    L.push('');
    sugg.forEach((s, i) => {
      L.push('### ' + (i + 1) + '. ' + (s.title || s.type) + (s.risk ? '（风险：' + s.risk + '）' : ''));
      if (s.note) L.push('');
      if (s.note) L.push(s.note);
      if (s.estBytes != null) { L.push(''); L.push('- 涉及大小：' + fmtBytesMD(s.estBytes)); }
      if (s.type === 'organize-folders' && Array.isArray(s.items) && s.items.length > 0) {
        L.push('');
        L.push('| 目录 | 大小 | 修改日期 | 类型 | 去向/提示 |');
        L.push('|---|---|---|---|---|');
        for (const it of s.items) {
          const kind = it.kind === 'program' ? '⚠ 程序目录' : '✅ 可整理';
          const dst = it.kind === 'program' ? (it.warn || '仅提示，不移动') : ('→ `' + (it.suggestDst || '') + '`');
          L.push('| `' + it.path + '` | ' + fmtBytesMD(it.bytes) + ' | ' + (it.modified || '—') + ' | ' + kind + ' | ' + dst + ' |');
        }
      } else if (s.type === 'duplicates' && Array.isArray(s.groups) && s.groups.length > 0) {
        L.push('');
        L.push('| 保留 | 可删除数 | 每组大小 |');
        L.push('|---|---|---|');
        for (const g of s.groups.slice(0, 10)) {
          L.push('| `' + g.keep + '` | ' + (g.removable ? g.removable.length : 0) + ' 个 | ' + fmtBytesMD(g.size) + ' |');
        }
      } else if (Array.isArray(s.items) && s.items.length > 0 && s.items[0].path !== undefined) {
        L.push('');
        L.push('| 路径 | 大小 |');
        L.push('|---|---|');
        for (const it of s.items.slice(0, 20)) {
          L.push('| `' + it.path + '` | ' + (it.bytes != null ? fmtBytesMD(it.bytes) : '—') + ' |');
        }
      } else if (Array.isArray(s.items) && s.items.length > 0 && s.items[0].label !== undefined) {
        L.push('');
        L.push('| 项目 | 大小 |');
        L.push('|---|---|');
        for (const it of s.items.slice(0, 20)) {
          L.push('| ' + it.label + ' | ' + fmtBytesMD(it.bytes) + ' |');
        }
      }
      L.push('');
    });
  }
  L.push('---');
  L.push('*由磁盘分析助手生成。完整 JSON 建议明细见同目录 .json 报告文件。*');
  return L.join('\n');
}

// ---------- 快捷方式修复（--fix-shortcuts / --restore-shortcuts） ----------
// 扫描桌面/开始菜单/任务栏固定中的 .lnk，把指向被移动目录的快捷方式重写到新路径（PowerShell WScript.Shell COM）
const LNK_ROOTS = (function() {
  const out = [];
  const env = process.env;
  if (env.USERPROFILE) out.push(env.USERPROFILE + '\\Desktop');
  if (env.PUBLIC) out.push(env.PUBLIC + '\\Desktop');
  if (env.APPDATA) out.push(env.APPDATA + '\\Microsoft\\Windows\\Start Menu\\Programs');
  if (env.ProgramData) out.push(env.ProgramData + '\\Microsoft\\Windows\\Start Menu\\Programs');
  if (env.APPDATA) out.push(env.APPDATA + '\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar');
  return out.filter(Boolean);
})();
function collectLnkFiles() {
  const out = [];
  for (const root of LNK_ROOTS) {
    const stack = [root];
    while (stack.length > 0 && out.length < 4000) {
      const d = stack.pop();
      let en;
      try { en = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of en) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { stack.push(p); }
        else if (e.isFile() && low(e.name).endsWith('.lnk')) out.push(p);
      }
    }
  }
  return out;
}
function psB64(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}
function escPSStr(s) {
  return String(s).replace(/'/g, "''");
}
function runPS(script) {
  const cp = require('child_process');
  return cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psB64(script)], { encoding: 'utf8', maxBuffer: 16 << 20, windowsHide: true }) || '';
}
function psDataFile(obj) {
  // 数据写入临时文件，PowerShell 从文件读取（避免 -EncodedCommand 超长）
  const os = require('os');
  const tmpFile = path.join(os.tmpdir(), 'dsk-psdata-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.json');
  fs.writeFileSync(tmpFile, JSON.stringify(obj), 'utf8');
  return tmpFile;
}
async function fixShortcuts(pairs) {
  // pairs: [{src, dst}] —— 把 TargetPath 前缀为 src 的 .lnk 重写到 dst
  const lnks = collectLnkFiles();
  if (lnks.length === 0) return { ok: true, scanned: 0, fixed: [] };
  const tmpFile = psDataFile({ pairs: pairs, lnks: lnks });
  const resFile = tmpFile + '.out.json';
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$sh = New-Object -ComObject WScript.Shell',
    "$data = Get-Content -Raw -Encoding UTF8 -LiteralPath '" + escPSStr(tmpFile) + "' | ConvertFrom-Json",
    '$fixed = @()',
    'foreach ($lnk in $data.lnks) {',
    '  try {',
    '    $s = $sh.CreateShortcut($lnk)',
    '    $t = [string]$s.TargetPath',
    '    if (-not $t) { continue }',
    '    $t2 = [Environment]::ExpandEnvironmentVariables($t)',
    '    $newTarget = $t2',
    '    $hit = $false',
    '    foreach ($p in $data.pairs) {',
    '      $src = [string]$p.src',
    "      if ($src -and $t2.Length -ge $src.Length -and $t2.Substring(0, $src.Length) -eq $src -and ($t2.Length -eq $src.Length -or $t2.Substring($src.Length, 1) -eq '\\')) {",
    "        $newTarget = ([string]$p.dst).TrimEnd('\\') + $t2.Substring($src.Length)",
    '        $s.TargetPath = $newTarget',
    '        $s.Save()',
    '        $hit = $true',
    '        break',
    '      }',
    '    }',
    '    if ($hit) { $fixed += [pscustomobject]@{ lnk = $lnk; oldTarget = $t; newTarget = $newTarget; oldArgs = [string]$s.Arguments; oldWorkDir = [string]$s.WorkingDirectory; oldIcon = [string]$s.IconLocation } }',
    '  } catch { }',
    '}',
    "$json = $fixed | ConvertTo-Json -Compress -Depth 4",
    "$null = [System.IO.File]::WriteAllText('" + escPSStr(resFile) + "', $json, (New-Object System.Text.UTF8Encoding($false)))"
  ].join('\n');
  try {
    runPS(script);
    let fixed = [];
    try {
      const raw = fs.readFileSync(resFile, 'utf8').trim();
      if (raw) { fixed = JSON.parse(raw); if (!Array.isArray(fixed)) fixed = fixed ? [fixed] : []; }
    } catch (e) { fixed = []; }
    return { ok: true, scanned: lnks.length, fixed: fixed };
  } catch (e) {
    return { ok: false, error: '快捷方式修复失败：' + (e && e.message ? e.message : String(e)), scanned: lnks.length, fixed: [] };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(resFile); } catch (e) { /* ignore */ }
  }
}
async function restoreShortcuts(fixes) {
  // fixes: [{lnk, oldTarget, oldArgs, oldWorkDir, oldIcon}] —— 写回旧目标
  if (!fixes || fixes.length === 0) return { ok: true, restored: 0 };
  const tmpFile = psDataFile(fixes);
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$sh = New-Object -ComObject WScript.Shell',
    "$fixes = Get-Content -Raw -Encoding UTF8 -LiteralPath '" + escPSStr(tmpFile) + "' | ConvertFrom-Json",
    '$ok = 0',
    'foreach ($f in $fixes) {',
    '  try {',
    '    $s = $sh.CreateShortcut([string]$f.lnk)',
    '    if ($f.oldTarget) { $s.TargetPath = [string]$f.oldTarget }',
    "    $s.Arguments = if ($f.oldArgs) { [string]$f.oldArgs } else { '' }",
    '    if ($f.oldWorkDir) { $s.WorkingDirectory = [string]$f.oldWorkDir }',
    '    if ($f.oldIcon) { $s.IconLocation = [string]$f.oldIcon }',
    '    $s.Save()',
    '    $ok++',
    '  } catch { }',
    '}',
    "Write-Output ('RESTORED ' + $ok)"
  ].join('\n');
  try {
    const out = runPS(script);
    const m = out.match(/RESTORED\s+(\d+)/);
    return { ok: true, restored: m ? Number(m[1]) : 0 };
  } catch (e) {
    return { ok: false, error: '快捷方式恢复失败：' + (e && e.message ? e.message : String(e)) };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
  }
}

async function main() {
  resetState();
  roots = (opt('--roots', '') || '').split(';').filter(Boolean);
  excludes = (opt('--exclude', '') || '').split(';').map(s => s && s.toLowerCase()).filter(Boolean);
  progressFile = opt('--progress', '') || '';
  reportFile = opt('--report', '') || '';
  withTime = args.indexOf('--time') >= 0;
  suggestMode = args.indexOf('--suggest') >= 0;
  // 规则配置文件覆盖（阈值 + exclude 白名单）
  try {
    const cfgLib = require('./config.js');
    const cfg = cfgLib.load(opt('--config', ''));
    if (cfg) {
      const t = cfg.thresholds || {};
      if (t.staleMinDays) STALE_MS = Number(t.staleMinDays) * DAYS;
      if (t.staleMinBytes) STALE_LARGE_MIN = Number(t.staleMinBytes);
      if (t.dupMinBytes) DUP_MIN_SIZE = Number(t.dupMinBytes);
      if (t.looseMinDays) LOOSE_MS = Number(t.looseMinDays) * DAYS;
      if (t.looseMinBytes) LOOSE_MIN = Number(t.looseMinBytes);
      const exP = cfgLib.normPrefixes(cfg.exclude);
      if (exP.length) excludes = excludes.concat(exP);
    }
  } catch (e) { /* 配置加载失败按默认值运行 */ }
  const t0 = Date.now();
  const modeDir = opt('--dir', '');
  const modeOrganize = args.indexOf('--organize') >= 0;
  if (modeOrganize) {
    // 整理模式：执行 [{src,dst}] 移动（同盘 rename；跨盘 copy+unlink），
    // 追加写入映射文件（供回滚），输出结果。
    const planFile = opt('--plan', '');
    const mapFile = opt('--map', '');
    if (!planFile || !mapFile) return { exitCode: 1, error: '缺少 --plan/--map 参数' };
    let plan;
    try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch (e) { return { exitCode: 1, error: '无法读取整理计划: ' + (e.message || e) }; }
    if (!Array.isArray(plan) || plan.length === 0) return { exitCode: 1, error: '整理计划为空' };
    const DANGER = ['\\windows\\', '\\program files\\', '\\program files (x86)\\', '\\programdata\\', '\\winsxs\\', '\\system volume information\\', '\\$recycle.bin\\'];
    const moved = [], failed = [];
    async function existsP(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }
    // 确保目标父目录存在：已存在（含盘根）时跳过 mkdir——对盘根 recursive mkdir 会抛 EPERM
    async function ensureParent(dst) {
      const parent = path.dirname(dst);
      try {
        const s = await fsp.stat(parent);
        if (s.isDirectory()) return;
      } catch (e) { /* 不存在则创建 */ }
      await fsp.mkdir(parent, { recursive: true });
    }
    async function movePath(src, dst, st) {
      const sameRoot = path.parse(src).root.toLowerCase() === path.parse(dst).root.toLowerCase();
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          if (sameRoot) {
            try {
              await fsp.rename(src, dst);
            } catch (e1) {
              if (await existsP(dst)) throw e1; // dst 已存在禁止 fallback（避免复制合并）
              if (st.isDirectory()) {
                await fsp.cp(src, dst, { recursive: true });
                await fsp.rm(src, { recursive: true });
              } else {
                await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
                await fsp.unlink(src);
              }
            }
          } else if (st.isDirectory()) {
            // 跨盘目录：递归 copy + 删除源（Node ≥16.7 的 fs.cp）
            await fsp.cp(src, dst, { recursive: true });
            await fsp.rm(src, { recursive: true });
          } else {
            await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
            await fsp.unlink(src);
          }
          return;
        } catch (e) {
          if (attempt >= 4) throw e;
          // 瞬时锁（Defender/索引服务扫描）等待后重试——窗口逐步加大，避免反复触发扫描
          await new Promise(function(r) { setTimeout(r, 2000 * attempt) });
        }
      }
    }
    for (const item of plan) {
      const src = item && item.src, dst = item && item.dst;
      if (!src || !dst || src === dst) { failed.push({ src: src, dst: dst, reason: '无效路径' }); continue; }
      const dl = String(dst).toLowerCase();
      const sl = String(src).toLowerCase();
      if (DANGER.some(p => dl.indexOf(p) >= 0 || sl.indexOf(p) >= 0)) { failed.push({ src: src, dst: dst, reason: '涉及系统目录' }); continue; }
      try {
        await fsp.access(src);
        if (await existsP(dst)) { failed.push({ src: src, dst: dst, reason: '目标已存在' }); continue; }
        await ensureParent(dst);
        const st = await fsp.stat(src);
        await movePath(src, dst, st);
        moved.push({ src: src, dst: dst });
      } catch (e) {
        failed.push({ src: src, dst: dst, reason: (e && e.code) || (e && e.message) || String(e) });
      }
    }
    let map = [];
    try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); if (!Array.isArray(map)) map = []; } catch (e) { map = []; }
    // 仅当确有移动时才追加回滚记录（空批次不写，避免污染最后一批）
    if (moved.length > 0) {
      map.push({ ts: new Date().toISOString(), items: moved });
      try { fs.writeFileSync(mapFile, JSON.stringify(map, null, 2), 'utf8'); } catch (e) { /* 记录失败但不中止 */ }
    }
    return { exitCode: 0, data: { ok: true, movedCount: moved.length, failedCount: failed.length, moved: moved.slice(0, 200), failed: failed.slice(0, 50), mapFile: mapFile } };
  }
  const fixFile = opt('--fix-shortcuts', '');
  if (fixFile) {
    // 快捷方式修复模式：pairs [{src,dst}]，把指向 src 前缀的 .lnk 重写到 dst；
    // 修改记录追加到 --map 最后一批的 shortcuts 字段（供回滚恢复）。
    let pairs;
    try { pairs = JSON.parse(fs.readFileSync(fixFile, 'utf8')); } catch (e) { return { exitCode: 1, error: '无法读取快捷方式修复清单: ' + (e.message || e) }; }
    if (!Array.isArray(pairs) || pairs.length === 0) return { exitCode: 0, data: { ok: true, scanned: 0, fixed: [], note: '无修复项' } };
    const r = await fixShortcuts(pairs);
    const mapFile2 = opt('--map', '');
    if (mapFile2 && Array.isArray(r.fixed) && r.fixed.length > 0) {
      try {
        let map = [];
        try { map = JSON.parse(fs.readFileSync(mapFile2, 'utf8')); if (!Array.isArray(map)) map = []; } catch (e) { map = []; }
        if (map.length > 0) {
          const last = map[map.length - 1];
          if (!last.shortcuts) last.shortcuts = [];
          last.shortcuts = last.shortcuts.concat(r.fixed);
          fs.writeFileSync(mapFile2, JSON.stringify(map, null, 2), 'utf8');
        }
      } catch (e) { /* 记录失败但不中止 */ }
    }
    return { exitCode: 0, data: r };
  }
  const restoreFile = opt('--restore-shortcuts', '');
  if (restoreFile) {
    let fixes;
    try { fixes = JSON.parse(fs.readFileSync(restoreFile, 'utf8')); } catch (e) { return { exitCode: 1, error: '无法读取恢复清单: ' + (e.message || e) }; }
    const r = await restoreShortcuts(Array.isArray(fixes) ? fixes : []);
    return { exitCode: 0, data: r };
  }
  if (modeDir) {
    // 下钻模式：输出目标目录的直接子目录聚合 + 直接子文件列表
    await walk(modeDir, splitSegs(modeDir), 0, false);
    const base = low(modeDir).replace(/[\\/]+$/, '');
    const prefix = base + '\\';
    const direct = [];
    dirMap.forEach(function(v, k) {
      if (k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf('\\') < 0) direct.push({ name: v.path.slice(v.path.lastIndexOf('\\') + 1), bytes: v.bytes, files: v.files, dirs: v.dirs, cat: v.cat });
    });
    direct.sort((a, b) => b.bytes - a.bytes);
    let fileEntries = [];
    try {
      const en = await fsp.readdir(modeDir, { withFileTypes: true });
      for (const e of en) {
        if (e.isFile()) {
          let st;
          try { st = await fsp.stat(path.join(modeDir, e.name)); } catch (err) { continue; }
          fileEntries.push({ name: e.name, bytes: st.size });
        }
      }
    } catch (e) { /* 权限 */ }
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
      out.organizeCandidates = looseDirs.filter(d => d.kind === 'loose').slice(0, LOOSE_MAX).map(d => ({ path: d.path, bytes: d.bytes, modified: d.modified, cat: d.cat, suggestDst: suggestDstOf(d) }));
    } catch (e) {
      out.suggestions = [];
      out.suggestError = e && e.message ? e.message : String(e);
    }
  }
  if (progressFile) { try { fs.writeFileSync(progressFile, JSON.stringify({ done: true, files: stats.files, dirs: stats.dirs, bytes: stats.bytes }), 'utf8'); } catch (e) {} }
  // G: 完整 JSON 落盘（避免超大输出经工具通道截断/损坏），stdout 只输出摘要
  if (reportFile) {
    try { fs.writeFileSync(reportFile, JSON.stringify(out), 'utf8'); } catch (e) { out.reportWriteError = e && e.message ? e.message : String(e); }
    // G2: 同时生成可读 Markdown 报告（对话/文档直接渲染）
    try {
      const md = buildMarkdown(out, out.elapsedMs || 0);
      const mdFile = reportFile.replace(/\.json$/i, '') + '.md';
      fs.writeFileSync(mdFile, md, 'utf8');
      out.mdFile = mdFile;
    } catch (e) { out.mdError = e && e.message ? e.message : String(e); }
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
    appZoneFiles: stats.appZoneFiles, appZoneBytes: stats.appZoneBytes,
    organizeCounts: { loose: looseDirs.filter(d => d.kind === 'loose').length, program: looseDirs.filter(d => d.kind === 'program').length }
  };
  return { exitCode: cancelled ? 3 : 0, data: compact };
}

// ---------- 入口：模块 require 与直接执行 ----------
async function run(argv) {
  args = argv || process.argv.slice(2);
  return main();
}
module.exports = { run, main, buildMarkdown, analyzeLooseDirs, EXT_CAT };

if (require.main === module) {
  run(process.argv.slice(2)).then(res => {
    if (res && res.error) {
      process.stdout.write('\n' + JSON.stringify({ ok: false, error: res.error }));
    } else {
      process.stdout.write('\n' + JSON.stringify(res.data));
    }
    process.exit(res && res.exitCode ? res.exitCode : 0);
  }).catch(e => {
    process.stderr.write('HELPER_ERROR: ' + (e && e.stack ? e.stack : String(e)));
    process.exit(2);
  });
}
