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

function appendAudit(entry) {
  try {
    fs.appendFileSync(auditFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { /* 审计失败不中止主流程 */ }
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
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // 容忍 PowerShell 写入的 UTF-8 BOM
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function writeJson(p, v) {
  try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); return true; } catch (e) { return false; }
}

module.exports = {
  dskDir, auditFile, mapFile, reportFile, mdFile, fixFile, restoreFile, planFile,
  appendAudit, readAudit, readJson, writeJson
};
