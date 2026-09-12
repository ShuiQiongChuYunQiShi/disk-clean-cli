// test/_home-guard.js — 真实状态目录的守门快照（T1）
//
// 用途：在 `test/all.js` 跑全部套件**之前**和**之后**各取一次真实 ~/.disk-clean 的指纹，
// 断言它没有被改动。这是 T1 的第二层防线：
//   - 第一层是每个套件顶部的 `require('./_isolate.js')`（静态断言保证没人漏）；
//   - 这一层是运行时兜底，能抓到静态检查想不到的路径——例如某个库在加载时
//     就把文件写到了真实 HOME，或者某套件绕过了 os.homedir() 自己拼路径。
//
// 为什么指纹里要带内容哈希而不只看 mtime：审计日志是**追加**写，mtime 会变但内容也变；
// 而只比 mtime 在文件系统时间精度粗糙时会漏判。内容哈希 + 大小是最直接的判据。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function stateDir() {
  return path.join(os.homedir(), '.disk-clean');
}

// 返回 { '相对路径': '大小:内容哈希前16位' }；目录不存在时返回空对象
function snapshot() {
  const root = stateDir();
  const out = {};
  if (!fs.existsSync(root)) return out;
  const walk = function (dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(p, r); continue; }
      try {
        const st = fs.statSync(p);
        const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
        out[r] = st.size + ':' + h;
      } catch (err) {
        out[r] = 'unreadable';
      }
    }
  };
  walk(root, '');
  return out;
}

function diff(before, after) {
  const added = [], removed = [], changed = [];
  for (const k of Object.keys(after)) {
    if (!(k in before)) added.push(k);
    else if (before[k] !== after[k]) changed.push(k);
  }
  for (const k of Object.keys(before)) if (!(k in after)) removed.push(k);
  return {
    added: added, removed: removed, changed: changed,
    clean: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

module.exports = { stateDir, snapshot, diff };
