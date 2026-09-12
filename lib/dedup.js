// lib/dedup.js — 全盘哈希去重检测（可选硬链接合并）
// 策略：遍历收集 >minBytes 文件（排除系统/程序目录）→ 按大小分组 →
//       head/tail 两阶段哈希 → 小文件全哈希确认 → 输出重复组 + 可释放空间。
// 硬链接合并默认关闭（--hardlink --yes 才执行），可回滚（保留原始文件先备份）。
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const guard = require('./guard.js');
const audit = require('./audit.js');

const DUP_MIN_DEFAULT = 1 << 20;        // 默认 ≥1MB
const HEAD_LEN = 64 * 1024;             // head 哈希长度
const TAIL_LEN = 64 * 1024;             // tail 哈希长度
const FULL_LIMIT = 32 * 1024 * 1024;    // ≤32MB 直接全哈希
const CONCURRENCY = 16;

// 排除的系统目录段（小写，命中任意即跳过该目录树）
const SKIP_SEGS = ['windows', 'program files', 'program files (x86)', 'programdata', 'winsxs',
  'system volume information', '$recycle.bin', 'recycler', 'system32', 'syswow64',
  'node_modules', '\\$extend', 'appdata', 'onedrive'];
const SKIP_APP_ZONE = ['steamapps', 'wegameapps', 'epic', 'battlenet', 'gog games'];

function low(s) { return String(s || '').toLowerCase(); }

function isSkip(segs) {
  for (const s of segs) {
    const l = low(s);
    if (SKIP_SEGS.indexOf(l) >= 0) return true;
    if (l.charAt(0) === '$') return true;
  }
  // 程序目录（第二层 Program Files 下的应用数据跳过？不——跳过 Program Files 本身）
  return false;
}

function hashRange(p, start, len) {
  return new Promise(function(resolve, reject) {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p, { start: start, end: start + Math.max(0, len - 1) });
    s.on('data', function(d) { h.update(d); });
    s.on('end', function() { resolve(h.digest('hex')); });
    s.on('error', reject);
  });
}
function hashFull(p) {
  return new Promise(function(resolve, reject) {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', function(d) { h.update(d); });
    s.on('end', function() { resolve(h.digest('hex')); });
    s.on('error', reject);
  });
}

async function pool(items, fn) {
  let i = 0;
  const workers = [];
  const limit = Math.min(CONCURRENCY, items.length);
  for (let w = 0; w < limit; w++) {
    workers.push((async function() {
      while (i < items.length) {
        const item = items[i++];
        try { await fn(item); } catch (e) { /* 单个失败跳过 */ }
      }
    })());
  }
  await Promise.all(workers);
}

