// lib/i18n.js — 报告/输出多语言（en/zh），检测顺序：--lang > DSH_LANG/LANG > 系统语言
'use strict';

const DICT = {
  en: {
    reportTitle: 'Disk Clean Report',
    generated: 'Generated',
    summary: 'Summary',
    category: 'Category breakdown',
    topDirs: 'Largest directories',
    topFiles: 'Largest files',
    suggestions: 'Suggestions',
    junkTemp: 'Temporary/junk files',
    duplicates: 'Duplicate files',
    emptyDirs: 'Empty directories',
    organize: 'Loose folders (organize candidates)',
    programDirs: 'Program/game folders',
    scannedRoots: 'Scanned roots',
    totalBytes: 'Total size',
    totalFiles: 'Files',
    totalDirs: 'Directories',
    elapsed: 'Elapsed',
    drive: 'Drive'
  },
  zh: {
    reportTitle: '磁盘清理报告',
    generated: '生成时间',
    summary: '概览',
    category: '分类统计',
    topDirs: '占用最大的目录',
    topFiles: '最大的文件',
    suggestions: '清理建议',
    junkTemp: '临时/垃圾文件',
    duplicates: '重复文件',
    emptyDirs: '空目录',
    organize: '散落目录（可整理）',
    programDirs: '程序/游戏目录',
    scannedRoots: '扫描根目录',
    totalBytes: '总大小',
    totalFiles: '文件数',
    totalDirs: '目录数',
    elapsed: '耗时',
    drive: '盘符'
  }
};

// 检测语言：显式 > 环境 > 系统
function detect(explicit) {
  if (explicit) return DICT[explicit] ? explicit : 'en';
  const env = (process.env.DSH_LANG || process.env.LANG || '').toLowerCase();
  if (env.indexOf('zh') === 0) return 'zh';
  try {
    // 系统 UI 语言（PowerShell 查询，仅 node 环境）
    const { spawnSync } = require('child_process');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Culture).Name'], {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true
    });
    const name = (r.stdout || '').toString('utf8').trim().toLowerCase();
    if (name.indexOf('zh') === 0) return 'zh';
  } catch (e) { /* fallthrough */ }
  return 'en';
}

function t(key, lang) {
  const l = lang || 'en';
  const d = DICT[l] || DICT.en;
  return d[key] !== undefined ? d[key] : DICT.en[key] !== undefined ? DICT.en[key] : key;
}

module.exports = { detect, t, DICT };
