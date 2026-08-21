// dsk-helper.js — 磁盘分析辅助进程（原生 fs 遍历，不受 ctx.fs 工作区限制）
// 用法:
//   node dsk-helper.js --roots "C:\;D:\" --exclude "x;y" --progress <file> [--time]
//   node dsk-helper.js --dir <path>          # 下钻模式
//   node dsk-helper.js --roots ... --suggest # 扫描 + 生成 8 类建议（含重复文件哈希检测、目录整理建议）
// 输出: 最后一行 stdout = 聚合 JSON；stderr 写日志/进度
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// ---------- 参数 ----------
const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined ? def : v;
}
const roots = (opt('--roots', '') || '').split(';').filter(Boolean);
const excludes = (opt('--exclude', '') || '').split(';').map(s => s && s.toLowerCase()).filter(Boolean);
const progressFile = opt('--progress', '') || '';
const reportFile = opt('--report', '') || '';
const withTime = args.indexOf('--time') >= 0;
const suggestMode = args.indexOf('--suggest') >= 0;

// 规则单源：所有规则表与阈值默认值来自 dsk-rules.js（由 lib/rules.js 生成）
const Rules = require('./dsk-rules.js');
const { DAYS, DUP_FULL_LIMIT, DUP_HEAD, DUP_TAIL, WIDE_MAX_FILES, WIDE_MAX_BYTES, LOOSE_MAX, MAX_DEPTH, CONCURRENCY,
  EXT_CAT, EXT_JUNK, DIR_CAT_RULES, JUNK_RULES, AUTO_SKIP, USER_ZONE_SEGS, APP_ZONE_SEGS, DRIVE_ROOT_SKIP,
  PROG_NAME_HINTS, PROG_DIR_HINTS, PROG_EXT, ORG_CAT_MAP } = Rules;
const STALE_MS = Rules.DEFAULTS.STALE_MS;
const STALE_LARGE_MIN = Rules.DEFAULTS.STALE_LARGE_MIN;
const DUP_MIN_SIZE = Rules.DEFAULTS.DUP_MIN_SIZE;
const LOOSE_MS = Rules.DEFAULTS.LOOSE_MS;
const LOOSE_MIN = Rules.DEFAULTS.LOOSE_MIN;

function low(s) { return String(s || '').toLowerCase() }
function isDedupZone(p) {
  const segs = splitSegs(p);
  return segs.some(s => USER_ZONE_SEGS.indexOf(s) >= 0);
}
// 扩展查重范围：扫描根浅层（目录深度 ≤2，即盘根第一层及其直接子目录），
// 排除程序/游戏特征命名与系统段 —— 数据盘没有用户区时的 fallback，否则重复检测必然为空
function wideDedupEligible(segs) {
  if (segs.length > 2) return false;
  for (const s of segs) {
    const n = low(s);
    if (n.charAt(0) === '$' || n === 'system volume information') return false;
    if (PROG_NAME_HINTS.indexOf(n) >= 0) return false;
  }
  return true;
}
function isAppZone(segs) {
  return segs.some(s => APP_ZONE_SEGS.indexOf(s) >= 0);
}
function splitSegs(p) { return low(p).replace(/^[a-z]:[\\/]/, '').replace(/^[a-z]:/, '').split(/[\\/]+/).filter(Boolean) }
function extOf(name) { const i = name.lastIndexOf('.'); if (i <= 0 || i === name.length - 1) return ''; return low(name.slice(i + 1)) }
function classifyDir(segs) { for (const r of DIR_CAT_RULES) for (const s of r.segs) if (segs.indexOf(s) >= 0) return r.cat; return '其他' }
function junkFor(segs, ext) { for (const r of JUNK_RULES) if (r.match(segs)) return r.label; return EXT_JUNK[ext] || null }

