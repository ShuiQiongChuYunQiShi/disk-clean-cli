// lib/quota.js — 每用户 / 每目录配额分析（复用 MFT 直读目录聚合）
// 企业场景："谁的磁盘占用最大" 一目了然。基于 $MFT 目录占用表，按 C:\Users\* 前缀分组。
'use strict';
const mftLib = require('./mftscan.js');

const USER_SUBDIRS = ['Downloads', 'Documents', 'Desktop', 'Pictures', 'Videos', 'Music', 'AppData'];
const USER_SUBDIRS_LOW = USER_SUBDIRS.map(function(s) { return s.toLowerCase(); });

function norm(p) { return String(p).replace(/\\+$/, '').toLowerCase(); }

// drive: 'C:'；返回 { ok, drive, users: [{name, bytes, files, subdirs: [{name, bytes}]}], systemBytes, elapsedMs }
function analyze(drive) {
  const r = mftLib.scan(drive, { allDirs: true });
  if (!r.ok) return r;
  const dirs = r.dirsFull || [];
  // 按用户前缀分组：C:\Users\<name>\
  const userRoot = norm(drive + '\\Users\\');
  const users = new Map(); // name -> { bytes, files, subs: Map }
  let systemBytes = 0;
  for (const d of dirs) {
    const p = norm(d.path);
    if (p.indexOf(userRoot) === 0) {
      const rest = p.slice(userRoot.length);
      const segs = rest.split('\\').filter(Boolean);
      if (segs.length === 0) continue;
      const uname = segs[0];
      // 跳过系统用户目录
      if (['public', 'default', 'default user', 'all users'].indexOf(uname) >= 0) { systemBytes += d.bytes; continue; }
      let u = users.get(uname);
      if (!u) { u = { name: uname, bytes: 0, files: 0, subs: new Map() }; users.set(uname, u); }
      u.bytes += d.bytes;
      u.files += d.files;
      if (segs.length >= 2) {
        const sub = segs[1].toLowerCase();
        if (USER_SUBDIRS_LOW.indexOf(sub) >= 0) {
          u.subs.set(USER_SUBDIRS[USER_SUBDIRS_LOW.indexOf(sub)], (u.subs.get(USER_SUBDIRS[USER_SUBDIRS_LOW.indexOf(sub)]) || 0) + d.bytes);
        }
      }
    } else {
      systemBytes += d.bytes;
    }
  }
  const userList = Array.from(users.values()).map(function(u) {
    return {
      name: u.name, bytes: u.bytes,
      subdirs: USER_SUBDIRS.filter(function(s) { return u.subs.has(s); }).map(function(s) {
        return { name: s, bytes: u.subs.get(s) };
      })
    };
  }).sort(function(a, b) { return b.bytes - a.bytes; });
  return {
    ok: true, drive: drive, users: userList, systemBytes: systemBytes,
    elapsedMs: r.elapsedMs, mftRecords: r.summary.mftRecords
  };
}

module.exports = { analyze, USER_SUBDIRS };
