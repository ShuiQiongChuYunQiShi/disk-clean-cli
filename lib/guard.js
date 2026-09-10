'use strict';
// lib/guard.js — 路径安全闸门（单一事实源）
// 之前 \windows\ 类保护名单在 clean.js / organize.js / serve.js 各写一份（评审 P1-3），
// 现全部 require 本模块。新增受保护段只需改这里。
//
// 语义说明：PROTECTED_SEGMENTS 中的路径对"清理/移动/整理"一律拒绝。
// 注意 Windows.old 同时被 JUNK_RULES 报告为"占用空间"——这是有意的：
// 报告只告诉用户它占了多少，不提供自动清理通道（应由系统磁盘清理处理）。

const BS = '\\';

// 受保护路径段（小写，带前后分隔符，用于 indexOf 子串匹配）
const PROTECTED_SEGMENTS = [
  '\\windows\\',
  '\\windows.old\\',
  '\\program files\\',
  '\\program files (x86)\\',
  '\\programdata\\',
  '\\winsxs\\',
  '\\system volume information\\',
  '\\$recycle.bin\\',
  '\\$windows.~bt\\',
  '\\$windows.~ws\\',
  '\\recovery\\',
  '\\perflogs\\',
  '\\msocache\\',
  '\\config.msi\\',
  '\\boot\\',
  '\\efi\\'
];

// 云同步段：哈希会触发占位文件静默下载，删除会同步影响云端 —— 破坏性操作整体排除
const CLOUD_SYNC_SEG = 'onedrive';

// 临时/缓存段（精确段名匹配，不做前缀匹配 —— 评审 P1-2：
// 旧的 `s.indexOf('temp') === 0` 会把 `temporary-report` 误判为临时目录）
const TEMP_SEGMENTS = ['temp', 'tmp', 'cache', 'caches', 'prefetch', 'thumbcache', 'iconcache'];

// 段边界匹配：把路径切成段（不含盘符）
function segmentsOf(lowerPath) {
  return String(lowerPath || '')
    .replace(/^[a-z]:[\\/]/, '')
    .replace(/^[a-z]:/, '')
    .split(/[\\/]+/)
    .filter(Boolean);
}

// 路径是否落在受保护区（含盘符的形式也会命中 './windows/' 前补的 BS）
function isProtectedPath(lowerPath) {
  const lp = String(lowerPath || '').toLowerCase();
  if (!lp) return true; // 空路径视为不安全
  const withLead = lp.charAt(0) === BS ? lp : BS + lp;
  for (const seg of PROTECTED_SEGMENTS) {
    if (withLead.indexOf(seg) >= 0) return true;
  }
  // 尾部无分隔符的情况（例如路径就以 \windows 结尾）
  for (const seg of PROTECTED_SEGMENTS) {
    const bare = seg.slice(0, -1);
    if (withLead === bare || withLead.endsWith(seg.slice(0, -1))) return true;
  }
  return false;
}

function isCloudSyncPath(lowerPath) {
  return segmentsOf(lowerPath).some(function (s) { return s === CLOUD_SYNC_SEG; });
}

// 精确段匹配：仅当某一整段等于 temp/tmp/cache/... 时才算临时路径
// （内部统一小写：调用方传大小写混合路径也不会漏判）
function hasTempSegment(lowerPath) {
  const segs = String(lowerPath || '').toLowerCase().split(/[\\/]+/);
  for (const s of segs) {
    if (TEMP_SEGMENTS.indexOf(s) >= 0) return true;
  }
  return false;
}

// 根目录归属判定（补分隔符边界 —— 评审 P1-2：
// 旧的 `lp.indexOf(root) === 0` 会让 C:\UsersX\ 命中 C:\Users\）
function inRoots(lowerPath, roots) {
  const lp = String(lowerPath || '').toLowerCase();
  if (!Array.isArray(roots) || roots.length === 0) return false;
  for (const r of roots) {
    let root = String(r || '').toLowerCase().replace(/[\\/]+$/, '');
    if (!root) continue;
    if (lp === root) return true;
    if (lp.indexOf(root + BS) === 0) return true;
    if (lp.indexOf(root + '/') === 0) return true;
  }
  return false;
}

// 统一的破坏性路径校验：返回 { ok, error }
function checkDestructivePath(path, opts) {
  const o = opts || {};
  const lp = String(path || '').toLowerCase();
  if (!lp) return { ok: false, error: '空路径' };
  if (isProtectedPath(lp)) return { ok: false, error: '拒绝操作受保护的系统路径：' + path };
  if (isCloudSyncPath(lp)) return { ok: false, error: '拒绝操作 OneDrive 云同步文件（删除会同步影响云端）：' + path };
  if (Array.isArray(o.roots) && o.roots.length > 0 && !inRoots(lp, o.roots)) {
    return { ok: false, error: '路径不在扫描范围内：' + path };
  }
  return { ok: true };
}

// 兼容旧调用：SYS_PREFIX 语义等价于 PROTECTED_SEGMENTS
const SYS_PREFIX = PROTECTED_SEGMENTS;

module.exports = {
  PROTECTED_SEGMENTS,
  SYS_PREFIX,
  CLOUD_SYNC_SEG,
  TEMP_SEGMENTS,
  segmentsOf,
  isProtectedPath,
  isCloudSyncPath,
  hasTempSegment,
  inRoots,
  checkDestructivePath,
};
