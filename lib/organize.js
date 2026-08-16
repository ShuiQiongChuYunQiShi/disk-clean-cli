// lib/organize.js — 目录整理（plan/apply/rollback）与快捷方式修复
// 复用引擎 run() 执行移动；安全红线与 DSH 版 host.static5 一致。
'use strict';
const path = require('path');
const { run } = require('./engine.js');
const { mapFile, fixFile, restoreFile, appendAudit, readJson, writeJson } = require('./audit.js');

const BS = '\\';
const SYS_PREFIX = ['\\windows\\', '\\program files\\', '\\program files (x86)\\', '\\programdata\\', '\\winsxs\\', '\\system volume information\\', '\\$recycle.bin\\'];
const ORG_CAT = { '媒体':'媒体', '图片':'图片', '文档':'文档', '安装包':'安装包', '压缩包':'压缩包', '虚拟磁盘':'虚拟磁盘', '数据库':'数据库', '备份':'备份' };

function low(s) { return String(s || '').toLowerCase() }
function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}
function inScanRoots(lp, roots) {
  return roots.some(function(r) { return lp.indexOf(low(r)) === 0 });
}
function isSafeZone(lp) {
  return SYS_PREFIX.every(function(pre) { return lp.indexOf(pre) < 0 });
}

// ---------- plan ----------
// 从扫描报告（reportFile JSON）生成整理计划。
// includeProgram=true 时追加 program 类候选（kind='program', fixShortcuts=true, 风险标注）。
async function plan(opts) {
  const reportFile = (opts && opts.reportFile) || require('./audit.js').reportFile();
  const rep = readJson(reportFile);
  if (!rep) return { ok: false, error: '未找到扫描报告：' + reportFile + '（请先运行 scan）' };
  const includeProgram = !!(opts && opts.includeProgram);
  const plan = [];
  const seenDst = {};
  let dirCount = 0;
  const cands = (rep && Array.isArray(rep.organizeCandidates)) ? rep.organizeCandidates : [];
  for (const c of cands) {
    const m = low(c.path || '').match(/^([a-z]):/);
    const driveLetter = m ? m[1].toUpperCase() : 'C';
    const name = (c.path || '').split(/[\\/]+/).filter(Boolean).pop() || '未命名';
    const cat = ORG_CAT[c.cat] ? c.cat : '其他';
    const dst = driveLetter + ':' + BS + '整理区' + BS + cat + BS + name;
    if (seenDst[low(dst)]) continue;
    seenDst[low(dst)] = 1;
    plan.push({ src: c.path, dst: dst, bytes: c.bytes || 0, cat: cat, kind: 'dir' });
    dirCount++;
  }
  let programCount = 0;
  if (includeProgram && rep && Array.isArray(rep.suggestions)) {
    for (const s of rep.suggestions) {
      if (s.type !== 'organize-folders') continue;
      for (const it of (s.items || [])) {
        if (it.kind !== 'program') continue;
        const m = low(it.path || '').match(/^([a-z]):/);
        const driveLetter = m ? m[1].toUpperCase() : 'C';
        const name = (it.path || '').split(/[\\/]+/).filter(Boolean).pop() || '未命名';
        const dst = driveLetter + ':' + BS + '整理区' + BS + '其他' + BS + name;
        if (seenDst[low(dst)]) continue;
        seenDst[low(dst)] = 1;
        plan.push({ src: it.path, dst: dst, bytes: it.bytes || 0, cat: '其他', kind: 'program', fixShortcuts: true, warn: it.warn || '移动将导致快捷方式失效；移动后将自动重写桌面/开始菜单/任务栏快捷方式' });
        programCount++;
      }
    }
  }
  if (plan.length === 0) return { ok: true, items: [], totalBytes: 0, note: '未发现可整理的散落目录/文件' };
  const totalBytes = plan.reduce(function(a, p) { return a + (p.bytes || 0) }, 0);
  const fileCount = plan.length - dirCount - programCount;
  let note = '整理目标：<盘>:\\整理区\\<分类>\\（不删除，移动可回滚）；含 ' + dirCount + ' 个目录、' + fileCount + ' 个文件';
  if (programCount > 0) note += '、' + programCount + ' 个程序目录（⚠ 移动将自动重写快捷方式 fixShortcuts，谨慎选择）';
  return { ok: true, items: plan.slice(0, 200), totalBytes: totalBytes, dirCount: dirCount, fileCount: fileCount, programCount: programCount, note: note };
}

