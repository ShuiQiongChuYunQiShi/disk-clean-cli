// dsk-adv.js — 高级功能辅助进程（MFT 快扫 / 全盘 dedup / 每用户配额）
// 用法:
//   node dsk-adv.js mftscan <盘符>              # MFT 直读快扫（需管理员，仅 NTFS）
//   node dsk-adv.js dedup <rootsJson> [minBytes] # 全盘重复文件检测（排除系统/程序目录）
//   node dsk-adv.js dedup-hardlink <groupsJson>  # 硬链接合并（保留每组第一个，其余转硬链接）
//   node dsk-adv.js dedup-rollback <mergedJson>  # 硬链接回滚（复制回独立文件）
//   node dsk-adv.js quota <盘符>                # 每用户配额（MFT 目录聚合，需管理员）
// 输出: 最后一行 stdout = 聚合 JSON（与 dsk-helper 一致）
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function out(obj) {
  process.stdout.write('\n' + JSON.stringify(obj));
}

function low(s) { return String(s || '').toLowerCase(); }

// ---------- MFT 快扫 ----------
function runMftScan(drive) {
  const mft = require('./dsk-lib/mftscan.js');
  const r = mft.scan(drive, {});
  if (!r.ok) return r;
  // 精简返回（topDirs/topFiles 只保留必要字段）
  return {
    ok: true, drive: r.drive, elapsedMs: r.elapsedMs,
    summary: r.summary,
    category: (r.category || []).slice(0, 15),
    extTop: (r.extTop || []).slice(0, 15),
    topDirs: (r.topDirs || []).slice(0, 20),
    topFiles: (r.topFiles || []).slice(0, 20),
    totalDirs: r.dirsFull ? r.dirsFull.length : 0
  };
}

// ---------- dedup 扫描（纯 Node，无 spawnSync） ----------
async function runDedupScan(roots, minBytes) {
  const dedup = require('./dsk-lib/dedup.js');
  const r = await dedup.scan(roots, { minBytes: minBytes ? Number(minBytes) : undefined });
  if (!r.ok) return r;
  return {
    ok: true,
    groups: (r.groups || []).slice(0, 200),
    totalDupBytes: r.totalDupBytes,
    totalSaveBytes: r.totalSaveBytes,
    scannedFiles: r.scannedFiles,
    elapsedMs: r.elapsedMs,
    groupCount: (r.groups || []).length
  };
}

// ---------- 硬链接合并（fs.linkSync，避免 spawnSync 管道限制） ----------
// groups: [{ size, files: [{path, size}] }]；保留每组 files[0]，其余转硬链接
function runDedupHardlink(groups) {
  const results = [];
  let merged = 0, failed = 0;
  for (const g of (groups || [])) {
    const files = (g.files || []).filter(function(f) { return f && f.path; });
    if (files.length < 2) continue;
    const keep = files[0].path;
    for (let i = 1; i < files.length; i++) {
      const victim = files[i].path;
      if (low(keep) === low(victim)) continue;
      try {
        const bak = victim + '.dsk-dup-bak';
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
        fs.renameSync(victim, bak);
        try {
          fs.linkSync(keep, victim);   // 创建硬链接（同卷 NTFS 支持）
          fs.unlinkSync(bak);          // 成功删备份
          merged++;
          results.push({ from: keep, to: victim, action: 'hardlink' });
        } catch (e2) {
          try { fs.renameSync(bak, victim); } catch (e3) { /* ignore */ }
          failed++;
          results.push({ from: keep, to: victim, action: 'fail', error: e2 && e2.message ? e2.message : String(e2) });
        }
      } catch (e) {
        failed++;
        results.push({ from: keep, to: victim, action: 'fail', error: e && e.message ? e.message : String(e) });
      }
    }
  }
  return { ok: true, merged: merged, failed: failed, results: results };
}

// ---------- 硬链接回滚（复制回独立文件） ----------
function runDedupRollback(mergedFiles) {
  const results = [];
  let restored = 0, failed = 0;
  for (const p of (mergedFiles || [])) {
    if (!p) continue;
    try {
      const data = fs.readFileSync(p);
      fs.unlinkSync(p);
      fs.writeFileSync(p, data);
      restored++;
      results.push({ path: p, action: 'restored' });
    } catch (e) {
      failed++;
      results.push({ path: p, action: 'fail', error: e && e.message ? e.message : String(e) });
    }
  }
  return { ok: true, restored: restored, failed: failed, results: results };
}

// ---------- 每用户配额 ----------
function runQuota(drive) {
  const quota = require('./dsk-lib/quota.js');
  const r = quota.analyze(drive);
  if (!r.ok) return r;
  return {
    ok: true, drive: r.drive, elapsedMs: r.elapsedMs,
    mftRecords: r.mftRecords, systemBytes: r.systemBytes,
    users: (r.users || []).slice(0, 20)
  };
}

async function main() {
  const mode = process.argv[2];
  const a1 = process.argv[3];
  const a2 = process.argv[4];
  try {
    if (mode === 'mftscan') {
      if (!a1) return out({ ok: false, error: '缺少盘符参数（如 D:）' });
      return out(runMftScan(a1));
    }
    if (mode === 'dedup') {
      let roots = [];
      try { roots = a1 ? JSON.parse(a1) : []; } catch (e) { return out({ ok: false, error: 'roots 参数不是有效 JSON' }); }
      if (!Array.isArray(roots) || roots.length === 0) return out({ ok: false, error: '缺少扫描根目录' });
      return out(await runDedupScan(roots, a2));
    }
    if (mode === 'dedup-hardlink') {
      let groups = [];
      try { groups = a1 ? JSON.parse(a1) : []; } catch (e) { return out({ ok: false, error: 'groups 参数不是有效 JSON' }); }
      if (!Array.isArray(groups) || groups.length === 0) return out({ ok: false, error: '缺少重复组' });
      return out(runDedupHardlink(groups));
    }
    if (mode === 'dedup-rollback') {
      let files = [];
      try { files = a1 ? JSON.parse(a1) : []; } catch (e) { return out({ ok: false, error: '参数不是有效 JSON' }); }
      if (!Array.isArray(files) || files.length === 0) return out({ ok: false, error: '缺少已合并文件列表' });
      return out(runDedupRollback(files));
    }
    if (mode === 'quota') {
      if (!a1) return out({ ok: false, error: '缺少盘符参数（如 C:）' });
      return out(runQuota(a1));
    }
    return out({ ok: false, error: '未知模式: ' + mode });
  } catch (e) {
    return out({ ok: false, error: e && e.message ? e.message : String(e) });
  }
}

main();
