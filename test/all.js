// test/all.js - run every named suite and report summary
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

// 固定清单（不做“文件存在就跳过”的隐式降级：评审指出静默 SKIP 会让 CI 假绿）
const suites = [
  'engine-smoke.js',
  'engine-edge.js',
  'clean-safety.js',
  'organize-safety.js',
  'serve-integration.js',
  'mcp-protocol.js',
  'dsh-config.js',
  'rules-integrity.js',
  'version-consistency.js',
  'ci-workflow.js',
];

let failed = 0;
const results = [];
for (const s of suites) {
  try {
    const out = execFileSync('node', [path.join(__dirname, s)], { encoding: 'utf8', timeout: 300000, windowsHide: true });
    results.push({ name: s, ok: true, out: out.trim() });
    console.log('PASS ' + s);
  } catch (e) {
    failed++;
    const msg = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    results.push({ name: s, ok: false, out: msg });
    console.log('FAIL ' + s + '\n' + msg);
  }
}
console.log('\n==== SUMMARY: ' + (suites.length - failed) + '/' + suites.length + ' passed ====');
if (failed > 0) process.exit(1);
