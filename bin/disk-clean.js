#!/usr/bin/env node
// disk-clean 鈥?Windows 纾佺洏娓呯悊涓庡垎鏋?CLI
// 鐢ㄦ硶瑙?--help銆傚畨鍏ㄩ粯璁わ細鎵€鏈夌牬鍧忔€ф搷浣滈渶 --yes 鏄惧紡纭锛屽厛 --dry-run 棰勮銆?'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// require 鐢ㄥ瓧闈㈤噺璺緞锛氭墦鍖呭櫒锛坋sbuild/pkg锛夐潤鎬佸垎鏋愭墠鑳藉唴鑱斾緷璧?const { run, buildMarkdown } = require('../lib/engine.js');
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

// ---------- 鍐呴儴寮曟搸鐩磋窇妯″紡锛圫EA 鍗曟枃浠剁幆澧冿細scan 瀛愯繘绋嬬敤 --internal-scan 鑷垜璋冪敤锛?----------
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
const VER = '0.2.0';

// SEA锛堝崟鏂囦欢 exe锛夋娴嬶細node 鐜 spawn 闇€甯﹁剼鏈矾寰勶紝SEA 鐜鐩存帴鑷垜璋冪敤
let IS_SEA = false;
try { IS_SEA = !!(require('node:sea') && require('node:sea').isSea()); } catch (e) { IS_SEA = false; }

// ---------- 缁堢杈撳嚭 ----------
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

