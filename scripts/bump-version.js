#!/usr/bin/env node
// bump-version.js — 单一事实源版本 bump（无 BOM、UTF-8 安全，替代 PS 管道）
// 事实源：lib/version.js 的 VERSION 常量。本脚本把它改为 <to>，并同步所有派生源。
// bin/disk-clean.js 与 lib/serve.js 不再写死版本号（改为 require version.js），
// 所以这里只处理必须出现字面量的产物。
// 用法: node scripts/bump-version.js <from> <to>
//   e.g. node scripts/bump-version.js 0.4.1 0.5.0
'use strict';
const fs = require('fs');
const path = require('path');

const from = process.argv[2];
const to = process.argv[3];
if (!from || !to) {
  console.error('Usage: node scripts/bump-version.js <from> <to>');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(from) || !/^\d+\.\d+\.\d+$/.test(to)) {
  console.error('Version must be x.y.z');
  process.exit(1);
}

function rep(file, a, b) {
  const p = path.join(__dirname, '..', file);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(a)) {
    console.error('MISS: ' + file + ' <- ' + JSON.stringify(a));
    process.exit(1);
  }
  s = s.split(a).join(b);
  fs.writeFileSync(p, s, 'utf8');
  console.log('ok: ' + file);
}

rep('lib/version.js', "const VERSION = '" + from + "';", "const VERSION = '" + to + "';");
rep('package.json', '"version": "' + from + '"', '"version": "' + to + '"');
// package-lock.json 有两个版本字段（顶层 version 与 packages[""].version）。
// 从 v0.2.0 到 v0.5.0 它一直停在 0.1.0：bump 脚本没碰它，npm ci 也不校验版本字段，
// 所以连续三个版本都没人发现。两个字段都用锚点精确替换，不用按值全局替换，
// 避免误伤 lock 里其它 "version" 字段（依赖项的 version 也必须保持不变）。
{
  const p = path.join(__dirname, '..', 'package-lock.json');
  const before = fs.readFileSync(p, 'utf8');
  const rootRe = new RegExp('(^\\s{2}"version"\\s*:\\s*")' + from.replace(/\./g, '\\.') + '(")', 'm');
  const pkgRe = new RegExp('("packages"\\s*:\\s*\\{\\s*""\\s*:\\s*\\{[^}]*?"version"\\s*:\\s*")' + from.replace(/\./g, '\\.') + '(")');
  if (!rootRe.test(before) || !pkgRe.test(before)) {
    console.error('MISS: package-lock.json 顶层/根包版本字段（期望均为 ' + from + '）');
    process.exit(1);
  }
  let after = before.replace(rootRe, '$1' + to + '$2').replace(pkgRe, '$1' + to + '$2');
  // 依赖项版本数必须不变（只动了我们自己的两个字段）
  const countBefore = (before.match(/"version"\s*:/g) || []).length;
  const countAfter = (after.match(/"version"\s*:/g) || []).length;
  if (countBefore !== countAfter) {
    console.error('MISS: package-lock.json 结构被破坏（version 字段数 ' + countBefore + ' -> ' + countAfter + '）');
    process.exit(1);
  }
  fs.writeFileSync(p, after, 'utf8');
  console.log('ok: package-lock.json (root + packages[""])');
}
rep('gui/shell/DiskCleanUi.csproj', '<Version>' + from + '</Version>', '<Version>' + to + '</Version>');
rep('gui/shell/DiskCleanUi.csproj', '<FileVersion>' + from + '</FileVersion>', '<FileVersion>' + to + '</FileVersion>');
rep('gui/shell/DiskCleanUi.csproj', '<InformationalVersion>' + from + '</InformationalVersion>', '<InformationalVersion>' + to + '</InformationalVersion>');
rep('installer/disk-clean-ui.iss', '#define MyAppVersion "' + from + '"', '#define MyAppVersion "' + to + '"');
// index.html verLabel: 旧标签可能残留，用正则兜底
{
  const p = path.join(__dirname, '..', 'gui/web/index.html');
  let s = fs.readFileSync(p, 'utf8');
  const re = new RegExp('id="verLabel">v' + from.replace(/\./g, '\\.') + '<');
  if (!re.test(s)) {
    const any = s.match(/id="verLabel">v[^<]+</);
    if (any) {
      s = s.replace(any[0], 'id="verLabel">v' + to + '<');
      fs.writeFileSync(p, s, 'utf8');
      console.log('ok: gui/web/index.html (regex fallback)');
    } else {
      console.error('MISS: gui/web/index.html verLabel');
      process.exit(1);
    }
  } else {
    s = s.replace(re, 'id="verLabel">v' + to + '<');
    fs.writeFileSync(p, s, 'utf8');
    console.log('ok: gui/web/index.html');
  }
}

// 校验无 BOM
const bomFiles = ['lib/version.js', 'bin/disk-clean.js', 'lib/serve.js', 'gui/web/index.html', 'installer/disk-clean-ui.iss'];
for (const f of bomFiles) {
  const b = fs.readFileSync(path.join(__dirname, '..', f));
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    console.error('BOM detected: ' + f);
    process.exit(1);
  }
}

// bump 后立即自校验：任一派生源不一致就报错退出（避免漂移悄悄进入发布）
const ver = require('../lib/version.js');
const v = ver.verify();
if (!v.ok) {
  console.error('版本漂移未收敛：');
  for (const m of v.mismatches) console.error('  - ' + m.name + ': ' + (m.error || ('实际 ' + m.version + ' ≠ ' + to)));
  process.exit(1);
}
console.log('All done: ' + from + ' -> ' + to + '（' + v.sources.length + ' 个版本源已校验一致）');
