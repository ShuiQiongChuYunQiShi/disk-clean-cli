#!/usr/bin/env node
// disk-clean — Windows 磁盘清理与分析 CLI
// 用法见 --help。安全默认：所有破坏性操作需 --yes 显式确认，先 --dry-run 预览。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// require 用字面量路径：打包器（esbuild/pkg）静态分析才能内联依赖
const { run, buildMarkdown } = require('../lib/engine.js');
const audit = require('../lib/audit.js');
const organize = require('../lib/organize.js');
const clean = require('../lib/clean.js');
const configLib = require('../lib/config.js');
const scheduleLib = require('../lib/schedule.js');
const mftLib = require('../lib/mftscan.js');
const healthLib = require('../lib/health.js');
const dedupLib = require('../lib/dedup.js');
const quotaLib = require('../lib/quota.js');
const restoreLib = require('../lib/restore.js');
const i18nLib = require('../lib/i18n.js');
const guard = require('../lib/guard.js');
const drivesLib = require('../lib/drives.js');

// ---------- 内部引擎直跑模式（SEA 单文件环境：scan 子进程用 --internal-scan 自我调用） ----------
if (process.argv[2] === '--internal-scan') {
  const engArgs = process.argv.slice(3);
  run(engArgs).then(function(res) {
    if (res && res.error) process.stdout.write('\n' + JSON.stringify({ ok: false, error: res.error }));
    else process.stdout.write('\n' + JSON.stringify(res.data));
    process.exit(res && res.exitCode ? res.exitCode : 0);
  }).catch(function(e) {
    process.stderr.write('HELPER_ERROR: ' + (e && e.stack ? e.stack : String(e)));
    process.exit(2);
  });
  return;
}

const BS = '\\';
const VER = require('../lib/version.js').VERSION;

// SEA（单文件 exe）检测：node 环境 spawn 需带脚本路径，SEA 环境直接自我调用
let IS_SEA = false;
try { IS_SEA = !!(require('node:sea') && require('node:sea').isSea()); } catch (e) { IS_SEA = false; }

// ---------- 终端输出 ----------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m'
};
function useColor() { return process.stdout.isTTY && !process.env.NO_COLOR }
function col(code, s) { return useColor() ? code + s + C.reset : s }
function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}