// ---------- 鍛戒护: scan ----------
async function cmdScan(o) {
  const roots = (o._.length ? o._ : await listDrives());
  if (roots.length === 0) return fail('鏈寚瀹氭壂鎻忔牴鐩綍');
  const reportPath = o.values.report || audit.reportFile();
  const progressPath = path.join(os.tmpdir(), 'dsk-progress-' + process.pid + '.json');
  const ex = (o.values.exclude || '').split(';').filter(Boolean);
  const argv = ['--roots', roots.join(';'), '--suggest'];
  if (o.values.exclude) argv.push('--exclude', o.values.exclude);
  if (o.values.config) argv.push('--config', o.values.config);
  if (o.values.lang) argv.push('--lang', o.values.lang);
  argv.push('--report', reportPath, '--progress', progressPath);
  console.log(col(C.cyan, '鈻?姝ｅ湪鎵弿:') + ' ' + col(C.bold, roots.join(', ')));
  // 鍚庡彴瀛愯繘绋嬭窇寮曟搸锛圫EA/pkg 鐜涓嬭嚜鎴戣皟鐢?--internal-scan锛夛紝涓昏繘绋嬭疆璇㈣繘搴?  const selfArgs = IS_SEA ? ['--internal-scan'] : [__filename, '--internal-scan'];
  const proc = spawn(process.execPath, selfArgs.concat(argv), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuf = '', stderrBuf = '';
  proc.stdout.on('data', function(d) { stdoutBuf += d.toString('utf8') });
  proc.stderr.on('data', function(d) { stderrBuf += d.toString('utf8') });
  const t0 = Date.now();
  const timer = setInterval(function() {
    let p = null;
    try { p = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch (e) { /* 鏈氨缁?*/ }
    if (p && !p.done) {
      process.stdout.write('\r' + col(C.dim, '  鏂囦欢 ' + p.files + ' | 鐩綍 ' + p.dirs + ' | ' + fmtBytes(p.bytes || 0) + (p.currentPath ? ' | ' + p.currentPath : '')) + '   ');
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
    let msg = stderrBuf.trim() || ('鎵弿澶辫触 (exit ' + code + ')');
    try { const j = JSON.parse(lastLine); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
    return fail('鎵弿澶辫触: ' + msg);
  }
  // 璇绘姤鍛婃覆鏌?  const rep = audit.readJson(reportPath);
  if (!rep) return fail('鎵弿瀹屾垚浣嗘棤娉曡鍙栨姤鍛? ' + reportPath);
  try {
    const lang = i18nLib.detect(o.values.lang);
    const md = buildMarkdown(rep, rep.elapsedMs || 0, lang);
    fs.writeFileSync(audit.mdFile(), md, 'utf8');
  } catch (e) { /* md 鐢熸垚澶辫触涓嶉樆鏂?*/ }
  const s = rep.summary || {};
  console.log(col(C.green, '鉁?鎵弿瀹屾垚') + '  (' + elapsed + 's)');
  console.log('  鏍圭洰褰?  : ' + (s.roots || []).join(', '));
  console.log('  鎬诲ぇ灏?  : ' + col(C.bold, fmtBytes(s.totalBytes)));
  console.log('  鏂囦欢     : ' + (s.totalFiles || 0) + '  鐩綍: ' + (s.totalDirs || 0) + '  绌虹洰褰? ' + (s.emptyDirs || 0));
  console.log('  鎶ュ憡     : ' + reportPath);
  console.log('  Markdown : ' + audit.mdFile());
  printSuggestSummary(rep);
  if (rep.suggestions && rep.suggestions.length === 0 && !rep.suggestError) {
    console.log(col(C.gray, '  (鏃犳櫤鑳藉缓璁?'));
  }
  return 0;
}

function printSuggestSummary(rep) {
  const sugg = rep.suggestions || [];
  if (sugg.length === 0) return;
  console.log(col(C.cyan, '\n鈹€鈹€ 鏅鸿兘寤鸿 鈹€鈹€'));
  for (const s of sugg) {
    const n = (s.items || []).length;
    let b = 0;
    for (const it of (s.items || [])) b += it.bytes || 0;
    const tag = col(C.yellow, '[' + (s.type || '?') + ']');
    const count = n + ' 椤?;
    console.log('  ' + tag + ' ' + (s.label || s.type) + ' 鈥?' + count + (b > 0 ? ' (' + fmtBytes(b) + ')' : ''));
  }
  const oc = rep.organizeCandidates || [];
  if (oc.length > 0) {
    console.log(col(C.cyan, '鈹€鈹€ 鏁ｈ惤鐩綍鍊欓€?鈹€鈹€'));
    for (const c of oc.slice(0, 10)) {
      console.log('  路 ' + c.path + col(C.gray, ' (' + fmtBytes(c.bytes) + ', ' + c.cat + ')'));
    }
  }
}

async function listDrives() {
  // 鍒楀嚭鏈湴鐩橈紙绠€鍗曠増锛欰-Z 鏍瑰瓨鍦級
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const ch = String.fromCharCode(i);
    try { fs.accessSync(ch + ':\\'); out.push(ch + ':\\'); } catch (e) { /* skip */ }
  }
  return out;
}

// ---------- 鍛戒护: report ----------
async function cmdReport(o) {
  const p = o._[0] || audit.reportFile();
  const rep = audit.readJson(p);
  if (!rep) return fail('鏃犳硶璇诲彇鎶ュ憡: ' + p + '锛堣鍏堣繍琛?scan锛?);
  const s = rep.summary || {};
  console.log(col(C.cyan, '鈹€鈹€ 纾佺洏鍒嗘瀽鎶ュ憡 鈹€鈹€'));
  console.log('  鏍圭洰褰?  : ' + (s.roots || []).join(', '));
  console.log('  鎬诲ぇ灏?  : ' + col(C.bold, fmtBytes(s.totalBytes)) + '  鏂囦欢: ' + (s.totalFiles || 0) + '  鐩綍: ' + (s.totalDirs || 0));
  if (rep.category && rep.category.length) {
    console.log(col(C.cyan, '鈹€鈹€ 绫诲埆鍒嗗竷 鈹€鈹€'));
    const max = rep.category.reduce(function(a, c) { return Math.max(a, c.bytes || 0) }, 1);
    for (const c of rep.category.slice(0, 12)) {
      const w = Math.round(((c.bytes || 0) / max) * 24);
      console.log('  ' + (c.label || '?').padEnd(8) + ' ' + col(C.blue, '鈻?.repeat(w)) + col(C.gray, '鈻?.repeat(Math.max(0, 24 - w))) + ' ' + fmtBytes(c.bytes) + '  ' + (c.count || 0) + ' 鏂囦欢');
    }
  }
  printSuggestSummary(rep);
  // 鐢熸垚 markdown
  try {
    const md = buildMarkdown(rep, rep.elapsedMs || 0);
    const mdPath = p.replace(/\.json$/i, '') + '.md';
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(col(C.green, '鉁?Markdown 鎶ュ憡: ') + mdPath);
  } catch (e) {
    console.log(col(C.yellow, '! Markdown 鐢熸垚澶辫触: ' + e.message));
  }
  return 0;
}

// ---------- 鍛戒护: organize ----------
async function cmdOrganize(o) {
  const sub = o._[0];
  const reportFile = o.values.report || audit.reportFile();
  if (sub === 'plan') {
    const includeProgram = o.flags['include-program'] || o.flags.includeProgram;
    const r = await organize.plan({ includeProgram: includeProgram, reportFile: reportFile });
    if (!r.ok) return fail(r.error);
    if (r.items.length === 0) { console.log(col(C.yellow, '锛? + r.note + '锛?)); return 0; }
    console.log(col(C.cyan, '鈹€鈹€ 鏁寸悊璁″垝 鈹€鈹€') + ' ' + r.note);
    for (const it of r.items) {
      const tag = it.kind === 'program' ? col(C.red, '[绋嬪簭]') : (it.kind === 'dir' ? col(C.blue, '[鐩綍]') : col(C.green, '[鏂囦欢]'));
      console.log('  ' + tag + ' ' + it.src + col(C.gray, ' 鈫?' + it.dst + ' (' + fmtBytes(it.bytes) + ')'));
      if (it.kind === 'program' && it.warn) console.log('        ' + col(C.yellow, '鈿?' + it.warn));
    }
    // 钀界洏璁″垝渚?apply 浣跨敤
    audit.writeJson(audit.planFile(), r.items);
    console.log(col(C.gray, '  璁″垝宸蹭繚瀛? ') + audit.planFile());
    console.log(col(C.gray, '  鎵ц: disk-clean organize apply --yes'));
    return 0;
  }
  if (sub === 'apply') {
    const dryRun = o.flags['dry-run'] || o.flags.dryRun;
    const yes = o.flags.yes || o.flags.y;
    const planItems = audit.readJson(o._[1] || audit.planFile());
    if (!Array.isArray(planItems) || planItems.length === 0) return fail('缂哄皯鏁寸悊璁″垝锛堝厛杩愯 organize plan锛?);
    const roots = await currentScanRoots(reportFile);
    // 瀹夊叏榛樿锛氭棤 --yes 涓€寰?dry-run 棰勮锛岀粷涓嶇湡瀹炴墽琛?    if (!dryRun && yes && o.flags['restore-point']) {
      const rp = restoreLib.create('disk-clean organize apply');
      if (rp.ok) console.log(col(C.green, '鉁?' + rp.message));
      else console.log(col(C.yellow, '鈿?' + rp.message + '锛堢户缁墽琛岋紝鍙湪瀹¤鏃ュ織鏌ョ湅锛?));
    }
    const r = await organize.apply(planItems, { roots: roots, dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, '锛坉ry-run 棰勮锛? + r.note));
      console.log(col(C.gray, '  纭鎵ц璇峰姞 --yes'));
      return 0;
    }
    console.log(col(C.green, '鉁?' + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, '  鉁?' + f.src + ' 鈫?' + f.dst + ' (' + f.reason + ')'));
    return 0;
  }
  if (sub === 'rollback') {
    const dryRun = o.flags['dry-run'] || o.flags.dryRun;
    const yes = o.flags.yes || o.flags.y;
    const r = await organize.rollback({ dryRun: dryRun || !yes });
    if (!r.ok) return fail(r.error);
    if (r.dryRun) {
      console.log(col(C.yellow, '锛坉ry-run 棰勮锛? + r.note));
      console.log(col(C.gray, '  纭鍥炴粴璇峰姞 --yes'));
      return 0;
    }
    console.log(col(C.green, '鉁?' + r.note));
    if (r.failed && r.failed.length) for (const f of r.failed) console.log(col(C.red, '  鉁?' + f.src + ' (' + f.reason + ')'));
    return 0;
  }
  return fail('organize 瀛愬懡浠? plan | apply | rollback');
}

async function currentScanRoots(reportFile) {
  const rep = audit.readJson(reportFile);
  if (rep && rep.summary && Array.isArray(rep.summary.roots)) return rep.summary.roots;
  return [];
}

// ---------- 鍛戒护: fix-shortcuts ----------
async function cmdFixShortcuts(o) {
  const p = o._[0];
  if (!p) return fail('鐢ㄦ硶: disk-clean fix-shortcuts <pairs.json>');
  const pairs = audit.readJson(p);
  if (!Array.isArray(pairs) || pairs.length === 0) return fail('鏃犳晥鐨勪慨澶嶆竻鍗?);
  const r = await organize.fixShortcuts(pairs);
  if (!r.ok) return fail(r.error);
  console.log(col(C.green, '鉁?鎵弿 ' + r.scanned + ' 涓揩鎹锋柟寮忥紝淇 ' + (r.fixed || []).length + ' 涓?));
  for (const f of (r.fixed || []).slice(0, 10)) console.log('  路 ' + f.lnk);
  return 0;
}

// ---------- 鍛戒护: clean ----------
async function cmdClean(o) {
  const type = o._[0];
  const reportFile = o.values.report || audit.reportFile();
  const rep = audit.readJson(reportFile);
  if (!rep) return fail('鏈壘鍒版壂鎻忔姤鍛婏紙璇峰厛杩愯 scan锛?);
  let paths = [];
  if (type === 'recycle-bin') {
    paths = [];
  } else if (o._.length > 1) {
    paths = o._.slice(1);
  } else {
    // 浠庡缓璁嚜鍔ㄦ彁鍙栧€欓€夛紙浠呴檺鏈夊叿浣撹矾寰勭殑绫诲瀷锛涚郴缁熺洰褰曞€欓€変繚瀹堣烦杩囪€岄潪鎶ラ敊锛?    const sugg = rep.suggestions || [];
    const safeOnly = function(list) { return (list || []).filter(function(p) { return !/\\windows\\|\\program files\\|\\program files \(x86\)\\|\\programdata\\|\\winsxs\\|\\system volume information\\|\\\$recycle\.bin\\/i.test(String(p).toLowerCase()) }) };
    if (type === 'duplicates') {
      for (const s of sugg) if (s.type === 'duplicates') for (const g of (s.groups || [])) paths = paths.concat(safeOnly(g.removable || []));
    } else if (type === 'empty-dirs') {
      paths = safeOnly((rep.emptyDirSample || []).slice(0, 200));
    } else if (type === 'junk-temp') {
      // junk-temp 寤鸿鍙湁鑱氬悎鏍囩鏃犲叿浣撹矾寰勶紱浠庣┖鐩綍/鏄庣粏閲岄€夊甫 temp 娈电殑璺緞
      paths = safeOnly((rep.emptyDirSample || []).filter(function(p) { return /(\\temp\\|\\tmp\\|\\cache\\|\\prefetch\\|\\thumbcache\\|\\iconcache\\|(^|[\\/])(temp|tmp|cache|prefetch|thumbcache|iconcache)([\\/]|$))/i.test(String(p)) })).slice(0, 200);
      if (paths.length === 0) return fail('鏈粠鎶ュ憡涓彁鍙栧埌涓存椂/缂撳瓨璺緞锛岃鏄惧紡浼犲叆锛歞isk-clean clean junk-temp <path1> <path2> ...');
    } else {
      return fail('鏈煡娓呯悊绫诲瀷: ' + type + '锛坖unk-temp | empty-dirs | duplicates | recycle-bin锛?);
    }
  }
  const dryRun = o.flags['dry-run'] || o.flags.dryRun;
  const yes = o.flags.yes || o.flags.y;
  const v = clean.validate(type, paths, rep);
  if (!v.ok) return fail(v.error);
  // 瀹夊叏榛樿锛氭棤 --yes 涓€寰?dry-run 棰勮锛岀粷涓嶇湡瀹炴墽琛?  if (!dryRun && yes && o.flags['restore-point']) {
    const rp = restoreLib.create('disk-clean clean ' + type);
    if (rp.ok) console.log(col(C.green, '鉁?' + rp.message));
    else console.log(col(C.yellow, '鈿?' + rp.message + '锛堢户缁墽琛岋紝鍙湪瀹¤鏃ュ織鏌ョ湅锛?));
  }
  const r = await clean.execute(type, v.paths, rep, dryRun || !yes);
  if (!r.ok) return fail(r.error);
  if (r.dryRun) {
    console.log(col(C.yellow, r.note));
    console.log(col(C.gray, '  纭鎵ц璇峰姞 --yes'));
    return 0;
  }
  console.log(col(C.green, '鉁?' + r.note));
  return 0;
}

// ---------- 鍛戒护: audit ----------
async function cmdAudit() {
  const entries = audit.readAudit();
  if (entries.length === 0) { console.log('锛堟殏鏃犲璁¤褰曪級'); return 0; }
  console.log(col(C.cyan, '鈹€鈹€ 瀹¤鏃ュ織 (' + entries.length + ' 鏉? 鈹€鈹€'));
  for (const e of entries.slice(-20)) {
    const t = (e.ts || '').replace('T', ' ').slice(0, 19);
    console.log('  ' + t + '  ' + (e.type || '') + '/' + (e.action || '') + '  ' + (e.result || '') + '  ' + ((e.paths || []).length) + ' 璺緞');
  }
  console.log(col(C.gray, '  瀹屾暣鏃ュ織: ' + audit.auditFile()));
  return 0;
}

// ---------- 鍛戒护: dedup锛堝叏鐩樺搱甯屽幓閲嶏級 ----------
async function cmdDedup(o) {
  const roots = o._.length > 0 ? o._ : ['C:\\', 'D:\\'];
  const minBytes = o.values.min ? Number(o.values.min) : 0;
  const dryRun = o.flags.dryRun || !o.flags.yes;
  const doHardlink = !!o.flags.hardlink;
  console.log(col(C.cyan, '鈻?鍏ㄧ洏閲嶅妫€娴? ') + col(C.bold, roots.join(', ')) + (doHardlink ? '  (纭摼鎺ュ悎骞?' : ''));
  console.log(col(C.gray, '  鎺掗櫎绯荤粺/绋嬪簭鐩綍锛? + (minBytes ? '鈮? + fmtBytes(minBytes) : '榛樿 鈮?MB') + '锛涘搱甯岀瓥鐣?head/tail 涓ら樁娈? + (doHardlink ? '锛?-hardlink 闇€ --yes锛? : '')));
  const r = await dedupLib.scan(roots, { minBytes: minBytes || undefined });
  if (!r.ok) return fail(r.error || '鍘婚噸鎵弿澶辫触');
  console.log(col(C.green, '鉁?鎵弿瀹屾垚  (' + (r.elapsedMs / 1000).toFixed(1) + 's)  鍊欓€夋枃浠? ' + r.scannedFiles));
  console.log('  閲嶅缁? ' + r.groups.length + '  閲嶅鍗犵敤: ' + fmtBytes(r.totalDupBytes) + '  鍙噴鏀? ' + col(C.green, fmtBytes(r.totalSaveBytes)));
  if (r.groups.length === 0) { console.log('锛堟湭鍙戠幇閲嶅鏂囦欢锛?); return 0; }
  console.log('');
  console.log(col(C.cyan, '鈹€鈹€ 閲嶅缁?Top 15 鈹€鈹€'));
  const shown = r.groups.slice(0, 15);
  for (const g of shown) {
    console.log('  ' + fmtBytes(g.size).padStart(10) + ' 脳' + g.files.length + (g.approx ? ' (杩戜技)' : '') + '  鍙噴鏀?' + fmtBytes(g.size * (g.files.length - 1)));
    for (const f of g.files.slice(0, 3)) console.log('    路 ' + f.path);
    if (g.files.length > 3) console.log('    鈥?鍏?' + g.files.length + ' 涓?);
  }
  if (doHardlink) {
    console.log('');
    console.log(col(C.yellow, '鈿?纭摼鎺ュ悎骞讹細灏嗘瘡缁勪繚鐣?1 涓紝鍏朵綑杞负纭摼鎺ワ紙鍚屽嵎鍐咃級銆?));
    if (dryRun) {
      console.log(col(C.blue, '  --dry-run 棰勮锛?));
      let plan = 0;
      for (const g of r.groups) {
        const rr = dedupLib.hardlinkGroup(g, true);
        for (const x of rr) { if (x.action === 'hardlink(棰勮)') plan++; }
      }
      console.log('  灏嗗悎骞?' + plan + ' 涓枃浠朵负纭摼鎺ワ紝閲婃斁绾?' + fmtBytes(r.totalSaveBytes) + '銆傚姞 --yes 鎵ц銆?);
      return 0;
    }
    let ok = 0, failN = 0;
    const merged = [];
    for (const g of r.groups) {
      const rr = dedupLib.hardlinkGroup(g, false);
      for (const x of rr) {
        if (x.action === 'hardlink') { ok++; merged.push(x.to); }
        else if (x.action === 'fail') { failN++; console.log(col(C.yellow, '  鉁?' + x.to + ': ' + (x.error || ''))); }
      }
    }
    console.log(col(C.green, '鉁?纭摼鎺ュ悎骞跺畬鎴? 鎴愬姛 ' + ok + '锛屽け璐?' + failN + '锛岄噴鏀剧害 ' + fmtBytes(r.totalSaveBytes)));
    if (ok > 0) {
      fs.writeFileSync(path.join(os.homedir(), '.disk-clean', 'dedup-map.json'), JSON.stringify({ at: new Date().toISOString(), merged: merged }, null, 2), 'utf8');
      console.log(col(C.gray, '  鍥炴粴: disk-clean dedup --rollback-hardlinks'));
    }
  }
  return 0;
}

async function cmdDedupRollback() {
  const mapFile = path.join(os.homedir(), '.disk-clean', 'dedup-map.json');
  let map;
  try {
    let raw = fs.readFileSync(mapFile, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    map = JSON.parse(raw);
  } catch (e) { return fail('娌℃湁鍙洖婊氱殑纭摼鎺ヨ褰?(' + mapFile + ')'); }
  const merged = (map.merged || []).filter(function(p) { return fs.existsSync(p); });
  if (merged.length === 0) { console.log('锛堟病鏈夐渶瑕佽繕鍘熺殑纭摼鎺ユ枃浠讹級'); return 0; }
  const rr = dedupLib.rollbackHardlinks(merged);
  let ok = 0;
  for (const x of rr) { if (x.action === 'restored') ok++; }
  fs.unlinkSync(mapFile);
  console.log(col(C.green, '鉁?宸茶繕鍘?' + ok + ' 涓枃浠朵负鐙珛鍓湰锛屽洖婊氬畬鎴愩€?));
  return 0;
}

// ---------- 鍛戒护: quota锛堟瘡鐢ㄦ埛閰嶉鍒嗘瀽锛?----------
async function cmdQuota(o) {
  const drive = /^[a-zA-Z]:/.test(o._[0] || '') ? o._[0] : 'C:';
  console.log(col(C.cyan, '鈻?閰嶉鍒嗘瀽: ') + col(C.bold, drive) + '  (鍩轰簬 MFT 鐩磋, 闇€绠＄悊鍛?');
  const r = quotaLib.analyze(drive);
  if (!r.ok) return fail(r.error + '锛堥渶瑕佺鐞嗗憳鏉冮檺涓斾负 NTFS 鍗凤級');
  console.log(col(C.green, '鉁?MFT 鎵弿瀹屾垚 (' + (r.elapsedMs / 1000).toFixed(1) + 's, ' + r.mftRecords + ' 鏉¤褰?'));
  const total = r.users.reduce(function(s, u) { return s + u.bytes; }, 0) + r.systemBytes;
  console.log('  鍗锋€婚噺: ' + fmtBytes(total) + '  绯荤粺/鍏朵粬: ' + fmtBytes(r.systemBytes));
  console.log('');
  console.log(col(C.cyan, '鈹€鈹€ 鐢ㄦ埛鍗犵敤鎺掕 鈹€鈹€'));
  for (const u of r.users) {
    const pct = total > 0 ? (u.bytes / total * 100).toFixed(1) : '0.0';
    console.log('  ' + col(C.bold, u.name).padEnd(20) + fmtBytes(u.bytes).padStart(11) + '  (' + pct + '%)');
    for (const s of u.subdirs) {
      console.log('      鈹?' + s.name.padEnd(10) + fmtBytes(s.bytes).padStart(11));
    }
  }
  if (r.users.length > 1) {
    const top = r.users[0];
    console.log(col(C.gray, '  鏈€澶у崰鐢ㄧ敤鎴? ' + top.name + ' (' + fmtBytes(top.bytes) + ')'));
  }
  return 0;
}

// ---------- 鍛戒护: health锛圫MART/SSD 鍋ュ悍锛?----------
async function cmdHealth() {
  console.log(col(C.cyan, '鈻?璇诲彇纾佺洏鍋ュ悍鏁版嵁...'));
  const r = healthLib.check();
  if (!r.ok) return fail(r.error);
  for (const d of r.disks) {
    const lv = d.grade;
    const lvCol = lv === '鍋ュ悍' ? C.green : lv === '娉ㄦ剰' ? C.blue : lv === '璀﹀憡' ? C.yellow : C.red;
    console.log('');
    console.log('  ' + col(C.bold, d.name) + '  [' + col(lvCol, lv) + ']  ' + d.media + '  ' + (d.size ? fmtBytes(d.size) : '?'));
    console.log('    鐘舵€? ' + d.health + ' / ' + d.op +
      (d.temp !== null ? '  娓╁害: ' + d.temp + '掳C' : '') +
      (d.wear !== null ? '  瀵垮懡宸茬敤: ' + d.wear + '%' : '') +
      (d.poh !== null ? '  閫氱數: ' + d.poh + 'h' : ''));
    if (d.readErr !== null || d.writeErr !== null) {
      console.log('    璇婚敊璇? ' + (d.readErr === null ? 'N/A' : d.readErr) + '  鍐欓敊璇? ' + (d.writeErr === null ? 'N/A' : d.writeErr));
    }
    for (const iss of d.issues) console.log('    ' + col(C.yellow, '鈿?' + iss));
  }
  console.log(col(C.gray, '  鏁版嵁: ' + r.file));
  return 0;
}

// ---------- 鍛戒护: mftscan锛圢TFS $MFT 鐩磋蹇€熸壂鎻忥紝瀹為獙鍔熻兘锛?----------
async function cmdMftScan(o) {
  const drive = o._[0] || 'D:';
  const d = /^([a-zA-Z]):/.exec(drive);
  if (!d) return fail('鐢ㄦ硶: disk-clean mftscan <鐩樼>锛堝 D:锛涗粎 NTFS锛岄渶绠＄悊鍛樻潈闄愶級');
  console.log(col(C.cyan, '鈻?MFT 鐩磋鎵弿: ' + d[1].toUpperCase() + ':'));
  const t0 = Date.now();
  const r = mftLib.scan(d[1] + ':');
  if (!r.ok) return fail(r.error + '锛堥渶瑕佺鐞嗗憳鏉冮檺涓斾负 NTFS 鍗凤級');
  const s = r.summary;
  console.log(col(C.green, '鉁?鎵弿瀹屾垚  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'));
  console.log('  ' + d[1].toUpperCase() + ':  鎬诲ぇ灏? ' + fmtBytes(s.totalBytes) + '  鏂囦欢: ' + s.totalFiles + '  鐩綍: ' + s.totalDirs);
  console.log('  MFT 璁板綍: ' + s.mftRecords + '锛堝惈绯荤粺鏂囦欢 ' + s.sysFiles + '锛? 鎵弿鏃堕棿: ' + s.scannedAt);
  console.log('');
  console.log(col(C.cyan, '鈹€鈹€ 鍒嗙被 Top 10 鈹€鈹€'));
  for (const c of (r.category || []).slice(0, 10)) {
    console.log('  ' + c.label.padEnd(8) + ' ' + fmtBytes(c.bytes).padStart(10) + '  ' + c.count + ' 鏂囦欢');
  }
  console.log('');
  console.log(col(C.cyan, '鈹€鈹€ 鍗犵敤鏈€澶х洰褰?Top 15 鈹€鈹€'));
  for (const t of (r.topDirs || []).slice(0, 15)) {
    console.log('  ' + fmtBytes(t.bytes).padStart(10) + '  ' + t.path + ' (' + t.files + ' 鏂囦欢)');
  }
  console.log(col(C.gray, '娉? MFT 鐩磋涓哄疄楠屽姛鑳斤紙闇€绠＄悊鍛橈級锛岀粨鏋滀笌甯歌鎵弿鍙兘瀛樺湪灏戦噺宸紓銆?));
  return 0;
}

// ---------- 鍛戒护: schedule ----------
async function cmdSchedule(o) {
  const sub = o._[0] || 'list';
  if (sub === 'add') {
    const name = o._[1];
    if (!name) return fail('鐢ㄦ硶: disk-clean schedule add <name> --when once|daily|weekly --time HH:MM --roots "C:\\;D:\\" [--day SUN] [--config <file>]');
    const roots = (o.values.roots || '').split(';').filter(Boolean);
    const r = scheduleLib.add({
      name: name, when: o.values.when, day: o.values.day, time: o.values.time,
      roots: roots, config: o.values.config
    }, IS_SEA);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '鉁?' + r.note));
    return 0;
  }
  if (sub === 'run') {
    const name = o._[1];
    if (!name) return fail('鐢ㄦ硶: disk-clean schedule run <name>');
    console.log(col(C.cyan, '鈻?瀹氭椂鎵弿: ' + name));
    const r = await scheduleLib.run(name, run);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '鉁?鎵弿瀹屾垚'));
    if (r.summary) {
      console.log('  鎬诲ぇ灏? ' + fmtBytes(r.summary.totalBytes) + '  鏂囦欢: ' + (r.summary.totalFiles || 0) + '  鐩綍: ' + (r.summary.totalDirs || 0));
    }
    console.log('  鎶ュ憡  : ' + r.reportFile);
    console.log('  Markdown: ' + r.mdFile);
    return 0;
  }
  if (sub === 'list') {
    const items = scheduleLib.list();
    if (items.length === 0) { console.log('锛堟殏鏃犲畾鏃朵换鍔★級'); return 0; }
    console.log(col(C.cyan, '鈹€鈹€ 瀹氭椂浠诲姟 鈹€鈹€'));
    for (const it of items) {
      console.log('  ' + it.name + '  ' + it.when + (it.day ? ' ' + it.day : '') + ' ' + it.time + '  鐘舵€? ' + it.status + (it.nextRun && it.nextRun !== 'N/A' ? '  涓嬫: ' + it.nextRun : ''));
      console.log('    鎵弿: ' + it.roots.join(', '));
    }
    return 0;
  }
  if (sub === 'remove') {
    const name = o._[1];
    if (!name) return fail('鐢ㄦ硶: disk-clean schedule remove <name>');
    const r = scheduleLib.remove(name, IS_SEA);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '鉁?' + r.note));
    return 0;
  }
  return fail('schedule 瀛愬懡浠? add | run | list | remove');
}

// ---------- 鍛戒护: config ----------
async function cmdConfig(o) {
  const sub = o._[0] || 'show';
  const file = o.values.config || o.values.file || configLib.configPath();
  if (sub === 'path') { console.log(file); return 0; }
  if (sub === 'show') {
    const cfg = configLib.load(file);
    console.log(col(C.cyan, '鈹€鈹€ 閰嶇疆 (' + file + ') 鈹€鈹€'));
    console.log(JSON.stringify(cfg, null, 2));
    return 0;
  }
  if (sub === 'set') {
    // 鐢ㄦ硶: disk-clean config set <json-path> <value>  锛堝 thresholds.looseMinBytes 209715200锛?    const key = o._[1];
    const value = o._[2];
    if (!key || value === undefined) return fail('鐢ㄦ硶: disk-clean config set <json璺緞> <鍊?锛堝 thresholds.looseMinBytes 209715200锛?);
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
    console.log(col(C.green, '鉁?') + key + ' = ' + JSON.stringify(cur[last]) + '  (' + r.file + ')');
    return 0;
  }
  if (sub === 'reset') {
    const r = configLib.save(configLib.DEFAULT_CONFIG, file);
    if (!r.ok) return fail(r.error);
    console.log(col(C.green, '鉁?閰嶇疆宸查噸缃负榛樿 (' + r.file + ')'));
    return 0;
  }
  return fail('config 瀛愬懡浠? show | set <path> <value> | reset | path');
}

// ---------- help / version ----------
function help() {
  console.log(col(C.bold, 'disk-clean v' + VER + ' 鈥?Windows 纾佺洏娓呯悊涓庡垎鏋?CLI'));
  console.log('');
  console.log('鐢ㄦ硶: disk-clean <command> [options]');
  console.log('');
  console.log('鍛戒护:');
  console.log('  scan [roots...]            鎵弿纾佺洏/鐩綍锛岀敓鎴愭姤鍛?(JSON+Markdown)');
  console.log('                              绀轰緥: disk-clean scan C:\\ D:\\');
  console.log('  report [file]              璇诲彇鎶ュ憡骞舵覆鏌?(缁堢 + Markdown)');
  console.log('  organize plan              鐢熸垚鏁寸悊璁″垝 (鐩綍鈫掓暣鐞嗗尯, 鍙洖婊?');
  console.log('      --include-program      杩藉姞绋嬪簭/娓告垙鐩綍鍊欓€?鈿犲揩鎹锋柟寮?');
  console.log('  organize apply [file]      鎵ц鏁寸悊 (榛樿棰勮, --yes 鎵ц)');
  console.log('  organize rollback          鍥炴粴鏈€鍚庝竴鎵规暣鐞?(--yes 鎵ц)');
  console.log('  fix-shortcuts <pairs.json> 鍗曠嫭淇鎸囧悜鏃ц矾寰勭殑蹇嵎鏂瑰紡');
  console.log('  clean <type> [paths...]    娓呯悊: junk-temp|empty-dirs|duplicates|recycle-bin');
  console.log('                              (榛樿棰勮, --yes 鎵ц; 绉诲叆鍥炴敹绔欏彲鎭㈠)');
  console.log('  audit                      鏌ョ湅鎿嶄綔瀹¤鏃ュ織');
  console.log('  config                     鏌ョ湅/璁剧疆瑙勫垯閰嶇疆 (show|set|reset|path)');
  console.log('  schedule                   瀹氭椂鎵弿: add|run|list|remove (浠呮壂鎻?鎶ュ憡, 涓嶅仛娓呯悊)');
  console.log('  mftscan <鐩樼>             瀹為獙: NTFS MFT 鐩磋蹇€熸壂鎻?(闇€绠＄悊鍛? ~8x 鎻愰€?');
  console.log('  health                     纾佺洏鍋ュ悍妫€鏌?(SMART/SSD Wear/娓╁害)');
  console.log('  dedup [roots...]           鍏ㄧ洏閲嶅鏂囦欢妫€娴?(鎺掗櫎绯荤粺/绋嬪簭鐩綍)');
  console.log('      --hardlink             鍙€? 閲嶅鏂囦欢杞‖閾炬帴鐪佺┖闂?(闇€ --yes, 鍙洖婊?');
  console.log('  dedup rollback             鍥炴粴纭摼鎺ュ悎骞?);
  console.log('  quota [鐩樼]               姣忕敤鎴烽厤棰濆垎鏋?(MFT 鐩磋, 闇€绠＄悊鍛?');
  console.log('  clean / organize apply --restore-point   鎵ц鍓嶅厛寤虹郴缁熻繕鍘熺偣 (澶辫触涓嶄腑鏂?');
  console.log('');
  console.log('閫氱敤閫夐」:');
  console.log('  --report <file>  鎸囧畾鎶ュ憡鏂囦欢浣嶇疆');
  console.log('  --exclude a;b    鎵弿鎺掗櫎璺緞');
  console.log('  --dry-run        鍙瑙堜笉鎵ц');
  console.log('  --yes / -y       纭鎵ц鐮村潖鎬ф搷浣?);
  console.log('  --help / -h      甯姪   --version / -v 鐗堟湰');
  return 0;
}

function fail(msg) {
  console.error(col(C.red, '鉁?' + msg));
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
      case 'schedule': return await cmdSchedule(o);
      case 'mftscan': return await cmdMftScan(o);
      case 'health': return await cmdHealth();
      case 'quota': return await cmdQuota(o);
      case 'dedup': {
        if (o._[0] === 'rollback') return await cmdDedupRollback();
        return await cmdDedup(o);
      }
      case 'version': case '-v': case '--version': console.log('disk-clean v' + VER); return 0;
      case 'help': case '-h': case '--help': case undefined:
        if (o.flags.version || o.flags.v) { console.log('disk-clean v' + VER); return 0; }
        return help();
      default: return fail('鏈煡鍛戒护: ' + cmd + '锛?-help 鏌ョ湅鐢ㄦ硶锛?);
    }
  } catch (e) {
    return fail('杩愯鏃堕敊璇? ' + (e && e.stack ? e.stack : String(e)));
  }
}

main().then(function(code) { process.exit(code || 0) });
