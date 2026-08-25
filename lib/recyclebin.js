'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// $I file format (Win10+): 8 bytes header (01 00 00 00 ...), 8 bytes FileSize (int64 LE), 8 bytes FILETIME (deletion), 4 bytes pathLen (+ UTF16 path)
// For our test helper we write simplified format: 8 byte dummy header + size + filetime + UTF16 path (same offsets as real: size at 8, filetime at 16, path at 24)

function fileTimeToIso(ftLow, ftHigh) {
  // Windows FILETIME: 100ns since 1601-01-01. Convert to JS Date.
  // Use BigInt for precision, but JS numbers suffice for recent dates (< 2^53)
  try {
    const ft = Number(BigInt(ftHigh) * 4294967296n + BigInt(ftLow));
    const msSince1601 = ft / 10000;
    const msSince1970 = msSince1601 - 11644473600000;
    return new Date(msSince1970).toISOString();
  } catch (e) { return new Date().toISOString(); }
}

function parseIFile(buf) {
  if (buf.length < 24) return null;
  const isDummyHeader = buf.readUInt32LE(0) === 0;
  // size at offset 8, filetime at 16
  const size = Number(buf.readBigInt64LE(8));
  const ftLow = buf.readUInt32LE(16);
  const ftHigh = buf.readUInt32LE(20);
  const deletedAt = fileTimeToIso(ftLow, ftHigh);
  // Path starts at 24, UTF16LE, remainder of buffer (strip trailing nulls)
  let raw = buf.slice(24).toString('utf16le');
  // Trim trailing null chars
  raw = raw.replace(/\0+$/, '');
  // Real $I files have pathLen at offset 20? Actually our simplified dummy: we ignore header pathLen.
  // Our test helper writes pathLen at 20 then path; handle both.
  // If raw starts with garbage due to pathLen bytes, the real path still embedded; find first "C:" or drive letter.
  // Heuristic: find first occurrence of ":\\"
  const idx = raw.indexOf(':\\');
  let originalPath = raw;
  if (idx > 1 && idx < 10) {
    originalPath = raw.slice(idx - 1);
  }
  // Filter out header junk if path doesn't look like Windows path
  if (!originalPath.match(/^[A-Za-z]:\\/)) {
    // Try stripping first char(s) that are pathLen residue
    originalPath = raw.replace(/^[^\x20-\x7E\u4e00-\u9fa5]+/, '');
  }
  return { size: isNaN(size) ? 0 : size, deletedAt, originalPath: originalPath.trim() };
}

function list() {
  const drives = [];
  for (let c = 67; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try { fs.accessSync(d); drives.push(d); } catch (e) {}
  }
  const items = [];
  for (const drive of drives) {
    const binRoot = path.join(drive, '$Recycle.Bin');
    let sids = [];
    try { sids = fs.readdirSync(binRoot); } catch (e) { continue; }
    for (const sid of sids) {
      const sidDir = path.join(binRoot, sid);
      let entries = [];
      try { entries = fs.readdirSync(sidDir); } catch (e) { continue; }
      for (const name of entries) {
        if (!name.startsWith('$I')) continue;
        const iPath = path.join(sidDir, name);
        const rPath = path.join(sidDir, '$R' + name.slice(2));
        let stat;
        try { stat = fs.statSync(iPath); } catch (e) { continue; }
        let buf;
        try { buf = fs.readFileSync(iPath); } catch (e) { continue; }
        const parsed = parseIFile(buf);
        if (!parsed || !parsed.originalPath) continue;
        // R file may have been already restored/deleted
        let rExists = false;
        try { fs.accessSync(rPath); rExists = true; } catch (e) {}
        if (!rExists) continue;
        const key = iPath; // unique key is the $I path
        items.push({
          key: key,
          originalPath: parsed.originalPath,
          rPath: rPath,
          size: parsed.size,
          deletedAt: parsed.deletedAt,
          drive: drive,
          sid: sid
        });
      }
    }
  }
  // Shell.Application fallback if $I parsing found nothing but bin has $R files (older format)
  if (items.length === 0) {
    try {
      const psOut = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        "(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $_.Name + '|' + $_.Path }"],
        { encoding: 'utf8', timeout: 10000, windowsHide: true });
      const lines = (psOut.stdout || '').split('\n').filter(Boolean);
      for (const line of lines) {
        const idx = line.indexOf('|');
        if (idx < 0) continue;
        const name = line.slice(0, idx).trim();
        const p = line.slice(idx + 1).trim();
        if (!name || !p) continue;
        items.push({ key: p, originalPath: name, rPath: p, size: 0, deletedAt: new Date().toISOString(), drive: '', sid: '', fallback: true });
      }
    } catch (e) {}
  }
  return items;
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  let n = 1;
  let cand;
  do {
    cand = path.join(dir, base + ' (restored' + (n > 1 ? ' ' + n : '') + ')' + ext);
    n++;
  } while (fs.existsSync(cand) && n < 100);
  return cand;
}

function restore(keys) {
  const results = [];
  for (const key of (keys || [])) {
    let iPath = String(key);
    let rPath = iPath.replace(/\$I/, '$R');
    // key may be originalPath-style fallback entry; try to find matching $I
    let parsed = null;
    let buf;
    try { buf = fs.readFileSync(iPath); parsed = parseIFile(buf); } catch (e) {}
    let originalPath = parsed ? parsed.originalPath : null;
    // Fallback entry (no $I): key is already rPath/originalPath
    if (!originalPath) {
      // Try to locate $I file that maps to this key as originalPath
      const all = list();
      const hit = all.find(x => x.originalPath.toLowerCase() === iPath.toLowerCase() || x.rPath.toLowerCase() === iPath.toLowerCase());
      if (hit) { iPath = hit.key; rPath = hit.rPath; originalPath = hit.originalPath; }
      else { results.push({ key: key, ok: false, error: 'not found in recycle bin' }); continue; }
    }
    if (!originalPath) { results.push({ key: key, ok: false, error: 'original path unknown' }); continue; }
    let rExists = false;
    try { fs.accessSync(rPath); rExists = true; } catch (e) {}
    if (!rExists) { results.push({ key: key, ok: false, error: 'R file missing: ' + rPath }); continue; }
    const dest = uniquePath(originalPath);
    try {
      ensureDirFor(dest);
      fs.renameSync(rPath, dest);
      try { fs.unlinkSync(iPath); } catch (e) {}
      results.push({ key: key, ok: true, restoredTo: dest });
    } catch (e) {
      results.push({ key: key, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { list, restore, parseIFile };