function parseOpts(argv) {
  const o = { _: [], flags: {}, values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o._.push.apply(o._, argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { o.values[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && next !== '-' && /^[A-Za-z]:[\\/]/.test(next)) { o.values[a.slice(2)] = next; i++; continue; }
      if (next !== undefined && !next.startsWith('--')) { o.values[a.slice(2)] = next; i++; continue; }
      o.flags[a.slice(2)] = true;
    } else if (a.startsWith('-') && a.length === 2) {
      o.flags[a.slice(1)] = true;
    } else {
      o._.push(a);
    }
  }
  return o;
}

// ---------- 命令: scan ----------
async function cmdScan(o) {
  const roots = (o._.length ? o._ : await listDrives());
  if (roots.length === 0) return fail('未指定扫描根目录');
  const reportPath = o.values.report || audit.reportFile();
  const progressPath = path.join(os.tmpdir(), 'dsk-progress-' + process.pid + '.json');
  const ex = (o.values.exclude || '').split(';').filter(Boolean);
  const argv = ['--roots', roots.join(';'), '--suggest'];
  if (o.values.exclude) argv.push('--exclude', o.values.exclude);
  if (o.values.config) argv.push('--config', o.values.config);
  if (o.values.lang) argv.push('--lang', o.values.lang);
  argv.push('--report', reportPath, '--progress', progressPath);
  console.log(col(C.cyan, '▶ 正在扫描:') + ' ' + col(C.bold, roots.join(', ')));
  // 后台子进程跑引擎（SEA/pkg 环境下自我调用 --internal-scan），主进程轮询进度
  const selfArgs = IS_SEA ? ['--internal-scan'] : [__filename, '--internal-scan'];
  const proc = spawn(process.execPath, selfArgs.concat(argv), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuf = '', stderrBuf = '';
  proc.stdout.on('data', function(d) { stdoutBuf += d.toString('utf8') });
  proc.stderr.on('data', function(d) { stderrBuf += d.toString('utf8') });
  const t0 = Date.now();
  const timer = setInterval(function() {
    let p = null;
    try { p = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch (e) { /* 未就绪 */ }
    if (p && !p.done) {
      process.stdout.write('\r' + col(C.dim, '  文件 ' + p.files + ' | 目录 ' + p.dirs + ' | ' + fmtBytes(p.bytes || 0) + (p.currentPath ? ' | ' + p.currentPath : '')) + '   ');
    }
  }, 800);
  const code = await new Promise(function(resolve) {
    proc.on('close', resolve);
    proc.on('error', function(e) { stderrBuf += '\n' + e.message; resolve(-1) });
  });
  clearInterval(timer);
  process.stdout.write('\r\x1b[K');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (code !== 0) {
    const lastLine = stdoutBuf.trim().split('\n').pop();
    let msg = stderrBuf.trim() || ('扫描失败 (exit ' + code + ')');
    try { const j = JSON.parse(lastLine); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
    return fail('扫描失败: ' + msg);
  }
  // 读报告渲染
  const rep = audit.readJson(reportPath);
  if (!rep) return fail('扫描完成但无法读取报告: ' + reportPath);
  try {
    const lang = i18nLib.detect(o.values.lang);
    const md = buildMarkdown(rep, rep.elapsedMs || 0, lang);
    fs.writeFileSync(audit.mdFile(), md, 'utf8');
  } catch (e) { /* md 生成失败不阻断 */ }
  const s = rep.summary || {};
  console.log(col(C.green, '✔ 扫描完成') + '  (' + elapsed + 's)');
  console.log('  根目录   : ' + (s.roots || []).join(', '));
  console.log('  总大小   : ' + col(C.bold, fmtBytes(s.totalBytes)));
  console.log('  文件     : ' + (s.totalFiles || 0) + '  目录: ' + (s.totalDirs || 0) + '  空目录: ' + (s.emptyDirs || 0));
  console.log('  报告     : ' + reportPath);
  console.log('  Markdown : ' + audit.mdFile());
  printSuggestSummary(rep);
  if (rep.suggestions && rep.suggestions.length === 0 && !rep.suggestError) {
    console.log(col(C.gray, '  (无智能建议)'));
  }
  return 0;
}

function printSuggestSummary(rep) {
  const sugg = rep.suggestions || [];
  if (sugg.length === 0) return;
  console.log(col(C.cyan, '\n── 智能建议 ──'));
  for (const s of sugg) {
    const n = (s.items || []).length;
    let b = 0;
    for (const it of (s.items || [])) b += it.bytes || 0;
    const tag = col(C.yellow, '[' + (s.type || '?') + ']');
    const count = n + ' 项';
    console.log('  ' + tag + ' ' + (s.label || s.type) + ' — ' + count + (b > 0 ? ' (' + fmtBytes(b) + ')' : ''));
  }
  const oc = rep.organizeCandidates || [];
  if (oc.length > 0) {
    console.log(col(C.cyan, '── 散落目录候选 ──'));
    for (const c of oc.slice(0, 10)) {
      console.log('  · ' + c.path + col(C.gray, ' (' + fmtBytes(c.bytes) + ', ' + c.cat + ')'));
    }
  }
}

async function listDrives() {
  // 列出本地盘（简单版：A-Z 根存在）
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const ch = String.fromCharCode(i);
    try { fs.accessSync(ch + ':\\'); out.push(ch + ':\\'); } catch (e) { /* skip */ }
  }
  return out;
}

// ---------- 命令: report ----------
async function cmdReport(o) {
  const p = o._[0] || audit.reportFile();
  const rep = audit.readJson(p);
  if (!rep) return fail('无法读取报告: ' + p + '（请先运行 scan）');
  const s = rep.summary || {};
  console.log(col(C.cyan, '── 磁盘分析报告 ──'));
  console.log('  根目录   : ' + (s.roots || []).join(', '));
  console.log('  总大小   : ' + col(C.bold, fmtBytes(s.totalBytes)) + '  文件: ' + (s.totalFiles || 0) + '  目录: ' + (s.totalDirs || 0));
  if (rep.category && rep.category.length) {
    console.log(col(C.cyan, '── 类别分布 ──'));
    const max = rep.category.reduce(function(a, c) { return Math.max(a, c.bytes || 0) }, 1);
    for (const c of rep.category.slice(0, 12)) {
      const w = Math.round(((c.bytes || 0) / max) * 24);
      console.log('  ' + (c.label || '?').padEnd(8) + ' ' + col(C.blue, '█'.repeat(w)) + col(C.gray, '█'.repeat(Math.max(0, 24 - w))) + ' ' + fmtBytes(c.bytes) + '  ' + (c.count || 0) + ' 文件');
    }
  }
  printSuggestSummary(rep);
  // 生成 markdown
  try {
    const md = buildMarkdown(rep, rep.elapsedMs || 0);
    const mdPath = p.replace(/\.json$/i, '') + '.md';
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(col(C.green, '✔ Markdown 报告: ') + mdPath);
  } catch (e) {
    console.log(col(C.yellow, '! Markdown 生成失败: ' + e.message));
  }
  return 0;
}

// ---------- 命令: organize ----------
async function cmdOrganize(o) {
  const sub = o._[0];
  const reportFile = o.values.report || audit.reportFile();
  if (sub === 'plan') {
    const includeProgram = o.flags['include-program'] || o.flags.includeProgram;
    const r = await organize.plan({ includeProgram: includeProgram, reportFile: reportFile });
    if (!r.ok) return fail(r.error);
    if (r.items.length === 0) { console.log(col(C.yellow, '（' + r.note + '）')); return 0; }
    console.log(col(C.cyan, '── 整理计划 ──') + ' ' + r.note);
    for (const it of r.items) {
      const tag = it.kind === 'program' ? col(C.red, '[程序]') : (it.kind === 'dir' ? col(C.blue, '[目录]') : col(C.green, '[文件]'));
      console.log('  ' + tag + ' ' + it.src + col(C.gray, ' → ' + it.dst + ' (' + fmtBytes(it.bytes) + ')'));
      if (it.kind === 'program' && it.warn) console.log('        ' + col(C.yellow, '⚠ ' + it.warn));
    }
    // 落盘计划供 apply 使用
    audit.writeJson(audit.planFile(), r.items);
    console.log(col(C.gray, '  计划已保存: ') + audit.planFile());
    console.log(col(C.gray, '  执行: disk-clean organize apply --yes'));
    return 0;
  }
  if (sub === 'apply') {
    const dryRun = o.flags['dry-run'] || o.flags.dryRun;
    const yes = o.flags.yes || o.flags.y;
    const planItems = audit.readJson(o._[1] || audit.planFile());
    if (!Array.isArray(planItems) || planItems.length === 0) return fail('缺少整理计划（先运行 organize plan）');
    const roots = await currentScanRoots(reportFile);
    // 安全默认：无 --yes 一律 dry-run 预览，绝不真实执行
    if (!dryRun && yes && o.flags['restore-point']) {
      const rp = restoreLib.create('disk-clean organize apply');
      if (rp.ok) console.log(col(C.green, '✔ ' + rp.message));
      else console.log(col(C.yellow, '⚠ ' + rp.message + '（继续执行，可在审计日志查看）'));
    }
    const r = await organize.apply(planItems, { roots: roots, dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, '（dry-run 预览）' + r.note));
      console.log(col(C.gray, '  确认执行请加 --yes'));
      return 0;
    }
    console.log(col(C.green, '✔ ' + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, '  ✗ ' + f.src + ' → ' + f.dst + ' (' + f.reason + ')'));
    // v7-7：双份副本必须显式提示——否则用户只看到一条 fail，不知道目标盘上已经多了一份
    if (r.duplicatedCount) {
      console.log(col(C.yellow, '  ⚠ ' + r.duplicatedCount + ' 项出现「已复制但源未删除」，两份副本并存：'));
      for (const d of (r.duplicated || [])) console.log(col(C.yellow, '      ' + d.src + '\n      ' + d.dst));
      console.log(col(C.gray, '    本工具未自行删除任何一份（以免误删）。确认无误后请手动删除其一。'));
    }
    return 0;
  }
  if (sub === 'rollback') {
    const dryRun = o.flags['dry-run'] || o.flags.dryRun;
    const yes = o.flags.yes || o.flags.y;
    const r = await organize.rollback({ dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, '（dry-run 预览）' + r.note));
      console.log(col(C.gray, '  确认回滚请加 --yes'));
      return 0;
    }
    console.log(col(C.green, '✔ ' + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, '  ✗ ' + f.src + ' (' + f.reason + ')'));
    return 0;
  }
  return fail('organize 子命令: plan | apply | rollback');
}

async function currentScanRoots(reportFile) {
  const rep = audit.readJson(reportFile);
  if (rep && rep.summary && Array.isArray(rep.summary.roots)) return rep.summary.roots;
  return [];
}

// ---------- 命令: fix-shortcuts ----------
async function cmdFixShortcuts(o) {
  const p = o._[0];
  if (!p) return fail('用法: disk-clean fix-shortcuts <pairs.json>');
  const pairs = audit.readJson(p);
  if (!Array.isArray(pairs) || pairs.length === 0) return fail('无效的修复清单');
  const r = await organize.fixShortcuts(pairs);
  if (!r.ok) return fail(r.error);
  console.log(col(C.green, '✔ 扫描 ' + r.scanned + ' 个快捷方式，修复 ' + (r.fixed || []).length + ' 个'));
  for (const f of (r.fixed || []).slice(0, 10)) console.log('  · ' + f.lnk);
  return 0;
}

// ---------- 命令: clean ----------
async function cmdClean(o) {
  const type = o._[0];
  const reportFile = o.values.report || audit.reportFile();
  const rep = audit.readJson(reportFile);
  if (!rep) return fail('未找到扫描报告（请先运行 scan）');
  let paths = [];
  if (type === 'recycle-bin') {
    paths = [];
  } else if (o._.length > 1) {
    paths = o._.slice(1);
  } else {
    // 从建议自动提取候选（仅限有具体路径的类型；系统目录候选保守跳过而非报错）
    const sugg = rep.suggestions || [];
    // 评审 A3：此前这里自留一份 7 段正则；现统一走 guard（16 段 + 尾部匹配 + OneDrive）
    const safeOnly = function(list) { return (list || []).filter(function(p) { return guard.isProtectedPath(String(p).toLowerCase()) === false }) };
    if (type === 'duplicates') {
      for (const s of sugg) if (s.type === 'duplicates') for (const g of (s.groups || [])) paths = paths.concat(safeOnly(g.removable || []));
    } else if (type === 'empty-dirs') {
      paths = safeOnly((rep.emptyDirSample || []).slice(0, 200));
    } else if (type === 'junk-temp') {
      // junk-temp 建议只有聚合标签无具体路径；从空目录/明细里选带 temp 段的路径
      paths = safeOnly((rep.emptyDirSample || []).filter(function(p) { return /(\\temp\\|\\tmp\\|\\cache\\|\\prefetch\\|\\thumbcache\\|\\iconcache\\|(^|[\\/])(temp|tmp|cache|prefetch|thumbcache|iconcache)([\\/]|$))/i.test(String(p)) })).slice(0, 200);
      if (paths.length === 0) return fail('未从报告中提取到临时/缓存路径，请显式传入：disk-clean clean junk-temp <path1> <path2> ...');
    } else if (type === 'stale-large') {
      // v0.7.0（v7-4）：MCP 的 disk_clean 一直支持 stale-large，CLI 却缺这个分支 ——
      // 同一个动作两种能力，用户从 CLI 走不通。候选来源是报告的 stale-large 建议明细。
      for (const s of sugg) if (s.type === 'stale-large') for (const it of (s.items || [])) if (it && it.path) paths.push(it.path);
      paths = safeOnly(paths);
      if (paths.length === 0) return fail('未从报告中提取到陈旧大文件候选，请显式传入：disk-clean clean stale-large <path1> <path2> ...');
    } else {
      return fail('未知清理类型: ' + type + '（junk-temp | empty-dirs | duplicates | stale-large | recycle-bin）');
    }
  }
  const dryRun = o.flags['dry-run'] || o.flags.dryRun;
  const yes = o.flags.yes || o.flags.y;
  const v = clean.validate(type, paths, rep);
  if (!v.ok) return fail(v.error);
  // 安全默认：无 --yes 一律 dry-run 预览，绝不真实执行
  if (!dryRun && yes && o.flags['restore-point']) {
    const rp = restoreLib.create('disk-clean clean ' + type);
    if (rp.ok) console.log(col(C.green, '✔ ' + rp.message));
    else console.log(col(C.yellow, '⚠ ' + rp.message + '（继续执行，可在审计日志查看）'));
  }
  const r = await clean.execute(type, v.paths, rep, dryRun || !yes);
  if (!r.ok) return fail(r.error);
  if (r.dryRun) {
    console.log(col(C.yellow, r.note));
    // v7-4 附带：dry-run 是破坏性操作唯一的安全闸门，只说"将清理 N 个路径"却不说是哪些，
    // 用户无从判断。MCP 侧一直返回 paths 清单，CLI 此前没有 —— 这里补齐（与 MCP 一致）。
    const list = r.paths || [];
    if (list.length) {
      console.log(col(C.cyan, '  将处理以下 ' + list.length + ' 项：'));
      for (const p of list.slice(0, 20)) console.log('    ' + p);
      if (list.length > 20) console.log(col(C.gray, '    … 其余 ' + (list.length - 20) + ' 项见报告'));
    }
    console.log(col(C.gray, '  确认执行请加 --yes'));
    return 0;
  }
  console.log(col(C.green, '✔ ' + r.note));
  return 0;
}

// ---------- 命令: audit ----------
async function cmdAudit() {
  const entries = audit.readAudit();
  if (entries.length === 0) { console.log('（暂无审计记录）'); return 0; }
  console.log(col(C.cyan, '── 审计日志 (' + entries.length + ' 条) ──'));
  for (const e of entries.slice(-20)) {
    const t = (e.ts || '').replace('T', ' ').slice(0, 19);
    console.log('  ' + t + '  ' + (e.type || '') + '/' + (e.action || '') + '  ' + (e.result || '') + '  ' + ((e.paths || []).length) + ' 路径');
  }
  console.log(col(C.gray, '  完整日志: ' + audit.auditFile()));
  return 0;
}

// ---------- 命令: dedup（全盘哈希去重） ----------
async function cmdDedup(o) {
  const roots = o._.length > 0 ? o._ : ['C:\\', 'D:\\'];
  const minBytes = o.values.min ? Number(o.values.min) : 0;
  const dryRun = o.flags.dryRun || !o.flags.yes;
  const doHardlink = !!o.flags.hardlink;
  console.log(col(C.cyan, '▶ 全盘重复检测: ') + col(C.bold, roots.join(', ')) + (doHardlink ? '  (硬链接合并)' : ''));
  console.log(col(C.gray, '  排除系统/程序目录；' + (minBytes ? '≥' + fmtBytes(minBytes) : '默认 ≥1MB') + '；哈希策略 head/tail 两阶段' + (doHardlink ? '（--hardlink 需 --yes）' : '')));
  const r = await dedupLib.scan(roots, { minBytes: minBytes || undefined });
  if (!r.ok) return fail(r.error || '去重扫描失败');
  console.log(col(C.green, '✔ 扫描完成  (' + (r.elapsedMs / 1000).toFixed(1) + 's)  候选文件: ' + r.scannedFiles));
  console.log('  重复组: ' + r.groups.length + '  重复占用: ' + fmtBytes(r.totalDupBytes) + '  可释放: ' + col(C.green, fmtBytes(r.totalSaveBytes)));
  if (r.groups.length === 0) { console.log('（未发现重复文件）'); return 0; }
  console.log('');
  console.log(col(C.cyan, '── 重复组 Top 15 ──'));
  const shown = r.groups.slice(0, 15);
  for (const g of shown) {
    console.log('  ' + fmtBytes(g.size).padStart(10) + ' ×' + g.files.length + (g.approx ? ' (近似)' : '') + '  可释放 ' + fmtBytes(g.size * (g.files.length - 1)));
    for (const f of g.files.slice(0, 3)) console.log('    · ' + f.path);
    if (g.files.length > 3) console.log('    … 共 ' + g.files.length + ' 个');
  }
  if (doHardlink) {
    console.log('');
    console.log(col(C.yellow, '⚠ 硬链接合并：将每组保留 1 个，其余转为硬链接（同卷内）。'));
    if (dryRun) {
      console.log(col(C.blue, '  --dry-run 预览：'));
      let plan = 0, refusedN = 0;
      for (const g of r.groups) {
        const rr = dedupLib.hardlinkGroup(g, true);
        for (const x of rr) {
          if (x.action === 'hardlink(预览)') plan++;
          else if (x.action === 'refused') refusedN++;
        }
      }
      console.log('  将合并 ' + plan + ' 个文件为硬链接，释放约 ' + fmtBytes(r.totalSaveBytes) + '。加 --yes 执行。');
      if (refusedN > 0) {
        console.log(col(C.yellow, '  ⚠ 拒绝合并 ' + refusedN + ' 个：仅经 head+tail 抽样比对的近似组（approx）不允许建硬链接，'));
        console.log(col(C.yellow, '    因为内容可能不同、合并后不可逆。请改用 clean duplicates（移入回收站，可恢复）。'));
      }
      return 0;
    }
    let ok = 0, failN = 0, refusedN = 0;
    const merged = [];
    for (const g of r.groups) {
      const rr = dedupLib.hardlinkGroup(g, false);
      for (const x of rr) {
        if (x.action === 'hardlink') { ok++; merged.push(x.to); }
        else if (x.action === 'refused') { refusedN++; if (refusedN <= 5) console.log(col(C.yellow, '  ⊘ ' + x.to + ': ' + (x.error || ''))); }
        else if (x.action === 'fail') { failN++; console.log(col(C.yellow, '  ✗ ' + x.to + ': ' + (x.error || ''))); }
      }
    }
    console.log(col(C.green, '✔ 硬链接合并完成: 成功 ' + ok + '，失败 ' + failN + '，因近似组拒绝 ' + refusedN + '，释放约 ' + fmtBytes(r.totalSaveBytes)));
    if (refusedN > 5) console.log(col(C.gray, '  （以上仅显示前 5 条拒绝明细，共 ' + refusedN + ' 条）'));
    if (ok > 0) {
      // 统一 map schema（评审 A6）：一律写 entries，旧 merged 仅兼容读
      dedupLib.appendDedupEntries(merged.map(function (p) { return { victim: p, keep: null, size: 0, at: new Date().toISOString() }; }));
      console.log(col(C.gray, '  回滚: disk-clean dedup --rollback-hardlinks'));
    }
  }
  return 0;
}

async function cmdDedupRollback(o) {
  // v0.7.0（v7-3）：此前本命令不接收 o、无从检查 --yes，于是
  // `dedup rollback` 会**无条件执行**（回滚会重新占用磁盘空间），
  // 而 organize rollback（:252 `dryRun: dryRun || !yes`）与 MCP 的
  // disk_dedup cmd=rollback（要求 confirm:true）都要求确认 —— 同一动作三种确认模型。
  // 现统一为：不给 --yes 只预览。注意 organize 侧本来就是对的，本次不动它。
  const yes = !!o.flags.yes;
  const dryRun = o.flags['dry-run'] || o.flags.dryRun || !yes;
  // 统一读单一 map（评审 A6）：旧实现只读 map.merged，而 MCP 侧写的是 entries，
  // 于是"AI 合并的文件，CLI 回滚不了"（merged 为空 → 报"没有可回滚记录"）。
  const map = dedupLib.readDedupMap();
  const entries = map.entries.filter(function(e) { return e && e.victim && fs.existsSync(e.victim); });
  if (entries.length === 0) {
    if (map.entries.length === 0) return fail('没有可回滚的硬链接记录 (' + audit.dedupMapFile() + ')');
    console.log('（记录的硬链接文件都已不存在，无需还原）');
    return 0;
  }
  if (dryRun) {
    const bytes = entries.reduce(function(a, e) { return a + (e.size || 0) }, 0);
    console.log(col(C.blue, '预览（dry-run）：将把 ' + entries.length + ' 个硬链接还原为独立副本'));
    for (const e of entries.slice(0, 10)) console.log('  ' + e.victim);
    if (entries.length > 10) console.log(col(C.gray, '  … 共 ' + entries.length + ' 个'));
    if (bytes > 0) console.log('  还原后约重新占用 ' + fmtBytes(bytes) + '（硬链接此前共享同一份数据）');
    console.log(col(C.gray, '  确认执行请加 --yes'));
    return 0;
  }
  const rr = dedupLib.rollbackHardlinks(entries);
  let ok = 0, bad = 0;
  for (const x of rr) { if (x.action === 'restored') ok++; else bad++; }
  // 只删除已成功的记录，失败项保留以便重试（append-only 语义）
  const failedPaths = {};
  for (const x of rr) if (x.action !== 'restored') failedPaths[String(x.path).toLowerCase()] = true;
  const remain = map.entries.filter(function(e) { return failedPaths[String(e.victim).toLowerCase()]; });
  if (remain.length) dedupLib.writeDedupMap(remain);
  else { try { fs.unlinkSync(audit.dedupMapFile()); } catch (e) { /* ignore */ } }
  console.log(col(C.green, '✔ 已还原 ' + ok + ' 个文件为独立副本，回滚完成。') + (bad ? col(C.yellow, '（' + bad + ' 个失败，已保留记录供重试）') : ''));
  return 0;
}

// ---------- 命令: drives（盘符与真实容量） ----------
// v0.7.0（v7-9）：CLI 此前没有这个命令，而 README/文档多处提到盘符信息 ——
// 同一能力 MCP(disk_drives) 与 GUI(/api/drives) 都有，只有 CLI 缺。
// 计算统一走 lib/drives.js（单一事实源），不在这里重算 statfsSync。
async function cmdDrives() {
  const drives = drivesLib.list();
  if (!drives.length) return fail('未发现任何本地盘');
  console.log(col(C.cyan, '▶ 本地盘容量') + col(C.gray, '（来自卷文件系统统计，与资源管理器一致）'));
  console.log('');
  console.log('  ' + col(C.bold, '盘符') + '  ' + col(C.bold, '已用 / 总计').padEnd(26) + col(C.bold, '可用') + '        使用率');
  for (const d of drives) {
    const bar = '█'.repeat(Math.round(d.usedPercent / 5)) + '░'.repeat(20 - Math.round(d.usedPercent / 5));
    const warn = d.usedPercent >= 90 ? col(C.red, '  ⚠ 剩余不足 10%') : '';
    console.log('  ' + d.drive.padEnd(6) + (d.usedText + ' / ' + d.totalText).padEnd(26) +
      d.availText.padStart(9) + '  ' + bar + ' ' + String(d.usedPercent).padStart(5) + '%' + warn);
  }
  return 0;
}

// ---------- 命令: quota（每用户配额分析） ----------
async function cmdQuota(o) {
  const drive = /^[a-zA-Z]:/.test(o._[0] || '') ? o._[0] : 'C:';
  console.log(col(C.cyan, '▶ 配额分析: ') + col(C.bold, drive) + '  (基于 MFT 直读, 需管理员)');
  const r = quotaLib.analyze(drive);
  if (!r.ok) return fail(r.error + '（需要管理员权限且为 NTFS 卷）');
  console.log(col(C.green, '✔ MFT 扫描完成 (' + (r.elapsedMs / 1000).toFixed(1) + 's, ' + r.mftRecords + ' 条记录)'));
  const total = r.users.reduce(function(s, u) { return s + u.bytes; }, 0) + r.systemBytes;
  console.log('  卷总量: ' + fmtBytes(total) + '  系统/其他: ' + fmtBytes(r.systemBytes));
  console.log('');
  console.log(col(C.cyan, '── 用户占用排行 ──'));
  for (const u of r.users) {
    const pct = total > 0 ? (u.bytes / total * 100).toFixed(1) : '0.0';
    console.log('  ' + col(C.bold, u.name).padEnd(20) + fmtBytes(u.bytes).padStart(11) + '  (' + pct + '%)');
    for (const s of u.subdirs) {
      console.log('      ├ ' + s.name.padEnd(10) + fmtBytes(s.bytes).padStart(11));
    }
  }
  if (r.users.length > 1) {
    const top = r.users[0];
    console.log(col(C.gray, '  最大占用用户: ' + top.name + ' (' + fmtBytes(top.bytes) + ')'));
  }
  return 0;
}

// ---------- 命令: health（SMART/SSD 健康） ----------
async function cmdHealth() {
  console.log(col(C.cyan, '▶ 读取磁盘健康数据...'));
  const r = healthLib.check();
  if (!r.ok) return fail(r.error);
  for (const d of r.disks) {
    const lv = d.grade;
    const lvCol = lv === '健康' ? C.green : lv === '注意' ? C.blue : lv === '警告' ? C.yellow : C.red;
    console.log('');
    console.log('  ' + col(C.bold, d.name) + '  [' + col(lvCol, lv) + ']  ' + d.media + '  ' + (d.size ? fmtBytes(d.size) : '?'));
    console.log('    状态: ' + d.health + ' / ' + d.op +
      (d.temp !== null ? '  温度: ' + d.temp + '°C' : '') +
      (d.wear !== null ? '  寿命已用: ' + d.wear + '%' : '') +
      (d.poh !== null ? '  通电: ' + d.poh + 'h' : ''));
    if (d.readErr !== null || d.writeErr !== null) {
      console.log('    读错误: ' + (d.readErr === null ? 'N/A' : d.readErr) + '  写错误: ' + (d.writeErr === null ? 'N/A' : d.writeErr));
    }
    for (const iss of d.issues) console.log('    ' + col(C.yellow, '⚠ ' + iss));
  }
  console.log(col(C.gray, '  数据: ' + r.file));
  return 0;
}

// ---------- 命令: mftscan（NTFS $MFT 直读快速扫描，实验功能） ----------
async function cmdMftScan(o) {
  const drive = o._[0] || 'D:';
  const d = /^([a-zA-Z]):/.exec(drive);
  if (!d) return fail('用法: disk-clean mftscan <盘符>（如 D:；仅 NTFS，需管理员权限）');
  console.log(col(C.cyan, '▶ MFT 直读扫描: ' + d[1].toUpperCase() + ':'));
  const t0 = Date.now();
  const r = mftLib.scan(d[1] + ':');
  if (!r.ok) return fail(r.error + '（需要管理员权限且为 NTFS 卷）');
  const s = r.summary;
  console.log(col(C.green, '✔ 扫描完成  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'));
  console.log('  ' + d[1].toUpperCase() + ':  总大小: ' + fmtBytes(s.totalBytes) + '  文件: ' + s.totalFiles + '  目录: ' + s.totalDirs);
  console.log('  MFT 记录: ' + s.mftRecords + '（含系统文件 ' + s.sysFiles + '）  扫描时间: ' + s.scannedAt);
  console.log('');
  console.log(col(C.cyan, '── 分类 Top 10 ──'));
  for (const c of (r.category || []).slice(0, 10)) {
    console.log('  ' + c.label.padEnd(8) + ' ' + fmtBytes(c.bytes).padStart(10) + '  ' + c.count + ' 文件');
  }
  console.log('');
  console.log(col(C.cyan, '── 占用最大目录 Top 15 ──'));
  for (const t of (r.topDirs || []).slice(0, 15)) {
    console.log('  ' + fmtBytes(t.bytes).padStart(10) + '  ' + t.path + ' (' + t.files + ' 文件)');
  }
  console.log(col(C.gray, '注: MFT 直读为实验功能（需管理员），结果与常规扫描可能存在少量差异。'));
  return 0;
}

// ---------- 命令: schedule ----------
async function cmdSchedule(o) {
  const sub = o._[0] || 'list';
  if (sub === 'add') {
    const name = o._[1];
    if (!name) return fail('用法: disk-clean schedule add <name> --when once|daily|weekly --time HH:MM --roots "C:\\;D:\\" [--day SUN] [--config <file>]');
    const roots = (o.values.roots || '').split(';').filter(Boolean);
    const r = scheduleLib.add({
      name: name, when: o.values.when, day: o.values.day, time: o.values.time,
      roots: roots, config: o.values.config
    }, IS_SEA);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '✔ ' + r.note));
    return 0;
  }
  if (sub === 'run') {
    const name = o._[1];
    if (!name) return fail('用法: disk-clean schedule run <name>');
    console.log(col(C.cyan, '▶ 定时扫描: ' + name));
    const r = await scheduleLib.run(name, run);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '✔ 扫描完成'));
    if (r.summary) {
      console.log('  总大小: ' + fmtBytes(r.summary.totalBytes) + '  文件: ' + (r.summary.totalFiles || 0) + '  目录: ' + (r.summary.totalDirs || 0));
    }
    console.log('  报告  : ' + r.reportFile);
    console.log('  Markdown: ' + r.mdFile);
    return 0;
  }
  if (sub === 'list') {
    const items = scheduleLib.list();
    if (items.length === 0) { console.log('（暂无定时任务）'); return 0; }
    console.log(col(C.cyan, '── 定时任务 ──'));
    for (const it of items) {
      console.log('  ' + it.name + '  ' + it.when + (it.day ? ' ' + it.day : '') + ' ' + it.time + '  状态: ' + it.status + (it.nextRun && it.nextRun !== 'N/A' ? '  下次: ' + it.nextRun : ''));
      console.log('    扫描: ' + it.roots.join(', '));
    }
    return 0;
  }
  if (sub === 'remove') {
    const name = o._[1];
    if (!name) return fail('用法: disk-clean schedule remove <name>');
    const r = scheduleLib.remove(name, IS_SEA);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '✔ ' + r.note));
    return 0;
  }
  return fail('schedule 子命令: add | run | list | remove');
}

