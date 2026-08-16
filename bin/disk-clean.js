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
const VER = '0.1.0';

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
    const md = buildMarkdown(rep, rep.elapsedMs || 0);
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
    const r = await organize.apply(planItems, { roots: roots, dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, '（dry-run 预览）' + r.note));
      console.log(col(C.gray, '  确认执行请加 --yes'));
      return 0;
    }
    console.log(col(C.green, '✔ ' + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, '  ✗ ' + f.src + ' → ' + f.dst + ' (' + f.reason + ')'));
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
    const safeOnly = function(list) { return (list || []).filter(function(p) { return !/\\windows\\|\\program files\\|\\program files \(x86\)\\|\\programdata\\|\\winsxs\\|\\system volume information\\|\\\$recycle\.bin\\/i.test(String(p).toLowerCase()) }) };
    if (type === 'duplicates') {
      for (const s of sugg) if (s.type === 'duplicates') for (const g of (s.groups || [])) paths = paths.concat(safeOnly(g.removable || []));
    } else if (type === 'empty-dirs') {
      paths = safeOnly((rep.emptyDirSample || []).slice(0, 200));
    } else if (type === 'junk-temp') {
      // junk-temp 建议只有聚合标签无具体路径；从空目录/明细里选带 temp 段的路径
      paths = safeOnly((rep.emptyDirSample || []).filter(function(p) { return /(\\temp\\|\\tmp\\|\\cache\\|\\prefetch\\|\\thumbcache\\|\\iconcache\\|(^|[\\/])(temp|tmp|cache|prefetch|thumbcache|iconcache)([\\/]|$))/i.test(String(p)) })).slice(0, 200);
      if (paths.length === 0) return fail('未从报告中提取到临时/缓存路径，请显式传入：disk-clean clean junk-temp <path1> <path2> ...');
    } else {
      return fail('未知清理类型: ' + type + '（junk-temp | empty-dirs | duplicates | recycle-bin）');
    }
  }
  const dryRun = o.flags['dry-run'] || o.flags.dryRun;
  const yes = o.flags.yes || o.flags.y;
  const v = clean.validate(type, paths, rep);
  if (!v.ok) return fail(v.error);
  // 安全默认：无 --yes 一律 dry-run 预览，绝不真实执行
  const r = await clean.execute(type, v.paths, rep, dryRun || !yes);
  if (!r.ok) return fail(r.error);
  if (r.dryRun) {
    console.log(col(C.yellow, r.note));
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
  console.log('  clean <type> [paths...]    清理: junk-temp|empty-dirs|duplicates|recycle-bin');
  console.log('                              (默认预览, --yes 执行; 移入回收站可恢复)');
  console.log('  audit                      查看操作审计日志');
  console.log('  config                     查看/设置规则配置 (show|set|reset|path)');
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
