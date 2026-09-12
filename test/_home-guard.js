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

// 变化清单里的**文件名**能给出"谁写的"这条线索，而这正是不该猜的地方。
//
// 起因：守门第一次失败时，它的信息直接断言"这说明有套件绕过了隔离"——但那次失败
// 只出现过一次、之后反复运行都不复现，而真实目录里变化的是 health*.json。
// 也就是说：那句断言**报告了一个它无法证明的结论**，还把人引向错误的排查方向。
// 本仓库反复出现的"文档/信息比事实更确定"，在这里是同一病症。
//
// 下面这条分类不下结论，只给出判断依据：
//   - 引擎在测试过程中会写 report / audit / organize-map / dedup-map —— 由测试产生的可能性大；
//   - health*、schedule/、approvals/、credentials、restore / fix-shortcuts —— 更像是
//     **本工具被真的使用了**（GUI 启动、健康检查、定时任务、人工发布）产生的，
//     测试一般不会碰它们。
const TEST_LIKE = /^(report\.(json|md)|audit\.jsonl|organize-map\.json|organize-plan\.json|dedup-map\.json)$/;
const EXTERNAL_LIKE = /^(health[^/]*\.(json|ps1)|credentials\.json|restore[^/]*\.ps1|fix-shortcuts\.json|approvals\/|schedule\/)/;

function classify(names) {
  const out = { testLike: [], externalLike: [], unknown: [] };
  for (const n of names) {
    if (EXTERNAL_LIKE.test(n)) out.externalLike.push(n);
    else if (TEST_LIKE.test(n)) out.testLike.push(n);
    else out.unknown.push(n);
  }
  return out;
}

module.exports = { stateDir, snapshot, diff, classify };