// ---------- apply ----------
// items: [{src,dst,bytes,cat,kind,fixShortcuts,warn}]；roots: 扫描根（安全校验）。
// dryRun=true 只校验不执行。program 目录必须 fixShortcuts=true，否则拒绝。
async function apply(items, opts) {
  const roots = (opts && Array.isArray(opts.roots)) ? opts.roots : [];
  const dryRun = !!(opts && opts.dryRun);
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '缺少整理计划' };
  if (items.length > 200) return { ok: false, error: '单次整理项过多（>200）' };
  let fixCount = 0;
  for (const it of items) {
    const lp = low(it.src || '');
    if (!inScanRoots(lp, roots)) return { ok: false, error: '源路径不在扫描范围内：' + (it.src || '') };
    if (!isSafeZone(lp)) return { ok: false, error: '拒绝整理系统目录：' + (it.src || '') };
    const dl = low(it.dst || '');
    if (!/^[a-z]:\\整理区\\/.test(dl)) return { ok: false, error: '目标必须在盘符根下的整理区目录：' + (it.dst || '') };
    if (it.kind === 'program' && !it.fixShortcuts) return { ok: false, error: '程序目录 ' + (it.src || '') + ' 必须启用 fixShortcuts（自动重写快捷方式）才能移动' };
    if (it.fixShortcuts) fixCount++;
  }
  const total = items.reduce(function(a, it) { return a + (it.bytes || 0) }, 0);
  if (dryRun) {
    return { ok: true, dryRun: true, planned: items.length, totalBytes: total, fixCount: fixCount, note: '（dry-run 预览）将移动 ' + items.length + ' 项，约 ' + fmtBytes(total) + (fixCount > 0 ? '，其中 ' + fixCount + ' 个程序目录将重写快捷方式' : '') };
  }
  const planForEngine = items.map(function(it) { return { src: it.src, dst: it.dst } });
  const planTmp = path.join(require('os').tmpdir(), 'dsk-organize-plan-' + process.pid + '.json');
  writeJson(planTmp, planForEngine);
  const mapF = mapFile();
  const r = await run(['--organize', '--plan', planTmp, '--map', mapF]);
  try { require('fs').unlinkSync(planTmp); } catch (e) { /* ignore */ }
  if (!r || r.exitCode !== 0) {
    const err = (r && r.error) || '整理执行失败';
    appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'apply', paths: items.map(function(it) { return it.src }), executed: 0, result: 'error', detail: err });
    return { ok: false, error: err };
  }
  const rdata = r.data || {};
  let shortcutFixed = 0, shortcutError = null;
  if (fixCount > 0) {
    const movedSrc = {};
    for (const mv of (rdata.moved || [])) movedSrc[low(mv.src)] = mv.dst;
    const fixPairs = [];
    for (const it of items) {
      if (!it.fixShortcuts) continue;
      const dst = movedSrc[low(it.src)];
      if (dst) fixPairs.push({ src: it.src, dst: dst });
    }
    if (fixPairs.length > 0) {
      const fr = await fixShortcuts(fixPairs);
      if (fr.ok) shortcutFixed = (fr.fixed || []).length;
      else shortcutError = fr.error || '快捷方式修复失败';
    }
  }
  appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'apply', paths: items.map(function(it) { return it.src }), freedBytes: 0, executed: rdata.movedCount || 0, result: 'ok', detail: JSON.stringify({ failed: rdata.failed || [], shortcutFixed: shortcutFixed, shortcutError: shortcutError }).slice(0, 500) });
  return { ok: true, movedCount: rdata.movedCount, failedCount: rdata.failedCount, failed: rdata.failed, shortcutFixed: shortcutFixed, shortcutError: shortcutError, note: '已整理 ' + rdata.movedCount + '/' + items.length + ' 项' + (shortcutFixed > 0 ? '，自动重写快捷方式 ' + shortcutFixed + ' 个' : '') + '，可回滚' };
}

