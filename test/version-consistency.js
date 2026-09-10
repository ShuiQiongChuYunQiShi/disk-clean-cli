// test/version-consistency.js - 版本单一事实源一致性（评审 P2-4）
//
// 版本号曾散落在 6 处，只有一条 bump 脚本串联；漏改一处就会出现
// "安装包写 0.4.1、GUI 页脚写 0.4.0"这类漂移。本测试守住收敛结果：
//   1) 所有字面量派生源 == lib/version.js 的 VERSION
//   2) bin/disk-clean.js 与 lib/serve.js 不得再写死版本号，必须引用 version.js
'use strict';
const { verify, VERSION } = require('../lib/version.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const v = verify();
if (!v.ok) {
  for (const m of v.mismatches) {
    console.error('版本源不一致: ' + m.name + ' -> ' + (m.error || ('实际 ' + m.version + ' ≠ ' + VERSION)));
  }
  throw new Error('FAIL: ' + v.mismatches.length + ' 个版本源与 lib/version.js 不一致');
}
assert(/^\d+\.\d+\.\d+$/.test(VERSION), 'VERSION 语义化：' + VERSION);
assert(v.sources.length >= 7, '至少覆盖 7 个版本源，实际 ' + v.sources.length);
console.log('PASS version-consistency: v' + VERSION + '（' + v.sources.length + ' 个版本源一致）');
