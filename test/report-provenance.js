// test/report-provenance.js — 报告溯源（T2）
//
// 要防的是什么：
//   报告是全局单例 `~/.disk-clean/report.json`，每次扫描直接覆盖上一次；
//   而 `report` 命令的终端输出此前**完全不显示生成时间**（Markdown 里有、终端里没有，
//   两者用的还是不同字段）。用户拿着一份三天前的报告做清理决策，界面上看不出来——
//   而 clean / organize 的候选路径恰恰取自"最近报告"。
//
// 这里验证三件事：
//   1) 溯源判定逻辑本身（含过期边界、旧报告回落、时钟回拨等容易写错的边角）；
//   2) 真实扫描写出的报告**确实**带溯源，且 CLI 与 Markdown 用同一个时间字段；
//   3) 三处输出点（CLI / MCP / GUI 服务层）都走 lib/report.js 这一个实现——
//      防止将来新增输出点时又各自格式化时间（本仓库已经因为"三处各写一份"吃过多次亏）。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const report = require('../lib/report.js');
const VERSION = require('../lib/version.js').VERSION;
const HOUR = 3600000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- 1) 判定逻辑
{
  const now = Date.now();
  const fresh = report.describe({
    generatedAt: new Date(now - 5 * 60000).toISOString(),
    tool: { version: '0.7.1' },
    summary: { roots: ['D:\\'] },
  });
  assert(fresh.present && !fresh.stale, '5 分钟前的报告不应判为过期');
  assert(fresh.rootsText === 'D:\\', 'roots 文本应等于扫描范围，实际 ' + fresh.rootsText);
  assert(fresh.version === '0.7.1', '应读出 tool.version');
  assert(fresh.timeSource === 'generatedAt', '时间来源应为 generatedAt');

  // 过期边界：阈值 24 小时，23 不算、25 必须算
  assert(!report.describe({ generatedAt: new Date(now - 23 * HOUR).toISOString() }).stale,
    '23 小时不应判为过期');
  assert(report.describe({ generatedAt: new Date(now - 25 * HOUR).toISOString() }).stale,
    '25 小时必须判为过期');

  // 旧报告：没有 generatedAt，但 summary.scannedAt 从更早版本就存在。
  // 能判断的就必须判断，不能笼统说"未知"——否则这条溯源对存量报告完全无效。
  const legacy = report.describe({ summary: { scannedAt: new Date(now - 3 * DAY).toISOString(), roots: ['C:\\'] } });
  assert(!legacy.legacy, '带 scannedAt 的报告不算"无时间信息"');
  assert(legacy.timeSource === 'summary.scannedAt', '应回落到 summary.scannedAt');
  assert(legacy.stale, '3 天前的报告必须判为过期');
  assert(/3 天前/.test(legacy.ageText), '相对时间文案应为 3 天前，实际 ' + legacy.ageText);

  // 完全没有时间信息：如实说未知，且**不得**谎称过期（不知道的事不猜）
  const none = report.describe({ summary: {} });
  assert(none.legacy, '无时间信息应标记 legacy');
  assert(!none.stale, '时间未知时不得断言"已过期"');
  assert(none.ageText === '未知', '时间未知时文案应为未知，实际 ' + none.ageText);

  // 无报告
  const nil = report.describe(null);
  assert(!nil.present && nil.rootsText === '未知', '无报告时应 present=false 且范围未知');

  // 时钟回拨 / 未来时间：不得算出负年龄或荒谬文案
  const future = report.describe({ generatedAt: new Date(now + 2 * HOUR).toISOString() });
  assert(future.ageText === '刚刚', '未来时间应显示为"刚刚"，实际 ' + future.ageText);
  assert(!future.stale, '未来时间不应判为过期');

  // stamp 幂等，且不覆盖已有值
  const a = report.stamp({});
  const b = report.stamp(a);
  assert(a.generatedAt === b.generatedAt, 'stamp 必须幂等（不得每次调用刷新时间）');
  assert(a.tool && a.tool.version === VERSION, 'stamp 应写入工具版本');
}