// ---------- rollback ----------
// 回滚最后一批整理：先恢复快捷方式，再反向移动。
async function rollback(opts) {
  const dryRun = !!(opts && opts.dryRun);
  const mapF = mapFile();
  const map = readJson(mapF);
  if (!map || !Array.isArray(map) || map.length === 0) return { ok: false, error: '没有可回滚的整理记录' };
  const last = map[map.length - 1];
  const items = (last.items || []).map(function(m) { return { src: m.dst, dst: m.src } });
  const shortcuts = (last.shortcuts && Array.isArray(last.shortcuts)) ? last.shortcuts : [];
  if (items.length === 0 && shortcuts.length === 0) return { ok: false, error: '最后一批整理记录为空' };
  if (dryRun) {
    return { ok: true, dryRun: true, items: items.length, shortcuts: shortcuts.length, note: '（dry-run 预览）将回滚 ' + items.length + ' 项' + (shortcuts.length > 0 ? '，恢复 ' + shortcuts.length + ' 个快捷方式' : '') };
  }
  let restoredShortcuts = 0;
  if (shortcuts.length > 0) {
    const restoreTmp = path.join(require('os').tmpdir(), 'dsk-restore-' + process.pid + '.json');
    writeJson(restoreTmp, shortcuts);
    const sr = await run(['--restore-shortcuts', restoreTmp]);
    try { require('fs').unlinkSync(restoreTmp); } catch (e) { /* ignore */ }
    if (sr && sr.exitCode === 0 && sr.data) restoredShortcuts = sr.data.restored || 0;
  }
  const planTmp = path.join(require('os').tmpdir(), 'dsk-organize-plan-' + process.pid + '.json');
  writeJson(planTmp, items);
  const r = await run(['--organize', '--plan', planTmp, '--map', mapF]);
  try { require('fs').unlinkSync(planTmp); } catch (e) { /* ignore */ }
  if (!r || r.exitCode !== 0) {
    const err = (r && r.error) || '回滚执行失败';
    appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'rollback', paths: items.map(function(it) { return it.dst }), executed: 0, result: 'error', detail: err });
    return { ok: false, error: err };
  }
  const rdata = r.data || {};
  appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'rollback', paths: items.map(function(it) { return it.dst }), freedBytes: 0, executed: rdata.movedCount || 0, result: 'ok', detail: JSON.stringify({ failed: rdata.failed || [], restoredShortcuts: restoredShortcuts }).slice(0, 500) });
  return { ok: true, movedCount: rdata.movedCount, failedCount: rdata.failedCount, failed: rdata.failed, restoredShortcuts: restoredShortcuts, note: '已回滚 ' + rdata.movedCount + '/' + items.length + ' 项' + (restoredShortcuts > 0 ? '，恢复快捷方式 ' + restoredShortcuts + ' 个' : '') };
}

// ---------- 快捷方式修复（独立命令） ----------
// pairs: [{src,dst}] —— 把指向 src 前缀的 .lnk 重写到 dst。
async function fixShortcuts(pairs) {
  const fixTmp = path.join(require('os').tmpdir(), 'dsk-fix-' + process.pid + '.json');
  writeJson(fixTmp, pairs);
  const mapF = mapFile();
  const r = await run(['--fix-shortcuts', fixTmp, '--map', mapF]);
  try { require('fs').unlinkSync(fixTmp); } catch (e) { /* ignore */ }
  if (!r || r.exitCode !== 0) {
    return { ok: false, error: (r && r.error) || '快捷方式修复失败' };
  }
  const d = r.data || {};
  appendAudit({ ts: new Date().toISOString(), type: 'shortcuts', action: 'fix', paths: (d.fixed || []).map(function(f) { return f.lnk }).slice(0, 50), executed: (d.fixed || []).length, result: 'ok' });
  return { ok: true, scanned: d.scanned || 0, fixed: d.fixed || [] };
}

module.exports = { plan, apply, rollback, fixShortcuts, low, fmtBytes };