// ---------- 命令: config ----------
async function cmdConfig(o) {
  const sub = o._[0] || 'show';
  const file = o.values.config || o.values.file || configLib.configPath();
  if (sub === 'path') { console.log(file); return 0; }
  if (sub === 'show') {
    const cfg = configLib.load(file);
    console.log(col(C.cyan, '── 配置 (' + file + ') ──'));
    console.log(JSON.stringify(cfg, null, 2));
    return 0;
  }
  if (sub === 'set') {
    // 用法: disk-clean config set <json-path> <value>  （如 thresholds.looseMinBytes 209715200）
    const key = o._[1];
    const value = o._[2];
    if (!key || value === undefined) return fail('用法: disk-clean config set <json路径> <值>（如 thresholds.looseMinBytes 209715200）');
    const cfg = configLib.load(file);
    const keys = key.split('.');
    let cur = cfg;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] === undefined || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    const last = keys[keys.length - 1];
    const num = Number(value);
    cur[last] = (value !== '' && !isNaN(num) && String(value).trim() !== '') ? num : value;
    const r = configLib.save(cfg, file);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '✔ ') + key + ' = ' + JSON.stringify(cur[last]) + '  (' + r.file + ')');
    return 0;
  }
  if (sub === 'reset') {
    const r = configLib.save(configLib.DEFAULT_CONFIG, file);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '✔ 配置已重置为默认 (' + r.file + ')'));
    return 0;
  }
  return fail('config 子命令: show | set <path> <value> | reset | path');
}

