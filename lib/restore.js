// lib/restore.js — 破坏性操作前的系统还原点（可选，PowerShell Checkpoint-Computer）
// 需管理员 + 系统保护开启；失败时降级（警告不中断），调用方记录日志。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PS = [
  '$ErrorActionPreference = "Stop"',
  'try {',
  '  Checkpoint-Computer -Description $args[0] -RestorePointType MODIFY_SETTINGS -ErrorAction Stop',
  '  "OK"',
  '} catch {',
  '  $_.Exception.Message',
  '  exit 1',
  '}'
].join('\n');

// 返回 { ok, message, stderr }
function create(label) {
  const desc = label || ('disk-clean ' + new Date().toISOString());
  const dir = path.join(os.homedir(), '.disk-clean');
  const psFile = path.join(dir, 'restore.ps1');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  try { fs.writeFileSync(psFile, PS, 'utf8'); } catch (e) {
    return { ok: false, message: '无法写入还原点脚本: ' + (e && e.message ? e.message : String(e)) };
  }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile, desc], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, windowsHide: true
  });
  const out = (r.stdout || '').toString('utf8').trim();
  const err = (r.stderr || '').toString('utf8').trim();
  if (r.status === 0 && /^OK/.test(out)) return { ok: true, message: '还原点创建成功: ' + desc };
  // 常见失败：系统保护未开启 / 卷影复制服务未运行
  const hint = err || out || '未知错误';
  return {
    ok: false,
    message: '还原点创建失败（系统保护可能未开启或需管理员）：' + hint.slice(0, 300)
  };
}

// 返回 { ok, enabled: bool, message } — 查询系统保护是否开启（C: 为例）
function status() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-ComputerRestorePoint | Measure-Object).Count; (Get-CimInstance -ClassName SystemRestore -ErrorAction SilentlyContinue | Measure-Object).Count'], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true
  });
  const out = (r.stdout || '').toString('utf8').trim().split(/\r?\n/).filter(Boolean);
  const points = parseInt(out[0], 10);
  return {
    ok: true,
    enabled: r.status === 0,
    points: isNaN(points) ? null : points,
    message: r.status === 0 ? ('系统还原点数量: ' + (isNaN(points) ? '未知' : points)) : '查询失败'
  };
}

module.exports = { create, status };
