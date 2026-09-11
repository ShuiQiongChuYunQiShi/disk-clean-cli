// lib/clean.js — 垃圾清理（回收站/临时缓存/空目录/重复文件/陈旧大文件）
// 安全闸门统一由 lib/guard.js 提供（单一事实源）；本模块只负责白名单校验与执行。
// 移入回收站（可恢复），回收站清空为永久删除。
'use strict';
const { spawnSync } = require('child_process');
const { appendAudit, readJson } = require('./audit.js');
const guard = require('./guard.js');

const BS = '\\';

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

// ---------- 回收站真实规模（评审 P1-1：唯一不可逆操作必须给出真实数量） ----------
let recyclebinLib = null;
function recycleStats() {
  try {
    if (!recyclebinLib) recyclebinLib = require('./recyclebin.js');
    const items = recyclebinLib.list();
    return {
      count: items.length,
      bytes: items.reduce(function (a, x) { return a + (x.size || 0); }, 0),
      toolMatched: 0,
    };
  } catch (e) {
    return { count: null, bytes: null, error: e && e.message ? e.message : String(e) };
  }
}

// ---------- 校验 ----------
function validate(type, paths, report) {
  const err = function(msg) { return { ok: false, error: msg } };
  if (!report) return err('未找到扫描报告（请先运行 scan）');
  const sugg = (report.suggestions || []);
  const roots = (report.summary && Array.isArray(report.summary.roots)) ? report.summary.roots : [];

  if (type === 'recycle-bin') {
    // 无白名单可言（用户要求清空整个回收站），但必须把真实规模交给调用方展示
    const st = recycleStats();
    const note = st.count === null
      ? '将从回收站永久删除全部内容（无法枚举具体数量：' + (st.error || '未知错误') + '）'
      : '将从回收站永久删除全部 ' + st.count + ' 项' + (st.bytes ? '（约 ' + fmtBytes(st.bytes) + '）' : '') +
        '，其中包含非本工具删除的文件。此操作不可恢复。';
    return { ok: true, paths: [], estBytes: st.bytes || 0, itemCount: st.count, irreversible: true, note: note };
  }

  if (!Array.isArray(paths) || paths.length === 0) return err('缺少清理路径');
  if (paths.length > 500) return err('单次清理路径过多（>500）');

  // 统一闸门：受保护路径 / 云同步 / 扫描根归属（分隔符边界由 guard.inRoots 保证）
  for (const p of paths) {
    const c = guard.checkDestructivePath(p, { roots: roots });
    if (!c.ok) return err(c.error);
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
    // 主闸门：建议清单集合（引擎已输出 suggestions[type=junk-temp].paths）
    const tempSugg = sugg.find(function(s) { return s.type === 'junk-temp' });
    const whitelist = {};
    for (const p of ((tempSugg && tempSugg.paths) || [])) whitelist[low(p)] = 1;
    const escaped = [];
    for (const p of paths) {
      const lp = low(p);
      if (whitelist[lp]) continue;
      // 逃生通道：用户显式指定且确为临时段（精确段匹配）—— 记入审计
      if (guard.hasTempSegment(lp)) { escaped.push(p); continue; }
      return err('路径不在临时/缓存建议清单中（且非 temp/tmp/cache 等精确临时目录）：' + p);
    }
    let est = 0;
    if (tempSugg) for (const it of (tempSugg.items || [])) est += it.bytes || 0;
    const out = { ok: true, paths: paths, estBytes: est };
    if (escaped.length > 0) out.escapedWhitelist = escaped;
    if (!tempSugg) out.note = '报告中没有 junk-temp 建议项，本次为显式指定临时目录';
    return out;
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
    const note = type === 'recycle-bin'
      ? '（dry-run 预览）' + (v.note || '清空回收站')
      : '（dry-run 预览）将清理 ' + v.paths.length + ' 个路径' +
        (v.estBytes > 0 ? '，约可释放 ' + fmtBytes(v.estBytes) : '') + '（移入回收站，可恢复）';
    return { ok: true, dryRun: true, type: type, paths: v.paths, estBytes: v.estBytes, itemCount: v.itemCount, irreversible: !!v.irreversible, note: note };
  }

  try {
    if (type === 'recycle-bin') {
      const before = recycleStats();
      const result = runPS('Clear-RecycleBin -Force -ErrorAction Continue; Write-Output "OK"');
      const after = recycleStats();
      const stdoutOk = /OK/.test(result.out || '');
      const procOk = result.ok && stdoutOk;
      // 二次确认：清空后数量应下降（原先非空时）
      const dropped = (before.count !== null && after.count !== null) ? (after.count < before.count) : null;
      const succeeded = procOk && (dropped === null || dropped || before.count === 0);
      const errText = String(result.err || '').trim().slice(0, 300);
      appendAudit({
        ts: new Date().toISOString(), type: type, action: 'empty-recycle-bin',
        paths: ['*:\\$RECYCLE.BIN'], freedBytes: before.bytes || 0,
        itemCount: before.count, executed: succeeded ? 1 : 0,
        result: succeeded ? 'ok' : 'error',
        detail: succeeded ? '' : (errText || ('stdout=' + String(result.out || '').slice(0, 200)))
      });
      if (!succeeded) {
        return {
          ok: false,
          error: '清空回收站失败：' + (errText || 'PowerShell 返回非成功状态') +
            (dropped === false ? '（清空后条目数未下降）' : ''),
          before: before.count, after: after.count, stderr: errText
        };
      }
      return {
        ok: true, executed: 1, freedBytes: before.bytes || 0, itemCount: before.count,
        note: '回收站已清空（删除 ' + (before.count === null ? '全部内容' : before.count + ' 项') + '，永久不可恢复）'
      };
    }

    const arrLit = '@(' + v.paths.map(function(p) { return "'" + escPS(p) + "'" }).join(',') + ')';
    const script = '$ErrorActionPreference="Continue"; Add-Type -AssemblyName Microsoft.VisualBasic; $paths = ' + arrLit + '; $ok = 0; foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; if ($i -and $i.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } elseif ($i) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } } }; Write-Output ("OK " + $ok)';
    const result = runPS(script);
    const m = result.out.match(/OK (\d+)/);
    const executed = m ? Number(m[1]) : 0;
    const errText = String(result.err || '').trim().slice(0, 300);
    // 评审 P0-4：0 项成功不得回报 ok:true（模型会据此宣布清理完成）
    const succeeded = result.ok && executed > 0;
    // 评审 B4：部分成功必须显式标记。旧实现 $ErrorActionPreference="Continue" +
    // OnlyErrorDialogs 会让"被占用/权限不足"的项静默跳过，3/5 也返回 ok:true ——
    // AI 只读 ok 就会宣布"全部清理完成"。partial 由 MCP 层转成 isError。
    const partial = succeeded && executed < v.paths.length;
    appendAudit({
      ts: new Date().toISOString(), type: type, action: 'move-to-recycle-bin',
      paths: v.paths, freedBytes: v.estBytes, executed: executed,
      result: succeeded ? (partial ? 'partial' : 'ok') : 'error',
      detail: succeeded ? (partial ? ('仅 ' + executed + '/' + v.paths.length + ' 成功') : '') : (errText || ('executed=0 of ' + v.paths.length))
    });
    if (!succeeded) {
      return {
        ok: false,
        error: '没有文件被移入回收站（0/' + v.paths.length + '）：' +
          (errText || '目标可能已不存在、被占用或权限不足'),
        executed: executed, total: v.paths.length, stderr: errText
      };
    }
    return {
      ok: true, partial: partial, executed: executed, total: v.paths.length, freedBytes: v.estBytes,
      escapedWhitelist: v.escapedWhitelist,
      note: partial
        ? ('仅 ' + executed + '/' + v.paths.length + ' 项移入回收站，其余 ' + (v.paths.length - executed) + ' 项失败（可能被占用或权限不足），未全部完成')
        : ('已移入回收站 ' + executed + '/' + v.paths.length + ' 项')
    };
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

module.exports = { validate, execute, runPS, fmtBytes, low, recycleStats };