// ---------- 状态 ----------
let cancelled = false;
process.on('SIGTERM', function() { cancelled = true });
const visited = new Set();
const dirMap = new Map();
const stats = {
  files: 0, dirs: 0, bytes: 0, emptyDirs: 0, currentPath: '',
  skipped: { permission: 0, cycle: 0, protected: 0, excluded: 0, deep: 0, error: 0 },
  appZoneFiles: 0, appZoneBytes: 0
};
const results = {
  fileCat: {}, fileCatCount: {}, ext: {}, junk: {}, junkCount: {},
  topFiles: [], emptyDirs: [], createdBuckets: {}, modifiedBuckets: {}
};
// 建议模式数据
const bySize = new Map();      // size -> [{path, size}]（仅用户区且 ≥1MB）
const bySizeWide = new Map();  // size -> [{path, size, wide}] 扩展候选：扫描根浅层非程序目录
let wideCount = 0;             // 扩展候选已收集文件数（封顶防哈希阶段卡顿）
let userZoneSeen = false;      // 本次扫描是否见过用户区目录（报告 dupScan 用）
const junkPaths = new Map();   // junk label -> Set<dir|file path>（一键清理用的真实路径样本）
const staleFiles = [];         // {path, size, mtimeMs} 修改时间超阈值（非游戏库区）
const dirOld = new Map();      // dir -> {count, oldCount}（目录内创建时间统计，仅用户区）
const looseCandidates = [];    // {path, name, zone:'drive'|'user'} 散落目录候选（walk 收集）
const looseDirs = [];          // {path, bytes, modified, kind:'loose'|'program', cat} 分析结果
const now = Date.now();
let lastProg = 0;

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
      if (jl) {
        results.junk[jl] = (results.junk[jl] || 0) + sz; results.junkCount[jl] = (results.junkCount[jl] || 0) + 1;
        if (suggestMode) {
          // 记录真实路径样本：目录型垃圾记目录，文件型垃圾（.dmp/.tmp）记文件本身
          let pset = junkPaths.get(jl);
          if (!pset) { pset = new Set(); junkPaths.set(jl, pset); }
          if (pset.size < 60) pset.add(EXT_JUNK[ext] ? path.join(dir, en.name) : dir);
        }
      }
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
        // 去重候选：① 用户区 ≥1MB（原有）；② 扫描根浅层（深度≤2）非程序目录 —— 数据盘无用户区时的 fallback
        let dz = null;
        if (sz >= DUP_MIN_SIZE) {
          if (isDedupZone(dir)) {
            dz = bySize; userZoneSeen = true;
          } else if (wideCount < WIDE_MAX_FILES && sz <= WIDE_MAX_BYTES && wideDedupEligible(segs)) {
            dz = bySizeWide; wideCount++;
          }
        }
        if (dz) {
          const item = { path: path.join(dir, en.name), size: sz };
          if (dz === bySizeWide) item.wide = true;
          const arr = dz.get(sz);
          if (arr) arr.push(item); else dz.set(sz, [item]);
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
      appZoneFiles: stats.appZoneFiles, appZoneBytes: stats.appZoneBytes,
      dupScan: suggestMode ? { userZoneSeen: userZoneSeen, wideCandidates: wideCount } : undefined
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
  if (tempBytes > 0) {
    const pset = new Set();
    for (const lb of tempLabels) { const ps = junkPaths.get(lb); if (ps) for (const p of ps) pset.add(p); }
    s.push({ type: 'junk-temp', title: '清理临时与缓存文件', risk: 'low', estBytes: tempBytes, items: tempItems, paths: Array.from(pset).slice(0, 300), note: '临时文件/浏览器缓存/预读取等，删除后可重新生成' });
  }
  // 2) 清空回收站（高-不可逆）
  const rb = junkArr.find(j => j.label === '回收站');
  if (rb && rb.bytes > 0) s.push({ type: 'recycle-bin', title: '清空回收站', risk: 'high-irreversible', estBytes: rb.bytes, items: [{ path: rb.label, bytes: rb.bytes, count: rb.count }], note: '永久删除，不可恢复' });
  // 3) 删除空文件夹（低）
  if (emptyCount > 0) s.push({ type: 'empty-dirs', title: '删除空文件夹', risk: 'low', estBytes: 0, count: emptyCount, items: emptySample.slice(0, 100).map(p => ({ path: p })), note: '共 ' + emptyCount + ' 个空文件夹' });
  // 4) 重复文件（中）—— 两阶段哈希 + 并发（A/B/C/E）；候选 = 用户区 ∪ 扫描根浅层扩展
  const combined = new Map();
  for (const m of [bySize, bySizeWide]) {
    for (const [size, list] of m) {
      const arr = combined.get(size);
      if (arr) arr.push.apply(arr, list); else combined.set(size, list.slice());
    }
  }
  const dupGroups = [];
  const sizeBuckets = [];
  for (const [size, list] of combined) if (list.length >= 2) sizeBuckets.push({ size: size, list: list });
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
  // 仅保留可安全删除的重复：用户区文件，或浅层扩展候选（wide）；保留路径最短者
  const removable = [];
  let dupBytes = 0;
  for (const g of dupGroups) {
    const elig = g.filter(f => isDedupZone(f.path) || f.wide);
    if (elig.length < 2) continue;
    elig.sort((a, b) => a.path.length - b.path.length);
    const keep = elig[0];
    const dups = elig.slice(1);
    dupBytes += dups.reduce((a, f) => a + f.size, 0);
    removable.push({ size: g[0].size, keep: keep.path, removable: dups.map(f => f.path), scope: isDedupZone(keep.path) ? 'user' : 'wide' });
  }
  if (removable.length > 0) s.push({ type: 'duplicates', title: '删除重复文件', risk: 'medium', estBytes: dupBytes, groups: removable.slice(0, 50), note: '保留路径最短者，其余移入回收站（范围：用户区 + 扫描根浅层；全盘深度查重请用「深度查重」按钮）' });
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

(async () => {
  const t0 = Date.now();
  const modeDir = opt('--dir', '');
  const modeOrganize = args.indexOf('--organize') >= 0;
  if (modeOrganize) {
    // 整理模式：执行 [{src,dst}] 移动（同盘 rename；跨盘 copy+unlink），
    // 追加写入映射文件（供回滚），输出结果。
    const planFile = opt('--plan', '');
    const mapFile = opt('--map', '');
    if (!planFile || !mapFile) { process.stdout.write('\n' + JSON.stringify({ ok: false, error: '缺少 --plan/--map 参数' })); process.exit(1); }
    let plan;
    try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch (e) { process.stdout.write('\n' + JSON.stringify({ ok: false, error: '无法读取整理计划: ' + (e.message || e) })); process.exit(1); }
    if (!Array.isArray(plan) || plan.length === 0) { process.stdout.write('\n' + JSON.stringify({ ok: false, error: '整理计划为空' })); process.exit(1); }
    const DANGER = ['\\windows\\', '\\program files\\', '\\program files (x86)\\', '\\programdata\\', '\\winsxs\\', '\\system volume information\\', '\\$recycle.bin\\'];
    const moved = [], failed = [];
    async function existsP(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }
    for (const item of plan) {
      const src = item && item.src, dst = item && item.dst;
      if (!src || !dst || src === dst) { failed.push({ src: src, dst: dst, reason: '无效路径' }); continue; }
      const dl = String(dst).toLowerCase();
      const sl = String(src).toLowerCase();
      if (DANGER.some(p => dl.indexOf(p) >= 0 || sl.indexOf(p) >= 0)) { failed.push({ src: src, dst: dst, reason: '涉及系统目录' }); continue; }
      try {
        await fsp.access(src);
        if (await existsP(dst)) { failed.push({ src: src, dst: dst, reason: '目标已存在' }); continue; }
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        const st = await fsp.stat(src);
        const sameRoot = path.parse(src).root.toLowerCase() === path.parse(dst).root.toLowerCase();
        if (sameRoot) {
          // 同盘：rename 对文件与目录均适用
          await fsp.rename(src, dst);
        } else if (st.isDirectory()) {
          // 跨盘目录：递归 copy + 删除源（Node ≥16.7 的 fs.cp）
          await fsp.cp(src, dst, { recursive: true });
          await fsp.rm(src, { recursive: true });
        } else {
          await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
          await fsp.unlink(src);
        }
        moved.push({ src: src, dst: dst });
      } catch (e) {
        failed.push({ src: src, dst: dst, reason: (e && e.code) || (e && e.message) || String(e) });
      }
    }
    let map = [];
    try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); if (!Array.isArray(map)) map = []; } catch (e) { map = []; }
    map.push({ ts: new Date().toISOString(), items: moved });
    try { fs.writeFileSync(mapFile, JSON.stringify(map, null, 2), 'utf8'); } catch (e) { /* 记录失败但不中止 */ }
    process.stdout.write('\n' + JSON.stringify({ ok: true, movedCount: moved.length, failedCount: failed.length, moved: moved.slice(0, 200), failed: failed.slice(0, 50), mapFile: mapFile }));
    process.exit(0);
  }
  const fixFile = opt('--fix-shortcuts', '');
  if (fixFile) {
    // 快捷方式修复模式：pairs [{src,dst}]，把指向 src 前缀的 .lnk 重写到 dst；
    // 修改记录追加到 --map 最后一批的 shortcuts 字段（供回滚恢复）。
    let pairs;
    try { pairs = JSON.parse(fs.readFileSync(fixFile, 'utf8')); } catch (e) { process.stdout.write('\n' + JSON.stringify({ ok: false, error: '无法读取快捷方式修复清单: ' + (e.message || e) })); process.exit(1); }
    if (!Array.isArray(pairs) || pairs.length === 0) { process.stdout.write('\n' + JSON.stringify({ ok: true, scanned: 0, fixed: [], note: '无修复项' })); process.exit(0); }
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
    process.stdout.write('\n' + JSON.stringify(r));
    process.exit(0);
  }
  const restoreFile = opt('--restore-shortcuts', '');
  if (restoreFile) {
    let fixes;
    try { fixes = JSON.parse(fs.readFileSync(restoreFile, 'utf8')); } catch (e) { process.stdout.write('\n' + JSON.stringify({ ok: false, error: '无法读取恢复清单: ' + (e.message || e) })); process.exit(1); }
    const r = await restoreShortcuts(Array.isArray(fixes) ? fixes : []);
    process.stdout.write('\n' + JSON.stringify(r));
    process.exit(0);
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
    process.stdout.write('\n' + JSON.stringify({ ok: true, path: modeDir, dirs: direct.slice(0, 200), files: fileEntries.slice(0, 200) }));
    process.exit(0);
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
  process.stdout.write('\n' + JSON.stringify(compact));
  process.exit(cancelled ? 3 : 0);
})().catch(e => {
  process.stderr.write('HELPER_ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(2);
});
