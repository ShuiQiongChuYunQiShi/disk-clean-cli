// lib/config.js — 规则配置文件（~/.disk-clean/config.json）
// 支持：exclude 白名单 / 黑名单 / 阈值 / 保留策略 / 自定义垃圾规则 / 整理映射
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  // 注：此处曾有 `version: 1` 字段，但没有任何代码读取它。它不只是死字段，还是
  // 一个**同名混淆源**——与应用版本号（lib/version.js 的 VERSION）同名，容易让人
  // 以为改它能改版本号。按本仓库原则（要么实现、要么删掉）删除；用户已有配置文件
  // 里残留的 version 字段会被 deepMerge 原样保留，不影响读取。
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
    reports: 30,        // 报告历史的保留份数（v0.7.1 起真的生效，见 lib/report.js 的 archive）
  },
  // 注：曾有 `junkRules`（自定义垃圾规则）与 `organizeRules`（自定义整理映射）两个字段。
  // 它们与 v0.7.0 移除的 `blacklist` 是同一类问题：从未被任何引擎代码读取，
  // 却在 MCP 工具描述里被当成已有功能对外承诺（v0.7.0 那次只逐项处理了 blacklist，
  // 这两个漏网，于是同一版又承诺了一遍）。
  // 现按本仓库原则（要么实现、要么从描述里删掉）删除。要做"用户自定义规则"，
  // 得先把匹配语义、与内置规则的优先级冲突想清楚，属于产品批次（见 PRODUCT-REVIEW 的 T6）。
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

// ---------------------------------------------------------------------------
// 未接线的配置项（必须显式登记，不能"默默存在"）
//
// 背景：v0.7.0 已经因为这一类问题挨过一次——`blacklist` 从未被任何引擎代码读取，
// 却在 MCP 工具描述里被当成已有功能对外承诺。当时按"要么实现、要么从描述里删掉"
// 处理掉了 `blacklist`，但**同一批里剩下的两项漏掉了**，并且在 v0.7.0 的工具描述里
// 又承诺了一遍。也就是说：修的时候是逐项修的，不是按类别修的，所以同类问题活了下来。
//
// 现在改为机制约束：`test/docs-consistency.js` 会断言
//   1) DEFAULT_CONFIG 里的每个叶子键，要么能在 lib/bin 里找到读取点（活的），
//      要么必须出现在下面的 UNIMPLEMENTED 名单里；
//   2) 名单里的键不得被当成已有能力承诺（README / MCP 工具描述）；
//   3) 已经接线了的键不许留在名单里（防止登记变成永久借口）；
//   4) 历史遗留字段（blacklist / junkRules / organizeRules）不得卷土重来。
//
// **空名单是当前的真实结论，不是占位**：v0.7.1 把最后一个未接线项
// （`retention.reports`，报告历史）真正实现了，所以现在没有待登记项。
// 这份名单和它的断言要一直留着——它承载的是"配置项只有接线或登记两种状态"这条约束。
const UNIMPLEMENTED = [];

module.exports = { DEFAULT_CONFIG, UNIMPLEMENTED, configPath, load, save, deepMerge, normPrefixes };
