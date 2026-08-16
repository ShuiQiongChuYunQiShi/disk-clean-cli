// lib/health.js — SMART / SSD 健康检查（PowerShell Get-PhysicalDisk + Get-StorageReliabilityCounter）
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PS = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$disks = Get-PhysicalDisk | ForEach-Object {',
  '  $rel = Get-StorageReliabilityCounter -PhysicalDisk $_ -ErrorAction SilentlyContinue',
  '  [PSCustomObject]@{',
  '    Name = $_.FriendlyName',
  '    Media = $_.MediaType.ToString()',
  '    Health = $_.HealthStatus.ToString()',
  '    Op = $_.OperationalStatus.ToString()',
  '    Size = $_.Size',
  '    Temp = $(if ($rel) { $rel.Temperature } else { $null })',
  '    Wear = $(if ($rel) { $rel.Wear } else { $null })',
  '    POH = $(if ($rel) { $rel.PowerOnHours } else { $null })',
  '    ReadErr = $(if ($rel) { $rel.ReadErrorsTotal } else { $null })',
  '    WriteErr = $(if ($rel) { $rel.WriteErrorsTotal } else { $null })',
  '  }',
  '}',
  'if (-not $disks) { $disks = @() }',
  '$disks | ConvertTo-Json -Compress | Out-File -Encoding UTF8 $args[0]'
].join('\n');

function healthFile() { return path.join(os.homedir(), '.disk-clean', 'health.json'); }

function readJson(p) {
  try {
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { return null; }
}

// 健康分级
function grade(d) {
  const issues = [];
  const h = (d.Health || '').toLowerCase();
  if (h === 'unhealthy') issues.push('设备状态 Unhealthy');
  else if (h === 'warning') issues.push('设备状态 Warning');
  if (typeof d.Wear === 'number' && d.Wear > 80) issues.push('SSD 寿命已用 ' + d.Wear + '%');
  if (typeof d.Temp === 'number' && d.Temp > 55) issues.push('温度 ' + d.Temp + '°C');
  if (typeof d.ReadErr === 'number' && d.ReadErr > 0) issues.push('读取错误 ' + d.ReadErr);
  if (typeof d.WriteErr === 'number' && d.WriteErr > 0) issues.push('写入错误 ' + d.WriteErr);
  if (issues.length === 0) return { level: '健康', issues: [] };
  if (h === 'unhealthy' || (typeof d.Wear === 'number' && d.Wear > 90)) return { level: '危险', issues: issues };
  if (h === 'warning' || (typeof d.Wear === 'number' && d.Wear > 80)) return { level: '警告', issues: issues };
  return { level: '注意', issues: issues };
}

// 返回 { ok, disks: [{name, media, health, op, size, temp, wear, poh, readErr, writeErr, grade}], error }
function check() {
  const outFile = healthFile();
  const psFile = outFile.replace(/\.json$/i, '') + '.ps1';
  try { fs.mkdirSync(path.dirname(psFile), { recursive: true }); } catch (e) { /* ignore */ }
  try { fs.writeFileSync(psFile, PS, 'utf8'); } catch (e) {
    return { ok: false, error: '无法写入临时脚本: ' + (e && e.message ? e.message : String(e)) };
  }
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile, outFile], {
      stdio: ['ignore', 'ignore', 'ignore'], timeout: 60000, windowsHide: true
    });
  } catch (e) { /* 忽略 spawn 错误，下面读文件判断 */ }
  const raw = readJson(outFile);
  if (!raw) return { ok: false, error: '无法读取磁盘健康数据（需要管理员权限或系统无 Get-PhysicalDisk 支持）' };
  const arr = Array.isArray(raw) ? raw : [raw];
  const disks = arr.filter(function(d) { return d && d.Name; }).map(function(d) {
    const g = grade(d);
    return {
      name: d.Name, media: d.Media || '未知', health: d.Health || '未知', op: d.Op || '未知',
      size: d.Size ? Number(d.Size) : null,
      temp: typeof d.Temp === 'number' ? d.Temp : null,
      wear: typeof d.Wear === 'number' ? d.Wear : null,
      poh: typeof d.POH === 'number' ? d.POH : null,
      readErr: typeof d.ReadErr === 'number' ? d.ReadErr : null,
      writeErr: typeof d.WriteErr === 'number' ? d.WriteErr : null,
      grade: g.level, issues: g.issues
    };
  });
  if (disks.length === 0) return { ok: false, error: '未发现物理磁盘' };
  return { ok: true, disks: disks, file: outFile };
}

module.exports = { check, grade, healthFile };
