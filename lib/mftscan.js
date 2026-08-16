// lib/mftscan.js — NTFS $MFT 直读快速扫描（实验功能）
// 原理：打开卷设备 \\.\<drive>，读引导扇区定位 $MFT，顺序解析 MFT 记录
// （FILE 头 + FILE_NAME/DATA 属性），按父目录引用链重建路径。
// 依赖：管理员权限（普通用户无法打开卷设备）；仅 NTFS。
// 安全：只读卷设备，不写入任何内容。
'use strict';
const fs = require('fs');
const path = require('path');

const ATTR_STANDARD_INFO = 0x10;
const ATTR_FILE_NAME = 0x30;
const ATTR_DATA = 0x80;

const REC_SIZE = 1024;          // 标准 MFT 记录大小
const CHUNK_RECS = 65536;       // 每次读 65536 条 = 64MB
const MAX_NAME_ATTRS = 32;      // 单记录最多解析属性数（防异常）

// 卷根目录记录号（5 = \）
const ROOT_REC = 5;

function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

// ---------- 打开卷 ----------
function openVolume(drive) {
  const vol = '\\\\.\\' + drive.replace(/[\\/]+$/, '');
  const fd = fs.openSync(vol, 'r');
  const boot = Buffer.alloc(512);
  fs.readSync(fd, boot, 0, 512, 0);
  const oem = boot.toString('ascii', 3, 11).trim();
  if (oem !== 'NTFS') { fs.closeSync(fd); throw new Error('非 NTFS 卷: ' + drive + ' (OEM=' + oem + ')'); }
  const bps = boot.readUInt16LE(11);
  const spc = boot.readUInt8(13);
  const mftLcn = Number(boot.readBigUInt64LE(48));
  const totalSectors = Number(boot.readBigUInt64LE(40));
  return { fd: fd, mftOff: mftLcn * bps * spc, bps: bps, spc: spc, clusterSize: bps * spc, volumeBytes: totalSectors * bps };
}

// ---------- MFT 记录解析 ----------
// 返回 { recNo, flags, inUse, isDir, fileName, parentRef, size, resident } 或 null
function parseRecord(rec) {
  if (rec.toString('ascii', 0, 4) !== 'FILE') return null;
  const recNo = rec.readUInt32LE(44);
  const flags = rec.readUInt16LE(22);
  if (!(flags & 1)) return null; // 未使用记录
  const isDir = (flags & 2) !== 0;
  const firstAttr = rec.readUInt16LE(20);
  if (firstAttr < 24 || firstAttr > REC_SIZE - 8) return null;
  const out = { recNo: recNo, isDir: isDir, name: null, parentRef: null, size: 0, haveSize: false, sysfile: false };
  const names = []; // 收集所有 FILE_NAME（选长名）
  let off = firstAttr;
  let guard = 0;
  while (off + 8 <= REC_SIZE && guard++ < MAX_NAME_ATTRS) {
    const type = rec.readUInt32LE(off);
    if (type === 0xFFFFFFFF) break; // 属性列表结束
    const len = rec.readUInt32LE(off + 4);
    if (len < 8 || off + len > REC_SIZE) break;
    const nonResident = rec.readUInt8(off + 8);
    if (type === ATTR_FILE_NAME && !nonResident) {
      const vLen = rec.readUInt32LE(off + 16);  // resident value length @ +16
      const vOff = rec.readUInt16LE(off + 20);  // resident value offset @ +20
      const vp = off + vOff;
      if (vLen >= 66 && vp + 66 <= REC_SIZE) {
        const parentRef = rec.readUInt32LE(vp);       // 父目录记录号（file reference 低 4 字节）
        const nameLen = rec.readUInt8(vp + 64);        // 文件名长度（字符数，value 内 offset 64）
        const ns = rec.readUInt8(vp + 65);             // 命名空间：0=POSIX 1=Win32 2=DOS 3=Win32&DOS
        if (nameLen > 0 && nameLen <= 255 && vp + 66 + nameLen * 2 <= REC_SIZE) {
          const nameBytes = Buffer.alloc(nameLen * 2);
          rec.copy(nameBytes, 0, vp + 66, vp + 66 + nameLen * 2);
          names.push({ name: nameBytes.toString('utf16le'), ns: ns });
          out.parentRef = parentRef;
        }
      }
    } else if (type === ATTR_DATA && !out.haveSize) {
      if (nonResident) {
        // 占用口径：allocated 合理（≤ real×2+4MB）时用占用，否则回退 real（稀疏/异常时 real 更可靠）
        const alloc = Number(rec.readBigUInt64LE(off + 40));
        const real = Number(rec.readBigUInt64LE(off + 48));
        out.size = (alloc > 0 && alloc <= real * 2 + 4 * 1024 * 1024) ? alloc : real;
        out.haveSize = true;
      } else {
        const vLen = rec.readUInt32LE(off + 16);
        out.size = vLen;
        out.haveSize = true;
      }
    }
    off += len;
  }
  // 选择 FILE_NAME：优先 Win32/POSIX 长名（ns 0/3），其次 Win32(1)，最后 DOS 短名(2)
  if (names.length > 0) {
    const pick = names.find(function(n) { return n.ns === 3 || n.ns === 0; }) ||
                 names.find(function(n) { return n.ns === 1; }) ||
                 names[0];
    out.name = pick.name;
  }
  if (out.name === null || out.name === '') return null; // 无文件名（通常是元文件）
  // 系统文件（$MFT 等）：名字以 $ 开头
  if (out.name.charAt(0) === '$') out.sysfile = true;
  return out;
}

