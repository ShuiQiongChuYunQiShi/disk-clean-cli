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

// 跨来源路径归一化（评审 A7）：审计日志记的是调用方原样给的路径，
// 回收站 $I 记录是系统写的规范路径，两者拼写经常不同 —— 8.3 短名
// （ADMINI~1 vs Administrator）、junction/符号链接目标、映射盘、尾分隔符、大小写、`.`/`..`。
// 纯小写字符串比较在任一情况下都会失配，后果是"刚清理完却查不到可恢复项"
// （实测：短名路径清理后 toolMatched=0，安全功能静默失效）。
//
// 关键点：被清理的目录已经不在磁盘上了，直接对它 realpath 必然失败，两边会各留各的拼写
// 而继续失配。所以要**向上找到最深的仍存在的祖先**做 realpath，再把缺失的尾段拼回去。
// 之所以放在 guard.js 而不是各调用方：MCP（tools.js）与 GUI 服务层（serve.js）都要用，
// 各写一份正是 A7 的成因。（test/mcp-protocol.js 继续从 tools.js 导入以保持兼容。）
function canonKey(p) {
  const fs = require('fs');
  const path = require('path');
  const abs = path.resolve(String(p || ''));
  const tail = [];              // 从叶子往根累积
  let cur = abs;
  let resolved = abs;
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync.native(cur);
      resolved = tail.length ? path.join.apply(path, [real].concat(tail.reverse())) : real;
      break;
    } catch (e) {
      const parent = path.dirname(cur);
      if (parent === cur) break;  // 已到根，放弃归一，用 resolve 结果
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
  return resolved.replace(/[\\/]+$/, '').toLowerCase();
}

// 兼容旧调用：SYS_PREFIX 语义等价于 PROTECTED_SEGMENTS
const SYS_PREFIX = PROTECTED_SEGMENTS;

// 整理目标（<盘>:\整理区\<分类>\...）校验 —— 评审 A4。
// 旧实现只做 `^[a-z]:\\整理区\\` 前缀正则，于是 `C:\整理区\..\boot\x` 通过检查，
// 而 Windows 会把它解析为 `C:\boot\x`：管理员会话下文件真的会落进受保护目录。
// 这里做三件事：拒绝 . / .. 段、归一化、要求归一化后的直接父目录就是 <盘>:\整理区\[分类] 之内。
const ORGANIZE_ZONE = '整理区';

function checkOrganizeDest(dst) {
  const raw = String(dst || '');
  if (!raw) return { ok: false, error: '目标路径为空' };
  // 1) 显式拒绝遍历段（在归一化之前判断，避免 normalize 把 `..` 悄悄吃掉）
  const segs = raw.split(/[\\/]+/);
  for (const s of segs) {
    if (s === '..' || s === '.') return { ok: false, error: '目标路径不允许包含 . 或 .. 段' };
  }
  // 2) 归一化后必须仍是 <盘>:\整理区\ 开头
  const norm = require('path').resolve(raw);
  const m = /^([a-zA-Z]):\\/.exec(norm);
  if (!m) return { ok: false, error: '目标路径不是绝对盘符路径' };
  const rest = norm.slice(3);
  const parts = rest.split('\\').filter(Boolean);
  if (!parts.length || parts[0] !== ORGANIZE_ZONE) {
    return { ok: false, error: '目标必须在盘符根下的 ' + ORGANIZE_ZONE + ' 目录内' };
  }
  // 3) 必须落在这个盘的 整理区 之下（不是整个系统树里的某个同名目录）
  if (parts.length < 2) return { ok: false, error: '目标必须在 ' + ORGANIZE_ZONE + ' 的分类子目录内' };
  if (isProtectedPath(norm.toLowerCase())) {
    return { ok: false, error: '目标归一化后落在受保护路径内' };
  }
  return { ok: true };
}

module.exports = {
  PROTECTED_SEGMENTS,
  SYS_PREFIX,
  CLOUD_SYNC_SEG,
  TEMP_SEGMENTS,
  ORGANIZE_ZONE,
  segmentsOf,
  isProtectedPath,
  isCloudSyncPath,
  hasTempSegment,
  inRoots,
  checkDestructivePath,
  checkOrganizeDest,
  canonKey,
};
