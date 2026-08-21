// lib/clean.js — 垃圾清理（回收站/临时缓存/空目录/重复文件）
// 与 DSH 版 validateCleanArgs 一致的安全校验；移入回收站（可恢复），回收站清空为永久删除。
'use strict';
const { spawnSync } = require('child_process');
const { appendAudit, readJson } = require('./audit.js');

const BS = '\\';
const SYS_PREFIX = ['\\windows\\', '\\program files\\', '\\program files (x86)\\', '\\programdata\\', '\\winsxs\\', '\\system volume information\\', '\\$recycle.bin\\'];
const TEMP_SEG = ['temp', 'tmp', 'cache', 'prefetch', 'thumbcache', 'iconcache'];

function low(s) { return String(s || '').toLowerCase() }
function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}
function escPS(p) { return String(p).replace(/'/g, "''") }
function utf16leB64(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    bytes.push(c & 0xFF, (c >> 8) & 0xFF);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
  }
  return Buffer.from(bin, 'binary').toString('base64');
}

function isSafeZone(lp) {
  return SYS_PREFIX.every(function(pre) { return lp.indexOf(pre) < 0 });
}
function hasTempSegment(lp) {
  const segs = lp.split(BS);
  return segs.some(function(s) { return TEMP_SEG.some(function(t) { return s === t || s.indexOf(t) === 0 }) });
}

// ---------- 校验 ----------
function validate(type, paths, report) {
  const err = function(msg) { return { ok: false, error: msg } };
  if (!report) return err('未找到扫描报告（请先运行 scan）');
  const sugg = (report.suggestions || []);
  if (type === 'recycle-bin') return { ok: true, paths: [], estBytes: 0 };
  if (!Array.isArray(paths) || paths.length === 0) return err('缺少清理路径');
  if (paths.length > 500) return err('单次清理路径过多（>500）');
  for (const p of paths) {
    const lp = low(p);
    if (!isSafeZone(lp)) return err('拒绝清理系统目录：' + p);
  }
  if (type === 'duplicates') {
    const dupGroups = sugg.filter(function(s) { return s.type === 'duplicates' }).reduce(function(a, s) { return a.concat(s.groups || []) }, []);
    const removableSet = {};
    for (const g of dupGroups) for (const p of g.removable) removableSet[low(p)] = g.size;
    for (const p of paths) {
      if (!removableSet[low(p)]) return err('路径不在重复文件建议清单中：' + p);
    }
    return { ok: true, paths: paths, estBytes: paths.reduce(function(a, p) { return a + (removableSet[low(p)] || 0) }, 0) };
  }
  if (type === 'empty-dirs') {
    const emptySet = {};
    for (const p of (report.emptyDirSample || [])) emptySet[low(p)] = 1;
    for (const p of paths) if (!emptySet[low(p)]) return err('路径不在空文件夹清单中：' + p);
    return { ok: true, paths: paths, estBytes: 0 };
  }
  if (type === 'junk-temp') {
    for (const p of paths) {
      if (!hasTempSegment(low(p))) return err('路径不在临时/缓存目录中：' + p);
    }
    const tempSugg = sugg.find(function(s) { return s.type === 'junk-temp' });
    let est = 0;
    if (tempSugg) for (const it of (tempSugg.items || [])) est += it.bytes || 0;
    return { ok: true, paths: paths, estBytes: est };
  }
  if (type === 'stale-large') {
    const items = sugg.filter(function(s) { return s.type === 'stale-large' }).reduce(function(a, s) { return a.concat(s.items || []) }, []);
    const set = {};
    for (const it of items) set[low(it.path)] = it.bytes || 0;
    for (const p of paths) {
      if (!set[low(p)]) return err('路径不在陈旧大文件清单中：' + p);
    }
    return { ok: true, paths: paths, estBytes: paths.reduce(function(a, p) { return a + (set[low(p)] || 0) }, 0) };
  }
  return err('未知清理类型：' + type);
}

// ---------- 执行 ----------
async function execute(type, paths, report, dryRun) {
  const v = validate(type, paths, report);
  if (!v.ok) return v;
  if (dryRun) {
    return { ok: true, dryRun: true, type: type, paths: v.paths, estBytes: v.estBytes, note: '（dry-run 预览）将清理 ' + v.paths.length + ' 个路径' + (v.estBytes > 0 ? '，约可释放 ' + fmtBytes(v.estBytes) : '') + '（移入回收站，可恢复）' };
  }
  let result;
  try {
    if (type === 'recycle-bin') {
      result = runPS('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Output "OK"');
      const freed = (report.junk || []).find(function(j) { return j.label === '回收站' });
      appendAudit({ ts: new Date().toISOString(), type: type, action: 'empty-recycle-bin', paths: ['C:' + BS + '$RECYCLE.BIN'], freedBytes: freed ? freed.bytes : 0, result: result.ok ? 'ok' : 'error', detail: result.err || '' });
      return { ok: true, executed: 1, freedBytes: freed ? freed.bytes : 0, note: '回收站已清空' };
    }
    const arrLit = '@(' + v.paths.map(function(p) { return "'" + escPS(p) + "'" }).join(',') + ')';
    const script = '$ErrorActionPreference="Continue"; Add-Type -AssemblyName Microsoft.VisualBasic; $paths = ' + arrLit + '; $ok = 0; foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; if ($i -and $i.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } elseif ($i) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } } }; Write-Output ("OK " + $ok)';
    result = runPS(script);
    const m = result.out.match(/OK (\d+)/);
    const executed = m ? Number(m[1]) : 0;
    appendAudit({ ts: new Date().toISOString(), type: type, action: 'move-to-recycle-bin', paths: v.paths, freedBytes: v.estBytes, executed: executed, result: result.ok ? 'ok' : 'error', detail: result.err || '' });
    return { ok: true, executed: executed, total: v.paths.length, freedBytes: v.estBytes, note: '已移入回收站 ' + executed + '/' + v.paths.length + ' 项' };
  } catch (e) {
    return { ok: false, error: '执行失败：' + (e && e.message ? e.message : String(e)) };
  }
}

function runPS(script) {
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', utf16leB64(script)], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 1 << 20, windowsHide: true
    });
    const out = (r.stdout || '').toString('utf8');
    const err = (r.stderr || '').toString('utf8');
    return { ok: r.status === 0, out: out, err: err };
  } catch (e) {
    return { ok: false, out: '', err: e && e.message ? e.message : String(e) };
  }
}

module.exports = { validate, execute, runPS, fmtBytes, low };