// ---------- help / version ----------
function help() {
  console.log(col(C.bold, 'disk-clean v' + VER + ' — Windows 磁盘清理与分析 CLI'));
  console.log('');
  console.log('用法: disk-clean <command> [options]');
  console.log('');
  console.log('命令:');
  console.log('  scan [roots...]            扫描磁盘/目录，生成报告 (JSON+Markdown)');
  console.log('                              示例: disk-clean scan C:\\ D:\\');
  console.log('  report [file]              读取报告并渲染 (终端 + Markdown)');
  console.log('  organize plan              生成整理计划 (目录→整理区, 可回滚)');
  console.log('      --include-program      追加程序/游戏目录候选(⚠快捷方式)');
  console.log('  organize apply [file]      执行整理 (默认预览, --yes 执行)');
  console.log('  organize rollback          回滚最后一批整理 (--yes 执行)');
  console.log('  fix-shortcuts <pairs.json> 单独修复指向旧路径的快捷方式');
  console.log('  clean <type> [paths...]    清理: junk-temp|empty-dirs|duplicates|stale-large|recycle-bin');
  console.log('                              (默认预览, --yes 执行; 移入回收站可恢复)');
  console.log('  audit                      查看操作审计日志');
  console.log('  config                     查看/设置规则配置 (show|set|reset|path)');
  console.log('  schedule                   定时扫描: add|run|list|remove (仅扫描+报告, 不做清理)');
  console.log('  mftscan <盘符>             实验: NTFS MFT 直读快速扫描 (需管理员, ~8x 提速)');
  console.log('  drives                     列出本地盘符与真实容量 (总/已用/可用/使用率)');
  console.log('  health                     磁盘健康检查 (SMART/SSD Wear/温度)');
  console.log('  dedup [roots...]           全盘重复文件检测 (排除系统/程序目录)');
  console.log('      --hardlink             可选: 重复文件转硬链接省空间 (需 --yes, 可回滚)');
  console.log('  dedup rollback             回滚硬链接合并 (--yes 执行)');
  console.log('  quota [盘符]               每用户配额分析 (MFT 直读, 需管理员)');
  console.log('  serve --port <p> --token <t> --web <dir>   GUI 引擎 HTTP 服务');
  console.log('  mcp                         MCP Server（stdio，供 AI 客户端调用磁盘工具）');
  console.log('                              (仅绑定 127.0.0.1, Bearer 鉴权, 常驻)');
  console.log('  clean / organize apply --restore-point   执行前先建系统还原点 (失败不中断)');
  console.log('');
  console.log('通用选项:');
  console.log('  --report <file>  指定报告文件位置');
  console.log('  --exclude a;b    扫描排除路径');
  console.log('  --dry-run        只预览不执行');
  console.log('  --yes / -y       确认执行破坏性操作');
  console.log('  --help / -h      帮助   --version / -v 版本');
  return 0;
}

