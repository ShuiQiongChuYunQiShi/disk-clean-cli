// engine smoke test — 用相对路径 + 仓库内固定测试树（CI 可移植）
'use strict';
const path = require('path');
const fs = require('fs');
const { run } = require('../lib/engine.js');

(async () => {
  // 构造固定测试树（仓库内，CI 可移植）
  const tree = path.join(__dirname, 'tree');
  fs.mkdirSync(path.join(tree, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'a.bin'), Buffer.alloc(300 * 1024, 1));
  fs.writeFileSync(path.join(tree, 'sub', 'b.log'), 'hello ' + Date.now());
  fs.writeFileSync(path.join(tree, 'sub', 'a.bin'), Buffer.alloc(300 * 1024, 1)); // 重复文件
  fs.writeFileSync(path.join(tree, 'empty.log'), '');

  const scan = await run(['--roots', tree, '--suggest']);
  const sm = scan.data.summary || {};
  console.log('summary keys:', Object.keys(sm));
  console.log('summary:', JSON.stringify(sm));
  console.log('suggestions:', (scan.data.suggestions || []).length);
  console.log('category:', (scan.data.category || []).map(c => c.label + ':' + c.bytes).join(' '));
  if (!sm.totalFiles || sm.totalFiles < 3) { console.error('SMOKE FAIL: files'); process.exit(1); }
  if (!Array.isArray(scan.data.category) || scan.data.category.length === 0) { console.error('SMOKE FAIL: category'); process.exit(1); }
  console.log('SMOKE OK');
})();