// ---------- 扫描 ----------
// roots: ['C:\\','D:\\']；返回 { ok, groups, totalDupBytes, totalSaveBytes, scannedFiles, elapsedMs }
async function scan(roots, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const minBytes = opts.minBytes || DUP_MIN_DEFAULT;
  const bySize = new Map();   // size -> [{path, size}]
  let scannedFiles = 0;
  const skippedRoots = [];    // 被拒绝的扫描根（受保护树），见下方说明
  // 遍历收集
  async function walk(dir, segs) {
    if (isSkip(segs)) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e) { return; }
    const childDirs = [], files = [];
    for (const en of entries) {
      if (en.isDirectory()) childDirs.push(en);
      else if (en.isFile()) files.push(en);
    }
    // v0.7.0（v7-1）：此前这里对每个文件串行 await fsp.stat —— 全盘量级下成为纯等待。
    // 实测基准（1 万文件）：串行 292ms → 并发 71ms（4.1x）；外推 40 万文件约省 9 秒。
    // 复用本文件既有的 pool（CONCURRENCY=16），与 head/tail 哈希阶段的并发模型一致。
    await pool(files, async function (en) {
      const full = path.join(dir, en.name);
      let st;
      try { st = await fsp.stat(full); } catch (e) { return; }
      if (st.size < minBytes) return;
      const arr = bySize.get(st.size);
      if (arr) arr.push({ path: full, size: st.size });
      else bySize.set(st.size, [{ path: full, size: st.size }]);
      scannedFiles++;
    });
    await pool(childDirs, function(en) {
      return walk(path.join(dir, en.name), segs.concat(en.name));
    });
  }
  // 扫描根自身也必须校验（评审 A2）：旧实现对 root 传 segs=[]，
  // 于是 roots=['C:\\Windows\\System32\\drivers'] 会直接放行并开始哈希系统文件。
  // 注意：这里只做**安全闸门**判断（guard.isProtectedPath），不能复用遍历用的 isSkip——
  // isSkip 含 appdata/node_modules 等"扫描卫生"段，用它判根会把 %TEMP%
  // （位于 AppData 下）这类合法根整个跳过（本套件曾因此抓到该回归）。
  for (const r of roots) {
    const rl = String(r || '').toLowerCase();
    if (!rl || guard.isProtectedPath(rl)) { skippedRoots.push(String(r)); continue; }
    await walk(r, []);
  }
  // 分组确认
  const groups = [];
  const sizeCandidates = [];
  for (const [size, arr] of bySize) {
    if (arr.length > 1) sizeCandidates.push({ size: size, files: arr });
  }
  for (const c of sizeCandidates) {
    // head 哈希
    const headMap = new Map();
    await pool(c.files, async function(f) {
      try {
        const h = await hashRange(f.path, 0, Math.min(HEAD_LEN, f.size));
        f._head = h;
      } catch (e) { f._err = true; }
    });
    const byHead = new Map();
    for (const f of c.files) {
      if (f._err || !f._head) continue;
      const arr = byHead.get(f._head);
      if (arr) arr.push(f); else byHead.set(f._head, [f]);
    }
    for (const [head, arr] of byHead) {
      if (arr.length < 2) continue;
      // tail 哈希（>HEAD 的文件）
      const tailMap = new Map();
      await pool(arr, async function(f) {
        if (f.size > HEAD_LEN) {
          try { f._tail = await hashRange(f.path, Math.max(0, f.size - TAIL_LEN), TAIL_LEN); } catch (e) { f._err = true; }
        }
      });
      const byKey = new Map();
      for (const f of arr) {
        if (f._err) continue;
        const key = f.size > HEAD_LEN ? (f._tail || '') : head;
        const k2 = byKey.get(key);
        if (k2) k2.push(f); else byKey.set(key, [f]);
      }
      for (const [key, arr2] of byKey) {
        if (arr2.length < 2) continue;
        // 小文件全哈希确认；大文件 head+tail 视为近似重复
        if (arr2[0].size <= FULL_LIMIT) {
          const fullMap = new Map();
          await pool(arr2, async function(f) {
            try { f._full = await hashFull(f.path); } catch (e) { f._err = true; }
          });
          const byFull = new Map();
          for (const f of arr2) {
            if (f._err) continue;
            const k3 = byFull.get(f._full);
            if (k3) k3.push(f); else byFull.set(f._full, [f]);
          }
          for (const [fh, arr3] of byFull) {
            if (arr3.length > 1) {
              groups.push({ size: c.size, approx: false, files: arr3.map(function(f) { return { path: f.path, size: f.size }; }) });
            }
          }
        } else {
          groups.push({ size: c.size, approx: true, files: arr2.map(function(f) { return { path: f.path, size: f.size }; }) });
        }
      }
    }
  }
  // 汇总
  let totalDupBytes = 0, totalSaveBytes = 0;
  for (const g of groups) {
    totalDupBytes += g.size * g.files.length;
    totalSaveBytes += g.size * (g.files.length - 1);
  }
  groups.sort(function(a, b) { return b.size * b.files.length - a.size * a.files.length; });
  return {
    ok: true,
    groups: groups,
    skippedRoots: skippedRoots,
    totalDupBytes: totalDupBytes,
    totalSaveBytes: totalSaveBytes,
    scannedFiles: scannedFiles,
    elapsedMs: Date.now() - t0
  };
}

// ---------- 硬链接合并（可选，危险） ----------
// group: { files: [{path, size}] }；保留 files[0]，其余转硬链接指向 files[0]
// 需要：同卷（保证）、原文件删除 + 硬链接创建（NTFS 硬链接不能跨目录的目录项？可以跨目录同卷）
//
// 评审 A1（严重）：>32MB 的组只比对 head 64KB + tail 64KB 就标 approx:true
// （见上方 FULL_LIMIT 分支）。approx 组此前在 CLI / MCP / GUI 三条路径上都能被直接
// 合并成硬链接——而硬链接一旦建立，两个"内容不同"的文件就共用同一份数据，
// 改一即改二，且备份 .dsk-dup-bak 在成功后被删除 → **静默、不可逆的内容破坏**。
// 本函数是所有合并路径的唯一收口，因此在此处硬性拒绝 approx 组（fail-closed），
// 三个调用方无需各自过滤。
function approxRefusal(group) {
  return '该重复组仅经过 head+tail 各 64KB 抽样比对（approx=true），' +
    '大文件内容可能不同，拒绝建立硬链接（可能造成不可逆的内容损坏）。' +
    '请改用 clean duplicates（移入回收站，可恢复），或先用全量哈希确认。';
}