// ---------- runlist 解析（rec0 = $MFT 的 DATA 属性） ----------
// 返回 [{ lcn, lenClusters }]；LCN 为卷簇号，负值表示稀疏/异常跳过
function parseRuns(rec) {
  let off = rec.readUInt16LE(20);
  let guard = 0;
  while (off + 8 <= REC_SIZE && guard++ < MAX_NAME_ATTRS) {
    const type = rec.readUInt32LE(off);
    if (type === 0xFFFFFFFF) break;
    const len = rec.readUInt32LE(off + 4);
    if (len < 8 || off + len > REC_SIZE) break;
    const nonResident = rec.readUInt8(off + 8);
    if (type === ATTR_DATA && nonResident) {
      const runOff = rec.readUInt32LE(off + 32);
      const runs = [];
      let rp = off + runOff, prevLcn = 0, k = 0;
      while (rp + 1 < REC_SIZE && k++ < 4096) {
        const h = rec.readUInt8(rp);
        if (h === 0) break;
        const lenBytes = h & 0x0F, offBytes = (h >> 4) & 0x0F;
        if (lenBytes === 0 || offBytes > 8 || rp + 1 + lenBytes + offBytes > REC_SIZE) break;
        let rlen = 0;
        for (let i = 0; i < lenBytes; i++) rlen += rec.readUInt8(rp + 1 + i) * Math.pow(2, 8 * i);
        let roff = 0;
        for (let i = 0; i < offBytes; i++) roff += rec.readUInt8(rp + 1 + lenBytes + i) * Math.pow(2, 8 * i);
        if (offBytes > 0) {
          const max = Math.pow(2, 8 * offBytes); // 符号扩展（避免 32 位溢出）
          if (roff >= max / 2) roff -= max;
        }
        prevLcn += roff;
        runs.push({ lcn: prevLcn, lenClusters: rlen });
        rp += 1 + lenBytes + offBytes;
      }
      return runs;
    }
    off += len;
  }
  return [];
}

