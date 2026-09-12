// lib/audit.js — 审计日志（JSONL，追加写）
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function dskDir() {
  const d = path.join(os.homedir(), '.disk-clean');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
  return d;
}
function auditFile() { return path.join(dskDir(), 'audit.jsonl') }
function mapFile() { return path.join(dskDir(), 'organize-map.json') }
function reportFile() { return path.join(dskDir(), 'report.json') }
function mdFile() { return path.join(dskDir(), 'report.md') }
function fixFile() { return path.join(dskDir(), 'fix-shortcuts.json') }
function restoreFile() { return path.join(dskDir(), 'restore-shortcuts.json') }
function planFile() { return path.join(dskDir(), 'organize-plan.json') }
function dedupMapFile() { return path.join(dskDir(), 'dedup-map.json') }
// T3：报告历史目录。此前 lib/schedule.js 自己写了一份同样的路径计算——
// 「同一个目录两处定义」正是这类不一致反复发生的来源，所以统一到这里。
function reportsDir() { return path.join(dskDir(), 'reports') }
// 报告历史的保留份数（retention.reports）。惰性读配置：改完立即生效，
// 与 maxAuditLines() 同样的处理方式；非法值回落默认值而不是当场崩掉。
const DEFAULT_MAX_REPORTS = 30;
function maxReports() {
  try {
    const v = require('./config.js').load().retention.reports;
    if (typeof v === 'number' && isFinite(v) && v >= 0) return Math.floor(v);
  } catch (e) { /* 配置读取失败就用默认值 */ }
  return DEFAULT_MAX_REPORTS;
}

function appendAudit(entry) {
  try {
    fs.appendFileSync(auditFile(), JSON.stringify(entry) + '\n', 'utf8');
    rotateAuditIfNeeded();
  } catch (e) { /* 审计失败不中止主流程 */ }
}

// 轮转：超过上限时只保留最近一半（防无限增长）
// v0.7.0（v7-6）：此前这里硬编码 2000，而 config.js 的 `retention.auditLines`
// 默认 5000 —— 该配置项永远不生效（写了没人读）。现改为惰性读取 config：
// 惰性 require 而非顶层 require，既避免 audit ← config 的模块环，
// 也让"改完配置立刻生效"不需要重启进程。读不到/非法时回落到 2000。
const DEFAULT_MAX_AUDIT_LINES = 2000;
function maxAuditLines() {
  let n = 0;
  try {
    const cfg = require('./config.js').load();
    n = cfg && cfg.retention ? Number(cfg.retention.auditLines) : 0;
  } catch (e) { n = 0; }
  return (Number.isFinite(n) && n > 0) ? Math.floor(n) : DEFAULT_MAX_AUDIT_LINES;
}
let lastRotateCheck = 0;
function rotateAuditIfNeeded() {
  const now = Date.now();
  if (now - lastRotateCheck < 60 * 1000) return; // 每分钟最多检查一次
  lastRotateCheck = now;
  try {
    const f = auditFile();
    const st = fs.statSync(f);
    if (st.size < 512 * 1024) return; // <512KB 不检查内容
    const limit = maxAuditLines();
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= limit) return;
    const keep = lines.slice(-Math.floor(limit / 2));
    fs.writeFileSync(f, keep.join('\n') + '\n', 'utf8');
  } catch (e) { /* 轮转失败不中止 */ }
}

function readAudit() {
  try {
    const raw = fs.readFileSync(auditFile(), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.map(function(l) {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
}

function readJson(p) {
  try {
    // T3：报告历史以 .json.gz 归档。磁盘清理工具不该为了存历史自己吃掉几百 MB，
    // 而报告内容（大量重复的路径字符串）压缩率很高，所以归档用 gzip。
    // 读懂归档是读取端的责任，调用方不必区分是不是压缩文件。
    if (/\.gz$/i.test(p)) {
      return JSON.parse(require('zlib').gunzipSync(fs.readFileSync(p)).toString('utf8'));
    }
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // 容忍 PowerShell 写入的 UTF-8 BOM
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function writeJson(p, v) {
  try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); return true; } catch (e) { return false; }
}

module.exports = {
  dskDir, auditFile, mapFile, reportFile, mdFile, fixFile, restoreFile, planFile, dedupMapFile, reportsDir,
  appendAudit, readAudit, readJson, writeJson,
  maxAuditLines, DEFAULT_MAX_AUDIT_LINES, maxReports, DEFAULT_MAX_REPORTS,
};