function fail(msg) {
  console.error(col(C.red, '✗ ' + msg));
  return 1;
}

// ---------- 命令: serve（GUI 引擎 HTTP 服务，常驻不退出） ----------
async function cmdServe(o) {
  const serveLib = require('../lib/serve.js');
  const port = o.values.port ? Number(o.values.port) : 0;
  const token = o.values.token || '';
  const web = o.values.web || '';
  if (!token) return fail('serve 需要 --token <随机口令>（由 GUI 壳生成传入）');
  console.log(col(C.cyan, '▶ 启动 GUI 引擎服务: ') + col(C.bold, '127.0.0.1:' + (port || '随机端口')));
  if (web) console.log(col(C.gray, '  前端目录: ' + web));
  serveLib.start({ port: port, token: token, web: web });
  // 常驻：不 resolve，由 HTTP 服务器维持事件循环
  return new Promise(function() { /* keep alive */ });
}

// ---------- 命令: mcp（MCP Server，stdio 常驻） ----------
// stdout 是 MCP 协议通道：此模式下除协议消息外不得打印任何东西。
function cmdMcp() {
  const { createServer } = require('../lib/mcp/server.js');
  const mcpTools = require('../lib/mcp/tools.js');
  const list = mcpTools.tools();
  const server = createServer({
    tools: list,
    serverInfo: { name: mcpTools.SERVER_INFO.name, version: VER },
    log: function (line) { process.stderr.write('[disk-clean-mcp] ' + line + '\n'); },
  });
  process.stderr.write('[disk-clean-mcp] ready: ' + mcpTools.SERVER_INFO.name + ' v' + VER + ' (' + list.length + ' tools)\n');
  server.start();
  // 常驻：MCP 会话由 stdin 关闭（EOF）结束，届时 server 自行 exit(0)
  return new Promise(function () {});
}

