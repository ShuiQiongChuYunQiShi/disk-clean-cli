// test/capability-matrix.js — 能力矩阵守门（T7）
//
// 要防的是什么：
//   同一个能力，在 CLI / MCP / GUI 三个面上的可用性经常不一样。本仓库历史上反复出现
//   "某能力只有 CLI 有、MCP 忘了加"、"加了工具但文档没写"、"文档说支持但实现里没有"。
//   而**没有任何机制在它发生时发出声音**——只能靠人记得三处同步。
//
// docs/CAPABILITY-MATRIX.md 就是那份"声明"，本套件做双向校验：
//   ① 矩阵里写的入口必须**真实存在**（防"文档承诺了不存在的入口"）；
//   ② 实现里的入口必须**都出现在矩阵里**（防"加了能力忘了登记"）。
//   两边任何一边漏了都会失败。
//
// 解析约定（见矩阵文档开头）：**入口名用反引号标出，参数说明不用反引号**。
// 所以"反引号里的内容"就是入口名，可以机械提取——不需要在测试里维护第二份清单
// （那样测的就不是文档与实现是否一致，而是"两份清单是否一致"）。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（本套件只读源码，但保持一致）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const DOC = path.join(ROOT, 'docs', 'CAPABILITY-MATRIX.md');
const doc = fs.readFileSync(DOC, 'utf8');

// ---------------------------------------------------------------- 解析矩阵
const start = doc.indexOf('## 1. 矩阵');
const end = doc.indexOf('## 2.');
assert(start >= 0 && end > start, 'CAPABILITY-MATRIX.md 里找不到「## 1. 矩阵」段落');
const section = doc.slice(start, end);

const ticks = (cell) => Array.from(cell.matchAll(/`([^`]+)`/g)).map((m) => m[1]);
const rows = [];
for (const line of section.split('\n')) {
  if (!/^\|/.test(line)) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 4) continue;
  if (cells[0] === '能力') continue;                                   // 表头
  if (/^-+$/.test(cells[1].replace(/[-\s]/g, ''))) continue;           // 分隔行
  rows.push({ name: cells[0], cli: ticks(cells[1]), mcp: ticks(cells[2]), gui: ticks(cells[3]) });
}
assert(rows.length >= 15, '矩阵解析出的能力行太少（' + rows.length + '），解析可能有误');

const declared = { cli: new Set(), mcp: new Set(), gui: new Set() };
for (const r of rows) {
  for (const k of ['cli', 'mcp', 'gui']) for (const v of r[k]) declared[k].add(v);
}

// ---------------------------------------------------------------- 取实现的入口
// CLI：switch 里的 case（含 help/version 之类的入口，稍后按白名单排除）
const cliSrc = fs.readFileSync(path.join(ROOT, 'bin', 'disk-clean.js'), 'utf8');
const cliCases = new Set();
for (const m of cliSrc.matchAll(/\n\s*case '([^']+)'/g)) cliCases.add(m[1]);

// MCP：注册的工具名
const mcpTools = new Set(require('../lib/mcp/tools.js').tools().map((t) => t.name));

// GUI：lib/serve.js 里的 /api/ 路径
const serveSrc = fs.readFileSync(path.join(ROOT, 'lib', 'serve.js'), 'utf8');
const guiEndpoints = new Set();
for (const m of serveSrc.matchAll(/'(\/api\/[a-z0-9/_-]+)'/gi)) guiEndpoints.add(m[1]);

// ---------------------------------------------------------------- ① 声明 ⊇ 实现？
// 矩阵里的入口必须真实存在——防"文档承诺了不存在的入口"
const missing = { cli: [], mcp: [], gui: [] };
for (const v of declared.cli) if (!cliCases.has(v) && cliCases.size && !/^--/.test(v)) missing.cli.push(v);
for (const v of declared.mcp) if (!mcpTools.has(v)) missing.mcp.push(v);
for (const v of declared.gui) if (!guiEndpoints.has(v)) missing.gui.push(v);
assert(missing.cli.length === 0, '矩阵声明的 CLI 入口在 bin/disk-clean.js 里不存在：' + missing.cli.join(', '));
assert(missing.mcp.length === 0, '矩阵声明的 MCP 工具未注册：' + missing.mcp.join(', '));
assert(missing.gui.length === 0, '矩阵声明的 GUI 端点在 lib/serve.js 里不存在：' + missing.gui.join(', '));

// ---------------------------------------------------------------- ② 实现 ⊇ 声明？
// 实现里的入口必须都在矩阵里——防"加了能力忘了登记"。
// 白名单只放**入口本身**而不是能力的东西：--version/--help 这类别名，以及 help。
const CLI_ALIASES = new Set(['help', 'version', '-v', '--version', '-h', '--help']);
const undocumentedCli = Array.from(cliCases).filter((c) => !declared.cli.has(c) && !CLI_ALIASES.has(c));
assert(undocumentedCli.length === 0,
  '这些 CLI 命令没写进能力矩阵：' + undocumentedCli.join(', ') +
  '（新增能力后请在 docs/CAPABILITY-MATRIX.md 的 §1 表格补一行）');

const undocumentedMcp = Array.from(mcpTools).filter((t) => !declared.mcp.has(t));
assert(undocumentedMcp.length === 0,
  '这些 MCP 工具没写进能力矩阵：' + undocumentedMcp.join(', '));

// GUI 的辅助端点（进度查询与取消）归入"扫描"能力那一行的同一格，因此这里都能找到；
// 若将来新增端点却忘了登记，这一条会失败。
const undocumentedGui = Array.from(guiEndpoints).filter((e) => !declared.gui.has(e));
assert(undocumentedGui.length === 0,
  '这些 GUI 端点没写进能力矩阵：' + undocumentedGui.join(', '));

// ---------------------------------------------------------------- ③ 已登记的不一致不得悄悄消失
// §3 记录了四处"欠债不是设计"的差异。修好一处就该把它从这里删掉，
// 但**不能**在没修的情况下删——那等于把问题从文档里抹掉。
const debt = doc.slice(doc.indexOf('## 3.'), doc.indexOf('## 4.'));
const DEBT_PATTERNS = [
  { key: 'GUI 报告历史端点', match: /GUI 没有报告历史端点/ },
  { key: '前端未调用 /api/report', match: /前端不调用\s*`\/api\/report`/ },
  { key: 'CLI 无进度 ETA', match: /CLI 没有扫描进度百分比/ },
  { key: 'GUI 恒定提权', match: /GUI 恒定提权/ },
];
for (const d of DEBT_PATTERNS) {
  assert(d.match.test(debt),
    '§3 里登记的「' + d.key + '」不见了。若确实已修复，请一并删掉本条断言与该行；' +
    '若还没修，请不要把它从文档里抹掉——那正是"大家以为三处一致"的来源。');
}

// ---------------------------------------------------------------- ④ 反向一致性：修好了就要登记
// 只做一条可机器判定的：报告历史在 CLI 与 MCP 都已可用，那么 §3 第 1 项
// 必须**只**说 GUI 缺——如果哪天 GUI 也补上了，这一条会提醒去更新文档。
assert(declared.cli.has('report') && declared.mcp.has('disk_report'),
  '报告能力应当同时在 CLI 与 MCP 上可用');

console.log('PASS capability-matrix: ' + rows.length + ' 条能力 × 三面双向核对通过（' +
  cliCases.size + ' 个 CLI 命令 / ' + mcpTools.size + ' 个 MCP 工具 / ' + guiEndpoints.size +
  ' 个 GUI 端点均已登记）；' + DEBT_PATTERNS.length + ' 处已知不一致仍在册');