// ---------------------------------------------------------------- 2) 真实扫描
{
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-prov-'));
  try {
    const scanRoot = path.join(tree, 'scanme');
    fs.mkdirSync(scanRoot, { recursive: true });
    fs.writeFileSync(path.join(scanRoot, 'note.txt'), 'hello');
    fs.writeFileSync(path.join(scanRoot, 'junk.tmp'), Buffer.alloc(4096, 0x41));
    const reportPath = path.join(tree, 'report.json');

    const out = execFileSync(process.execPath,
      [path.join(ROOT, 'bin', 'disk-clean.js'), 'scan', scanRoot, '--report', reportPath, '--suggest'],
      { encoding: 'utf8', windowsHide: true, timeout: 180000 });

    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert(typeof rep.generatedAt === 'string' && isFinite(Date.parse(rep.generatedAt)),
      '真实扫描写出的报告必须含可解析的 generatedAt');
    assert(rep.tool && rep.tool.version === VERSION,
      '报告必须记录工具版本，实际 ' + JSON.stringify(rep.tool));
    assert(Array.isArray(rep.summary.roots) && rep.summary.roots.length === 1,
      '报告必须含扫描范围');
    assert(out.indexOf('生成时间') >= 0, 'CLI scan 输出必须显示生成时间');

    // Markdown 与终端此前用的是不同字段（md 用 scannedAt、终端没有），现在必须同源
    const mdPath = reportPath.replace(/\.json$/i, '') + '.md';
    const md = fs.readFileSync(mdPath, 'utf8');
    assert(md.indexOf(rep.generatedAt) >= 0,
      'Markdown 必须使用与 JSON 相同的生成时间字段（此前两边用不同字段，会互相矛盾）');
  } finally {
    try { fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- 3) CLI report 的过期提示
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-prov-old-'));
  try {
    const p = path.join(dir, 'old.json');
    fs.writeFileSync(p, JSON.stringify({
      generatedAt: new Date(Date.now() - 3 * DAY).toISOString(),
      tool: { name: 'disk-clean', version: VERSION },
      elapsedMs: 1234,
      summary: { roots: ['D:\\'], totalBytes: 1024, totalFiles: 1, totalDirs: 1, emptyDirs: 0, status: 'done' },
      category: [],
      suggestions: [],
    }), 'utf8');

    const out = execFileSync(process.execPath,
      [path.join(ROOT, 'bin', 'disk-clean.js'), 'report', p],
      { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert(out.indexOf('生成时间') >= 0, 'CLI report 必须显示生成时间');
    assert(/3 天前/.test(out), 'CLI report 应显示相对时间，实际输出：\n' + out);
    assert(/已超过 24 小时/.test(out), '超过 24 小时必须给出过期提示，实际输出：\n' + out);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- 4) 三处输出点同源
{
  const points = [
    ['bin/disk-clean.js', 'CLI'],
    ['lib/mcp/tools.js', 'MCP'],
    ['lib/serve.js', 'GUI 服务层'],
  ];
  for (const pair of points) {
    const src = fs.readFileSync(path.join(ROOT, pair[0]), 'utf8');
    assert(/report\.js/.test(src),
      pair[1] + '（' + pair[0] + '）没有使用 lib/report.js —— 报告出处必须只有一个实现');
  }
  const app = fs.readFileSync(path.join(ROOT, 'gui', 'web', 'app.js'), 'utf8');
  assert(/prov\.generatedLocal/.test(app), 'GUI 前端没有渲染报告生成时间');
}

console.log('PASS report-provenance: 溯源判定（含 24h 边界、旧报告回落、时钟回拨）+ 真实扫描带溯源' +
  ' + CLI 过期提示 + 三处输出点同源，均通过');
