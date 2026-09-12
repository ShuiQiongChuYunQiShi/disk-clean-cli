// lib/config.js — 规则配置文件（~/.disk-clean/config.json）
// 支持：exclude 白名单 / 黑名单 / 阈值 / 保留策略 / 自定义垃圾规则 / 整理映射
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  version: 1,
  // 永不清理/移动的路径（前缀匹配，大小写不敏感）
  exclude: [],
  // 注：曾有 `blacklist`（"强制清理候选"）字段，但它从未被任何引擎代码读取——
  // 只在 MCP 工具描述里被当成已有功能对外承诺，属于对调用方（尤其是 AI）的假承诺。
  // 已于 v0.7.0 移除（本仓库一贯原则：要么实现，要么从描述里删掉）。
  // 阈值
  thresholds: {
    looseMinBytes: 100 * 1024 * 1024,   // 散落目录最小字节（默认 100MB）
    looseMinDays: 30,                    // 散落目录修改距今天数
    staleMinBytes: 500 * 1024 * 1024,   // 陈旧大文件最小字节
    staleMinDays: 730,                   // 陈旧阈值天数
    dupMinBytes: 1 * 1024 * 1024,       // 重复文件最小字节
  },
  // 保留策略
  retention: {
    auditLines: 5000,   // 审计日志最大行数（超限截断）
    reports: 30,        // 保留最近 N 份报告
  },
  // 自定义垃圾规则：{ label, match: 子串数组（命中任一即该分类） }
  junkRules: [],
  // 自定义整理映射：{ 扩展名: 整理区分类 }（如 { "exe": "安装包" }）
  organizeRules: {},
};

function configPath() {
  return path.join(os.homedir(), '.disk-clean', 'config.json');
}

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load(p) {
  const file = p || configPath();
  let raw = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = JSON.parse(raw);
  } catch (e) { raw = null; }
  return deepMerge(DEFAULT_CONFIG, raw || {});
}

function save(cfg, p) {
  const file = p || configPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
    return { ok: true, file: file };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// 把 config 里的路径列表规范成小写前缀数组（匹配用）
function normPrefixes(list) {
  return (list || []).map(function(s) { return String(s || '').toLowerCase().replace(/[\\/]+$/, '') }).filter(Boolean);
}

module.exports = { DEFAULT_CONFIG, configPath, load, save, deepMerge, normPrefixes };