// ---------- 扫描 ----------
// drive: 'D:' 等；返回 { ok, summary, files, topDirs, topFiles, category, elapsedMs }
function scan(drive, opts) {
  opts = opts || {};
  if (!opts.categoryMap) {
    try { opts.categoryMap = require('./engine.js').EXT_CAT; } catch (e) { /* 引擎不可用则不分类 */ }
  }
  const t0 = Date.now();
  let vol;
  try { vol = openVolume(drive); }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  const CHUNK = CHUNK_RECS * REC_SIZE;
  const buf = Buffer.alloc(CHUNK);
  const clusterSize = vol.bps * vol.spc;
  // 解析 $MFT runlist（rec0），按 run 读取（处理碎片）
  let runs = [];
  try {
    const rec0 = Buffer.alloc(REC_SIZE);
    fs.readSync(vol.fd, rec0, 0, REC_SIZE, vol.mftOff);
    runs = parseRuns(rec0);
  } catch (e) { /* 无 runlist 时退回顺序读 */ }
  let recNo = 0;
  const recs = new Map();       // recNo -> parsed
  const order = [];             // 记录顺序（用于 parent 解析在全部读取后进行）
  let bytes = 0, files = 0, dirs = 0, sysBytes = 0, sysFiles = 0;
  function readRun(physBase, runRecs) {
    let i = 0;
    while (i < runRecs) {
      const nRecs = Math.min(CHUNK_RECS, runRecs - i);
      const want = nRecs * REC_SIZE;
      let n = 0;
      try { n = fs.readSync(vol.fd, buf, 0, want, physBase + i * REC_SIZE); }
      catch (e) { if (e.code === 'EINVAL' || e.code === 'EIO') break; throw e; }
      if (n <= 0) break;
      const usable = Math.min(n, want);
      for (let j = 0; j + REC_SIZE <= usable; j += REC_SIZE) {
        const parsed = parseRecord(buf.slice(j, j + REC_SIZE));
        if (parsed) {
          recs.set(parsed.recNo, parsed);
          order.push(parsed.recNo);
          if (parsed.sysfile) { sysBytes += parsed.size; sysFiles++; continue; }
          if (parsed.isDir) { dirs++; }
          else { files++; bytes += parsed.size; }
        }
      }
      i += nRecs;
      if (n < want) break;
    }
  }
  try {
    if (runs.length > 0) {
      const recsPerCluster = clusterSize / REC_SIZE; // 每簇记录数（4096/1024=4）
      for (const run of runs) {
        if (run.lcn < 0) continue;                       // 无效 LCN
        if (run.lcn * clusterSize >= vol.volumeBytes) continue; // 超出卷容量
        const runBytes = run.lenClusters * clusterSize;
        const runRecs = Math.floor(runBytes / REC_SIZE);
        if (runRecs <= 0) continue;
        readRun(run.lcn * clusterSize, runRecs);
      }
    } else {
      // 退回顺序读（无 runlist 信息）：读到卷尾前连续空洞超阈值即停
      let blankRun = 0;
      while (true) {
        let n = 0;
        try { n = fs.readSync(vol.fd, buf, 0, CHUNK, vol.mftOff + recNo * REC_SIZE); }
        catch (e) { if (e.code === 'EINVAL' || e.code === 'EIO') break; throw e; }
        if (n <= 0) break;
        const usable = Math.min(n, CHUNK);
        let blank = 0;
        for (let i = 0; i + REC_SIZE <= usable; i += REC_SIZE) {
          const parsed = parseRecord(buf.slice(i, i + REC_SIZE));
          if (parsed) {
            blank = 0;
            recs.set(parsed.recNo, parsed);
            order.push(parsed.recNo);
            if (parsed.sysfile) { sysBytes += parsed.size; sysFiles++; continue; }
            if (parsed.isDir) { dirs++; }
            else { files++; bytes += parsed.size; }
          } else blank++;
        }
        blankRun += blank;
        if (blankRun >= 131072) break;
        if (blank < usable / REC_SIZE && blankRun > 65536) blankRun = 0;
        recNo += CHUNK_RECS;
        if (n < CHUNK) break;
      }
    }
  } finally {
    try { fs.closeSync(vol.fd); } catch (e) { /* ignore */ }
  }
  // 重建路径：向上链到卷根（记录号 5），用父目录引用（迭代 + 环检测）
  const nameCache = new Map();
  function pathOf(rec) {
    const cached = nameCache.get(rec);
    if (cached !== undefined) return cached;
    if (rec === ROOT_REC) { nameCache.set(rec, ''); return ''; }
    const parts = [];
    const seen = new Set();
    let cur = rec;
    let ok = true;
    while (cur !== undefined && cur !== null && !seen.has(cur)) {
      if (nameCache.has(cur)) {
        const base = nameCache.get(cur);
        if (base === null) { ok = false; break; }
        if (base !== '') parts.push(base);
        break;
      }
      seen.add(cur);
      const r = recs.get(cur);
      if (!r || r.name === null) { ok = false; break; }
      parts.push(r.name);
      cur = r.parentRef;
      if (cur === ROOT_REC) break;
    }
    if (!ok || cur === undefined || cur === null || (cur !== ROOT_REC && seen.has(cur))) {
      nameCache.set(rec, null);
      return null;
    }
    // parts 顺序 rec→root，反转为 root→rec
    let full = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      full = full === '' ? parts[i] : full + '\\' + parts[i];
    }
    nameCache.set(rec, full);
    return full;
  }
  // 统计聚合
  const catBytes = {};
  const catCount = {};
  const extBytes = {};
  const dirBytes = {};
  const dirFiles = {};
  const topFiles = [];
  for (const rno of order) {
    const r = recs.get(rno);
    if (!r || r.sysfile) continue;
    const p = pathOf(rno);
    if (r.isDir) {
      if (p) dirBytes[p] = 0; // 目录聚合：先建 key，文件累加时向上加
    }
  }
  // 文件累加（向父目录链聚合到顶层）
  for (const rno of order) {
    const r = recs.get(rno);
    if (!r || r.sysfile || r.isDir) continue;
    const ext = extOf(r.name || '');
    const ek = ext === '' ? '(无扩展名)' : ext;
    extBytes[ek] = (extBytes[ek] || 0) + r.size;
    const cat = opts.categoryMap ? (opts.categoryMap[ext] || '其他') : '其他';
    catBytes[cat] = (catBytes[cat] || 0) + r.size;
    catCount[cat] = (catCount[cat] || 0) + 1;
    if (r.size > 0) {
      const tf = topFiles;
      if (tf.length < 100) { tf.push({ path: r.name, bytes: r.size }); tf.sort((a, b) => b.bytes - a.bytes); }
      else if (r.size > tf[tf.length - 1].bytes) { tf[tf.length - 1] = { path: r.name, bytes: r.size }; tf.sort((a, b) => b.bytes - a.bytes); }
    }
    // 父链聚合（最多 8 层）
    let cur = r.parentRef, guard = 0;
    while (cur !== undefined && cur !== null && guard++ < 8) {
      const parent = recs.get(cur);
      if (!parent) break;
      const pp = nameCache.get(cur);
      if (pp !== undefined && pp !== null && pp !== '') {
        dirBytes[pp] = (dirBytes[pp] || 0) + r.size;
        dirFiles[pp] = (dirFiles[pp] || 0) + 1;
      }
      cur = parent.parentRef;
      if (cur === ROOT_REC) break;
    }
  }
  const topDirs = Object.keys(dirBytes).map(function(d) {
    return { path: drive + '\\' + d, bytes: dirBytes[d], files: dirFiles[d] || 0, dirs: 0 };
  }).sort((a, b) => b.bytes - a.bytes).slice(0, 100);
  const category = Object.keys(catBytes).map(function(c) {
    return { label: c, bytes: catBytes[c], count: catCount[c] || 0 };
  }).sort((a, b) => b.bytes - a.bytes);
  const extTop = Object.keys(extBytes).map(function(e) {
    return { ext: e, bytes: extBytes[e] };
  }).sort((a, b) => b.bytes - a.bytes).slice(0, 30);
  const elapsedMs = Date.now() - t0;
  return {
    ok: true, drive: drive, elapsedMs: elapsedMs,
    summary: {
      totalBytes: bytes, totalFiles: files, totalDirs: dirs,
      emptyDirs: 0, sysBytes: sysBytes, sysFiles: sysFiles,
      mftRecords: recs.size, scannedAt: new Date().toISOString()
    },
    category: category, extTop: extTop, topDirs: topDirs, topFiles: topFiles
  };
}

module.exports = { scan, openVolume, parseRecord, parseRuns };
