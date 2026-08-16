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
    for (const en of files) {
      let st;
      try { st = await fsp.stat(path.join(dir, en.name)); } catch (e) { continue; }
      if (st.size < minBytes) continue;
      const arr = bySize.get(st.size);
      if (arr) arr.push({ path: path.join(dir, en.name), size: st.size });
      else bySize.set(st.size, [{ path: path.join(dir, en.name), size: st.size }]);
      scannedFiles++;
    }
    await pool(childDirs, function(en) {
      return walk(path.join(dir, en.name), segs.concat(en.name));
    });
  }
  for (const r of roots) {
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
    totalDupBytes: totalDupBytes,
    totalSaveBytes: totalSaveBytes,
    scannedFiles: scannedFiles,
    elapsedMs: Date.now() - t0
  };
}

// ---------- 硬链接合并（可选，危险） ----------
// group: { files: [{path, size}] }；保留 files[0]，其余转硬链接指向 files[0]
// 需要：同卷（保证）、原文件删除 + 硬链接创建（NTFS 硬链接不能跨目录的目录项？可以跨目录同卷）
function hardlinkGroup(group, dryRun) {
  const keep = group.files[0].path;
  const results = [];
  for (let i = 1; i < group.files.length; i++) {
    const victim = group.files[i].path;
    if (low(keep) === low(victim)) continue;
    if (dryRun) {
      results.push({ from: keep, to: victim, action: 'hardlink(预览)' });
      continue;
    }
    try {
      // 备份受害者到同目录 .dsk-dup-bak（可回滚）
      const bak = victim + '.dsk-dup-bak';
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
      fs.renameSync(victim, bak);
      // 创建硬链接：PowerShell New-Item -ItemType HardLink
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'New-Item -ItemType HardLink -Path ' + JSON.stringify(victim) + ' -Target ' + JSON.stringify(keep) + ' | Out-Null'],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true });
      if (r.status === 0) {
        fs.unlinkSync(bak); // 成功则删备份
        results.push({ from: keep, to: victim, action: 'hardlink' });
      } else {
        fs.renameSync(bak, victim); // 失败还原
        results.push({ from: keep, to: victim, action: 'fail', error: (r.stderr || '').toString('utf8').slice(0, 200) });
      }
    } catch (e) {
      results.push({ from: keep, to: victim, action: 'fail', error: e && e.message ? e.message : String(e) });
    }
  }
  return results;
}

// ---------- 硬链接回滚 ----------
// 扫描所有 *.dsk-dup-bak？不——回滚策略：把硬链接文件复制回独立文件。
// 简化：回滚 = 对已合并组，将 victims 从硬链接还原为独立副本（复制内容）。
function rollbackHardlinks(mergedFiles) {
  const results = [];
  for (const p of mergedFiles) {
    try {
      // 读取内容 + 删除硬链接 + 重写
      const data = fs.readFileSync(p);
      fs.unlinkSync(p);
      fs.writeFileSync(p, data);
      results.push({ path: p, action: 'restored' });
    } catch (e) {
      results.push({ path: p, action: 'fail', error: e && e.message ? e.message : String(e) });
    }
  }
  return results;
}

module.exports = { scan, hardlinkGroup, rollbackHardlinks, hashRange, hashFull };