// 创建硬链接（v0.7.0 v7-2）。
//
// 此前每个 victim 都 spawnSync 一次 PowerShell New-Item，实测 **141ms/个** ——
// 1000 个 victim 要 ~2.4 分钟，且评审把它误估成 30–50 分钟。
// 实测发现 Node 内建 `fs.linkSync` 在本机直接可用（同 inode、nlink=2、共享数据），
// 耗时 **0ms**，于是这里改为原生优先 —— 不是"批量化 PowerShell"，而是**不再用 PowerShell**。
//
// 保留 PowerShell 回退：两者最终都调用 Win32 CreateHardLink，语义一致；
// 极少数环境/非 NTFS 卷上原生调用可能失败，回退可避免功能回归。
// 任何一条路径失败时，调用方都会把备份改回原位，**不会丢数据**。
function createHardlink(keep, victim) {
  try {
    fs.linkSync(keep, victim);   // fs.linkSync(existingPath, newPath)
    return { ok: true, via: 'fs.linkSync' };
  } catch (e) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'New-Item -ItemType HardLink -Path ' + JSON.stringify(victim) + ' -Target ' + JSON.stringify(keep) + ' | Out-Null'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true });
    if (r.status === 0) return { ok: true, via: 'powershell' };
    const psErr = (r.stderr || '').toString('utf8').slice(0, 200);
    return { ok: false, error: (e && e.code ? e.code + ': ' : '') + (e && e.message ? e.message : String(e)) + (psErr ? ' | PowerShell: ' + psErr : '') };
  }
}

function hardlinkGroup(group, dryRun) {
  const keep = group.files[0].path;
  const results = [];

  // A1：近似组一律拒绝（预览态也要如实报告，不能预览说"将合并"而执行时说不行）
  if (group && group.approx === true) {
    for (let i = 1; i < group.files.length; i++) {
      results.push({ from: keep, to: group.files[i].path, action: 'refused', error: approxRefusal(group) });
    }
    return results;
  }

  for (let i = 1; i < group.files.length; i++) {
    const victim = group.files[i].path;
    if (low(keep) === low(victim)) continue;
    // A2：合并会就地改写这两个路径，必须先过统一安全闸门
    // （受保护系统目录 / OneDrive 云同步段）。旧实现全程不调 guard，
    // 若扫描根直达系统目录（见上方 root 校验修复）就会把系统文件改成硬链接。
    const gk = guard.checkDestructivePath(keep);
    if (!gk.ok) { results.push({ from: keep, to: victim, action: 'refused', error: gk.error }); continue; }
    const gv = guard.checkDestructivePath(victim);
    if (!gv.ok) { results.push({ from: keep, to: victim, action: 'refused', error: gv.error }); continue; }
    if (dryRun) {
      results.push({ from: keep, to: victim, action: 'hardlink(预览)' });
      continue;
    }
    try {
      // 备份受害者到同目录 .dsk-dup-bak（可回滚）
      const bak = victim + '.dsk-dup-bak';
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
      fs.renameSync(victim, bak);
      const r = createHardlink(keep, victim);
      if (r.ok) {
        fs.unlinkSync(bak); // 成功则删备份
        results.push({ from: keep, to: victim, action: 'hardlink', via: r.via });
      } else {
        fs.renameSync(bak, victim); // 失败还原
        results.push({ from: keep, to: victim, action: 'fail', error: r.error });
      }
    } catch (e) {
      results.push({ from: keep, to: victim, action: 'fail', error: e && e.message ? e.message : String(e) });
    }
  }
  return results;
}