// ---------- main ----------
async function main() {
  const argv = process.argv.slice(2);
  const o = parseOpts(argv);
  const cmd = o._[0];
  o._ = o._.slice(1);
  try {
    switch (cmd) {
      case 'scan': return await cmdScan(o);
      case 'report': return await cmdReport(o);
      case 'organize': return await cmdOrganize(o);
      case 'fix-shortcuts': return await cmdFixShortcuts(o);
      case 'clean': return await cmdClean(o);
      case 'audit': return await cmdAudit();
      case 'config': return await cmdConfig(o);
      case 'schedule': return await cmdSchedule(o);
      case 'serve': return await cmdServe(o);
      case 'mcp': return await cmdMcp(o);
      case 'mftscan': return await cmdMftScan(o);
      case 'health': return await cmdHealth();
      case 'drives': return await cmdDrives();
      case 'quota': return await cmdQuota(o);
      case 'dedup': {
        if (o._[0] === 'rollback') return await cmdDedupRollback(o);
        return await cmdDedup(o);
      }
      case 'version': case '-v': case '--version': console.log('disk-clean v' + VER); return 0;
      case 'help': case '-h': case '--help': case undefined:
        if (o.flags.version || o.flags.v) { console.log('disk-clean v' + VER); return 0; }
        return help();
      default: return fail('未知命令: ' + cmd + '（--help 查看用法）');
    }
  } catch (e) {
    return fail('运行时错误: ' + (e && e.stack ? e.stack : String(e)));
  }
}

main().then(function(code) { process.exit(code || 0) });
