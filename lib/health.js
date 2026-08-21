// lib/health.js — SMART / SSD 健康检查（Get-PhysicalDisk + Get-StorageReliabilityCounter + Get-Partition 卷映射）
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PS = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$disks = Get-PhysicalDisk | ForEach-Object {',
  '  $rel = Get-StorageReliabilityCounter -PhysicalDisk $_ -ErrorAction SilentlyContinue',
  '  $vols = @();',
  '  try { $vols = Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{ Letter = [string]$_.DriveLetter; Fs = [string]$_.FileSystem; Size = $_.Size; Free = $_.SizeRemaining; Health = $_.HealthStatus.ToString() } } } catch { }',
  '  [PSCustomObject]@{',
  '    Name = $_.FriendlyName',
  '    Media = $_.MediaType.ToString()',
  '    Bus = $_.BusType.ToString()',
  '    Health = $_.HealthStatus.ToString()',
  '    Op = $_.OperationalStatus.ToString()',
  '    Size = $_.Size',
  '    Serial = $_.SerialNumber',
  '    Firmware = $_.FirmwareVersion',
  '    Temp = $(if ($rel) { $rel.Temperature } else { $null })',
  '    Wear = $(if ($rel) { $rel.Wear } else { $null })',
  '    POH = $(if ($rel) { $rel.PowerOnHours } else { $null })',
  '    PowerCycle = $(if ($rel) { $rel.PowerCycleCount } else { $null })',
  '    StartStop = $(if ($rel) { $rel.StartStopCycleCount } else { $null })',
  '    LoadUnload = $(if ($rel) { $rel.LoadUnloadCycleCount } else { $null })',
  '    ReadErrCorr = $(if ($rel) { $rel.ReadErrorsCorrected } else { $null })',
  '    ReadErrUncorr = $(if ($rel) { $rel.ReadErrorsUncorrected } else { $null })',
  '    WriteErrCorr = $(if ($rel) { $rel.WriteErrorsCorrected } else { $null })',
  '    WriteErrUncorr = $(if ($rel) { $rel.WriteErrorsUncorrected } else { $null })',
  '    Volumes = $vols',
  '  }',
  '}',
  'if (-not $disks) { $disks = @() }',
  '$disks | ConvertTo-Json -Compress -Depth 4 | Out-File -Encoding UTF8 $args[0]'
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
  if ((typeof d.ReadErrUncorr === 'number' && d.ReadErrUncorr > 0) || (typeof d.WriteErrUncorr === 'number' && d.WriteErrUncorr > 0)) issues.push('存在不可纠正读写错误');
  if (typeof d.ReadErrCorr === 'number' && d.ReadErrCorr > 1000) issues.push('读纠错次数偏高（' + d.ReadErrCorr + '）');
  if (issues.length === 0) return { level: '健康', issues: [] };
  if (h === 'unhealthy' || (typeof d.Wear === 'number' && d.Wear > 90)) return { level: '危险', issues: issues };
  if (h === 'warning' || (typeof d.Wear === 'number' && d.Wear > 80)) return { level: '警告', issues: issues };
  return { level: '注意', issues: issues };
}

// 返回 { ok, disks: [{name, media, bus, health, op, size, serial, firmware, temp, wear, poh,
//   powerCycle, startStop, loadUnload, readErrCorr, readErrUncorr, writeErrCorr, writeErrUncorr,
//   volumes:[{letter,fs,size,free,health}], grade, issues}], error }
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
  const num = function(v) { return typeof v === 'number' ? v : null };
  const disks = arr.filter(function(d) { return d && d.Name; }).map(function(d) {
    const g = grade(d);
    const vols = Array.isArray(d.Volumes) ? d.Volumes.map(function(v) {
      const size = v && typeof v.Size === 'number' ? v.Size : null;
      const free = v && typeof v.Free === 'number' ? v.Free : null;
      return {
        letter: v ? String(v.Letter || '') : '', fs: v ? String(v.Fs || '') : '',
        size: size, free: free, health: v ? String(v.Health || '') : ''
      };
    }).filter(function(v) { return v.letter || v.size; }) : [];
    return {
      name: d.Name, media: d.Media || '未知', bus: d.Bus || '未知', health: d.Health || '未知', op: d.Op || '未知',
      size: d.Size ? Number(d.Size) : null, serial: d.Serial || '', firmware: d.Firmware || '',
      temp: num(d.Temp), wear: num(d.Wear), poh: num(d.POH),
      powerCycle: num(d.PowerCycle), startStop: num(d.StartStop), loadUnload: num(d.LoadUnload),
      readErrCorr: num(d.ReadErrCorr), readErrUncorr: num(d.ReadErrUncorr),
      writeErrCorr: num(d.WriteErrCorr), writeErrUncorr: num(d.WriteErrUncorr),
      volumes: vols,
      grade: g.level, issues: g.issues
    };
  });
  if (disks.length === 0) return { ok: false, error: '未发现物理磁盘' };
  return { ok: true, disks: disks, file: outFile };
}

module.exports = { check, grade, healthFile };
