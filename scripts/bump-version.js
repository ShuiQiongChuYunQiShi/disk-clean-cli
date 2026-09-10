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
