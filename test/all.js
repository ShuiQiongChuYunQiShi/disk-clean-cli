// test/all.js - run every named suite and report summary
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const homeGuard = require('./_home-guard.js');

// 固定清单（不做“文件存在就跳过”的隐式降级：评审指出静默 SKIP 会让 CI 假绿）
// test/docs-consistency.js 会反向断言本清单与 test/*.js 完全一致——
// 写了测试却忘记注册，会让它在本地与 CI 都永远不跑，那是最隐蔽的一种假绿。
const suites = [
  'engine-smoke.js',
  'engine-edge.js',
  'clean-safety.js',
  'organize-safety.js',
  'safety-gates.js',
  'cli-and-config.js',
  'serve-integration.js',
  'mcp-protocol.js',
  'dsh-config.js',
  'rules-integrity.js',
  'version-consistency.js',
  'ci-workflow.js',
  'docs-consistency.js',
  'build-fingerprint.js',
  'approval-gate.js',
];

let failed = 0;
const results = [];
// 两个 T1 自检也计入总数，避免摘要里的分母与实际情况脱节
const TOTAL = suites.length + 2;

// ---- T1 前置自检 A：每个套件都必须隔离状态目录 ----
// 曾经 15 个套件里有 12 个直接读写**用户真实的** ~/.disk-clean/：报告被覆盖成测试树的结果、
// 审计日志被污染（审计是"工具到底动过什么"的证据）、测试文件被真的丢进用户回收站。
// 修完之后必须防止**将来新增的套件**又忘记隔离，所以这条检查放在 runner 里：漏一个就整体失败。
// 接受两种写法：require('./_isolate.js')（推荐），或套件自己设置 USERPROFILE/HOME（历史实现）。
const OWN_ISOLATION = /process\.env\.USERPROFILE\s*=|TMP_HOME|_isolate/;
{
  const files = fs.readdirSync(__dirname).filter(function (f) {
    return f.endsWith('.js') && f !== 'all.js' && f.charAt(0) !== '_';
  });
  const unprotected = files.filter(function (f) {
    return !OWN_ISOLATION.test(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  });
  if (unprotected.length) {
    failed++;
    console.log('FAIL 状态目录隔离自检：这些套件没有隔离 ~/.disk-clean' +
      '（在顶部加一行 require(\'./_isolate.js\')）：' + unprotected.join(', '));
  } else {
    console.log('PASS 状态目录隔离自检（' + files.length + ' 个套件全部隔离）');
  }
}

// ---- T1 前置自检 B：记录真实 ~/.disk-clean 的指纹 ----
// 这是第二层防线。静态检查管"有没有写隔离代码"，这里管"结果上到底有没有被碰过"——
// 例如某个库在加载时就把文件写到真实 HOME，或者某套件绕过了 os.homedir() 自己拼路径。
const guardBefore = homeGuard.snapshot();

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
// ---- T1 后置自检：真实状态目录必须与跑测试之前一模一样 ----
{
  const d = homeGuard.diff(guardBefore, homeGuard.snapshot());
  if (d.clean) {
    console.log('PASS 真实状态目录未被改动（' + homeGuard.stateDir() + '）');
  } else {
    failed++;
    console.log('FAIL 测试改动了用户真实的状态目录 ' + homeGuard.stateDir());
    if (d.added.length) console.log('  新增：' + d.added.join(', '));
    if (d.changed.length) console.log('  被改：' + d.changed.join(', '));
    if (d.removed.length) console.log('  被删：' + d.removed.join(', '));
    console.log('  这说明有套件绕过了隔离。请修隔离，不要放宽这条断言。');
  }
}

console.log('\n==== SUMMARY: ' + (TOTAL - failed) + '/' + TOTAL + ' passed ====');
if (failed > 0) process.exit(1);