// ---------- 硬链接回滚 ----------
// 评审 P1-4：旧实现 readFileSync + writeFileSync 把整个文件读进 JS 内存
// （几 GB 的视频会直接打爆内存），且先 unlink 再 write —— 中途失败数据就没了。
// 现改为原子序列：
//   1) 把硬链接 p 原子改名到 p.dsk-unlink-bak（此时数据仍由保留副本持有，零丢失风险）
//   2) 从保留副本 copyFileSync 出独立文件（copyFileSync 走内核，不占 JS 堆）
//   3) 校验大小一致才删除备份；任何一步失败都把备份改回原位
// entries 支持两种形态：{victim, keep, size}（新）与 'path'（旧的 merged 数组）
function streamCopySync(src, dst) {
  // 兜底：keep 未知时（旧格式记录）用流式复制，避免整文件读入内存
  const bufSize = 1 << 20;
  const fd = fs.openSync(src, 'r');
  try {
    const out = fs.openSync(dst, 'w');
    try {
      const buf = Buffer.allocUnsafe(bufSize);
      let pos = 0;
      for (;;) {
        const n = fs.readSync(fd, buf, 0, bufSize, pos);
        if (n <= 0) break;
        fs.writeSync(out, buf, 0, n, pos);
        pos += n;
      }
    } finally { fs.closeSync(out) }
  } finally { fs.closeSync(fd) }
}

function rollbackHardlinks(entries) {
  const results = [];
  for (const e of (entries || [])) {
    const p = (typeof e === 'string') ? e : (e && (e.victim || e.path));
    const keep = (e && typeof e === 'object') ? (e.keep || null) : null;
    if (!p) { results.push({ path: String(p), action: 'fail', error: '条目缺少路径' }); continue }
    if (!fs.existsSync(p)) { results.push({ path: p, action: 'fail', error: '文件不存在（可能已被删除或移动）' }); continue }
    const bak = p + '.dsk-unlink-bak';
    try {
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
      fs.renameSync(p, bak);
      const from = (keep && fs.existsSync(keep)) ? keep : bak;
      if (from === bak) streamCopySync(bak, p);
      else fs.copyFileSync(from, p);
      const sa = fs.statSync(p).size;
      const sb = fs.statSync(bak).size;
      if (sa !== sb) {
        try { fs.unlinkSync(p) } catch (e2) { /* ignore */ }
        fs.renameSync(bak, p);
        results.push({ path: p, action: 'fail', error: '复制后大小不一致（' + sa + ' ≠ ' + sb + '），已恢复原硬链接' });
        continue;
      }
      fs.unlinkSync(bak);
      results.push({ path: p, action: 'restored', bytes: sa });
    } catch (err) {
      // 现场复原：备份还在且目标缺失，就把硬链接放回去
      try { if (fs.existsSync(bak) && !fs.existsSync(p)) fs.renameSync(bak, p) } catch (e2) { /* ignore */ }
      results.push({ path: p, action: 'fail', error: err && err.message ? err.message : String(err) });
    }
  }
  return results;
}

// ---------- 去重映射（单源，评审 A6） ----------// 此前有两种互斥 schema：MCP 写 {entries:[{victim,keep,size,at}]}，
// CLI 与 GUI 写 {merged:[path]}，而读取端各读各的 —— 结果是
// "AI 合并的文件，GUI/CLI 回滚不了"（读取端拿到的 merged 为空，报"没有可回滚记录"）。
// 现在读写只此一处：一律写 entries，读取时兼容旧 merged（无 keep → 回滚退化为流式复制）。
const MAX_DEDUP_ENTRIES = 5000;

function readDedupMap() {
  const raw = audit.readJson(audit.dedupMapFile());
  const entries = [];
  if (raw && Array.isArray(raw.entries)) {
    for (const e of raw.entries) {
      if (e && e.victim) entries.push({ victim: String(e.victim), keep: e.keep ? String(e.keep) : null, size: e.size || 0, at: e.at || null });
    }
  } else if (raw && Array.isArray(raw.merged)) {
    for (const p of raw.merged) if (p) entries.push({ victim: String(p), keep: null, size: 0, at: null });
  }
  return { entries: entries };
}

function writeDedupMap(entries) {
  const capped = (entries || []).slice(-MAX_DEDUP_ENTRIES);
  const okWrite = audit.writeJson(audit.dedupMapFile(), {
    at: new Date().toISOString(),
    entries: capped,
    truncated: (entries || []).length > capped.length
  });
  return { ok: okWrite, count: capped.length };
}

// 追加式写入：先读旧记录再合并，保证任何一侧（CLI/MCP/GUI）新增都能被其它侧回滚
function appendDedupEntries(newOnes) {
  const existing = readDedupMap().entries;
  const merged = existing.concat(newOnes || []);
  return writeDedupMap(merged);
}

module.exports = {
  scan, hardlinkGroup, rollbackHardlinks, hashRange, hashFull,
  readDedupMap, writeDedupMap, appendDedupEntries, MAX_DEDUP_ENTRIES
};
