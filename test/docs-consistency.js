// test/docs-consistency.js — 文档一致性守门（S7）
//
// 要解决的问题：文档漂移在本仓库已经反复发作，而且每一次都是**同一类**问题：
//   - README 展示的建议输出与实现不匹配（`[organize-folders] 目录整理建议` vs 实际 `[junk-temp] junk-temp`）
//   - README 说 11 个套件，实际已经 12 个（新增 cli-and-config 后没回头改）
//   - README 说"16 个受保护段"，却只列了 15 个（把 program files 两项压成了一项）
//   - README 的 `scripts\build.ps1` 根本不存在（真名 build-sea.ps1）
//   - MCP 工具描述承诺了三个从未被读取的配置项（retention.reports / junkRules / organizeRules）
//   - 一个测试文件写好了却忘了注册进 test/all.js —— 于是它在本地和 CI **都永远不跑**
//
// 共同点：**全都是"约定"而不是"脚本级拦截"**。参考项目（navigator）的教训是，
// 它家的 doc-sync 也只是一张映射表加人工自查，结果主链早已不受保护而没人知道。
// 本仓库有 12 套件测试基础设施，所以可以把这类约定升级成真正的门禁——这比参考项目更进一步。
//
// 断言的都是**机器可判定的事实**，不做文章风格检查：
//   A. 套件注册完整性（写了测试却没注册 = 永不运行）
//   B. README 里声明的套件数 == 实际套件数
//   C. MCP 工具数量与工具名单 == lib/mcp/tools.js 的真实注册结果
//   D. 受保护路径段数量与枚举 == lib/guard.js 的名单
//   E. README 命令表里的每个命令都真实存在
//   F. 文档里引用的 scripts/* 路径都真实存在
//   G. 死配置闸门：配置项要么接线、要么登记为未实现、且不得被当已有能力承诺
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

const README = read('README.md');
const README_ZH = read('README.zh-CN.md');

// 只扫这些"面向人/面向 AI 的说明文档"；历史上漂移都发生在这几处
const DOC_FILES = [
  'README.md',
  'README.zh-CN.md',
  'docs/RELEASE-PLAYBOOK.md',
  'skills/release-sop/SKILL.md',
  'skills/gui-development/SKILL.md',
];

// ---------------------------------------------------------------- A. 套件注册完整性
const testDir = path.join(ROOT, 'test');
// `_` 开头的是测试辅助模块（_isolate / _home-guard），不是套件，不参与注册清单
const testFiles = fs.readdirSync(testDir)
  .filter((f) => f.endsWith('.js') && f !== 'all.js' && f.charAt(0) !== '_').sort();
const allSrc = read('test/all.js');
const suitesBlock = /const suites = \[([\s\S]*?)\]/.exec(allSrc);
assert(suitesBlock, 'test/all.js 里找不到 suites 数组');
const registered = Array.from(suitesBlock[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);

const unregistered = testFiles.filter((f) => registered.indexOf(f) < 0);
const missing = registered.filter((f) => testFiles.indexOf(f) < 0);
assert(unregistered.length === 0,
  '这些测试文件没有注册进 test/all.js，因此本地与 CI 都不会运行它们：' + unregistered.join(', '));
assert(missing.length === 0,
  'test/all.js 注册了不存在的测试文件：' + missing.join(', '));
assert(registered.length === testFiles.length,
  '套件数量不一致：磁盘 ' + testFiles.length + ' 个，注册 ' + registered.length + ' 个');

// ---------------------------------------------------------------- B. 套件数量声明
function numbersFor(text, re, label) {
  return Array.from(text.matchAll(re)).map((m) => ({ n: Number(m[1]), raw: m[0], label: label }));
}
const suiteClaims = []
  .concat(numbersFor(README, /(\d+)\s+suites/g, 'README.md'))
  .concat(numbersFor(README_ZH, /(\d+)\s*个套件/g, 'README.zh-CN.md'));
for (const c of suiteClaims) {
  assert(c.n === registered.length,
    c.label + ' 声称『' + c.raw + '』，实际套件数为 ' + registered.length +
    '（新增套件后请同步文档；这条断言就是为了让忘记同步变成构建失败）');
}

// ---------------------------------------------------------------- C. MCP 工具数量与名单
const toolsLib = require('../lib/mcp/tools.js');
const toolNames = toolsLib.tools().map((t) => t.name);
assert(toolNames.length > 0, 'lib/mcp/tools.js 没有注册任何工具');
// 工具描述也要在 G 段做"未实现承诺"检查，这里先留着完整列表
const mcpToolDescs = toolsLib.tools();

const toolClaims = []
  .concat(numbersFor(README, /(\d+)\s+MCP tools/g, 'README.md'))
  .concat(numbersFor(README, /(\d+)\s+disk tools/g, 'README.md'))
  .concat(numbersFor(README_ZH, /(\d+)\s*个 MCP 工具/g, 'README.zh-CN.md'))
  .concat(numbersFor(README_ZH, /(\d+)\s*个磁盘工具/g, 'README.zh-CN.md'));
for (const c of toolClaims) {
  assert(c.n === toolNames.length,
    c.label + ' 声称『' + c.raw + '』，实际注册 ' + toolNames.length + ' 个工具');
}

// README 里列举的工具名必须与真实注册名一一对应（列错/漏列/多列都失败）
const listedTools = Array.from(README.matchAll(/`(disk_[a-z]+)`/g)).map((m) => m[1]);
const listedUnique = Array.from(new Set(listedTools)).sort();
if (listedUnique.length) {
  const missingTools = toolNames.filter((n) => listedUnique.indexOf(n) < 0).sort();
  const extraTools = listedUnique.filter((n) => toolNames.indexOf(n) < 0);
  assert(missingTools.length === 0, 'README 的工具清单漏了：' + missingTools.join(', '));
  assert(extraTools.length === 0, 'README 列出了未注册的工具：' + extraTools.join(', '));
}

// ---------------------------------------------------------------- D. 受保护路径段
const guard = require('../lib/guard.js');
const segs = guard.PROTECTED_SEGMENTS;
assert(Array.isArray(segs) && segs.length > 0, 'lib/guard.js 没有 PROTECTED_SEGMENTS');

const segClaims = []
  .concat(numbersFor(README, /(\d+)\s+protected segments/g, 'README.md'))
  .concat(numbersFor(README_ZH, /(\d+)\s*个受保护段/g, 'README.zh-CN.md'));
for (const c of segClaims) {
  assert(c.n === segs.length,
    c.label + ' 声称『' + c.raw + '』，lib/guard.js 实际有 ' + segs.length + ' 段');
}
// 每一段都必须在 README 里被逐条列出。只写数量不写内容，读者无法核对；
// 这条曾经真的漏过：声称 16 段却只列了 15 项（program files 两项被压成一项）。
const undocumented = segs.filter((s) => README.indexOf('`' + s + '`') < 0);
assert(undocumented.length === 0,
  'README.md 的受保护路径清单没有逐条列出：' + undocumented.join(', ') +
  '（不要用 `\\program files*\\` 这类压缩写法，数量与枚举必须能对上）');

// ---------------------------------------------------------------- E. README 命令表
const cliSrc = read('bin/disk-clean.js');
const switchBlock = /switch \(cmd\) \{([\s\S]*?)\n    \}/.exec(cliSrc);
assert(switchBlock, 'bin/disk-clean.js 里找不到命令 switch');
const cases = Array.from(switchBlock[1].matchAll(/case '([^']+)'/g)).map((m) => m[1]);
assert(cases.length > 0, '命令 switch 里没有解析出任何 case');

const cmdRows = Array.from(README.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)).map((m) => m[1]);
const documentedCmds = [];
for (const cell of cmdRows) {
  const first = cell.trim().split(/\s+/)[0];
  if (!first || first.charAt(0) === '-') continue;   // `--restore-point` / `--lang` 是选项不是命令
  if (documentedCmds.indexOf(first) < 0) documentedCmds.push(first);
}
assert(documentedCmds.length >= 10, 'README 命令表解析出的命令太少（' + documentedCmds.length + ' 个），解析可能有误');
const unknownCmds = documentedCmds.filter((c) => cases.indexOf(c) < 0);
assert(unknownCmds.length === 0,
  'README 命令表里这些命令在 bin/disk-clean.js 中不存在：' + unknownCmds.join(', '));

// ---------------------------------------------------------------- F. 文档引用的脚本路径
const scriptRefs = new Set();
for (const doc of DOC_FILES) {
  if (!exists(doc)) continue;
  const text = read(doc);
  for (const m of text.matchAll(/scripts[\\/][A-Za-z0-9._-]+\.(?:ps1|js)/g)) {
    scriptRefs.add(m[0].replace(/\\/g, '/'));
  }
}
for (const ref of Array.from(scriptRefs).sort()) {
  assert(exists(ref), '文档引用了不存在的脚本 ' + ref +
    '（改脚本名后必须同步文档；这条曾经真的漂移过：README 写的是 scripts/build.ps1）');
}

// ---------------------------------------------------------------- G. 死配置闸门
// 配置项只有两种合法状态：**接线**（能被 lib/bin 读到）或**登记为未实现**。
// 第三种状态——"存在但没人发现"——正是 v0.7.0 的 `blacklist` 事件，
// 而当时逐项修的做法导致 retention.reports / junkRules / organizeRules 三项漏网，
// 还在同一版的 MCP 工具描述里又承诺了一遍。所以这里按**类别**守，不按个例守。
const cfgLib = require('../lib/config.js');
const DEFAULTS = cfgLib.DEFAULT_CONFIG;
const UNIMPLEMENTED = cfgLib.UNIMPLEMENTED || [];

function leafPaths(obj, prefix) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? prefix + '.' + k : k;
    // 空对象也是叶子：`organizeRules: {}` 是一个配置项本身，不是"中间节点"。
    // 第一版把它当中间节点递归下去，得到空结果，于是它**从未进入检查集合**——
    // 一个漏掉整棵子树的漏洞，表现却是"登记过期"这种看起来无关的报错。
    const isBranch = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
    if (isBranch) out.push.apply(out, leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

// 实现侧源码：lib 与 bin 的全部 .js（排除 config.js 自身，否则自己声明自己算"活着"）
//
// 关键一步：先剥掉注释与字符串字面量，再做匹配。
// 这一步不是洁癖，是必须的——第一版实现直接在原文上搜键名，
// 结果**把说明文字里的键名当成了"代码在读取"**：`lib/mcp/tools.js` 的工具描述里
// 写着"还存在 retention.reports / junkRules / organizeRules 但尚未读取"，
// 于是这三个未实现的键被判定为"已经接线"，门禁反而报告"登记过期"。
// 说到底：文档里提到一个键 ≠ 代码里读了这个键。要区分就必须只看代码。
//
// 第二版又踩了一个坑：正则字面量。`lib/engine-core.js` 里有 `/["']/` 这类正则，
// 里面带引号，简单的字符串扫描会把引号当成字符串起点，**一路吞掉几百行代码**，
// 于是所有配置键都被判成"死"。所以下面必须识别正则字面量，并配一个自检。
function regexAllowedAt(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true;
  if ('(,=:[!&|?{};+-*%<>~^'.indexOf(out[j]) >= 0) return true;
  const m = /([A-Za-z_$][\w$]*)$/.exec(out.slice(0, j + 1));
  return !!(m && /^(return|typeof|case|in|of|instanceof|new|delete|void|do|else|yield|await)$/.test(m[1]));
}

function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '/' && c2 === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; continue; }
    if (c === '/' && regexAllowedAt(out)) {
      i++;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// 剥离器自检。它一旦坏掉（比如又被正则里的引号带跑），表现是"所有配置键都变成死的"，
// 看起来门禁在工作，其实只是在报垃圾。所以先证明它按预期工作，再拿它下结论。
{
  const sample = stripNonCode([
    "const re = /['\"]/g;                        // 正则里有引号",
    "const a = cfg.exclude;                      // 属性访问必须留下",
    "// cfg.junkRules 只出现在注释里",
    "const b = 'cfg.thresholds';                 // 字符串必须被剥掉",
  ].join('\n'));
  assert(/\.exclude\b/.test(sample), '剥离器自检失败：属性访问被误删，后续所有键都会被误判为死');
  assert(!/junkRules/.test(sample), '剥离器自检失败：注释没有被去掉');
  assert(!/thresholds/.test(sample), '剥离器自检失败：字符串字面量没有被去掉');
  assert(/const a = cfg\.exclude/.test(sample), '剥离器自检失败：正则字面量吃掉了后面的代码（engine-core.js 的真实故障）');
}

function implSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const q = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(q); }
      else if (e.name.endsWith('.js') && path.basename(q) !== 'config.js') {
        out.push(stripNonCode(fs.readFileSync(q, 'utf8')));
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  walk(path.join(ROOT, 'bin'));
  return out;
}
const implText = implSources().join('\n');
assert(/\.looseMinBytes\b/.test(implText),
  '剥离后连 engine-core.js 的 thresholds 读取点都找不到，说明剥离器吃掉了代码（见上面的自检）');

const declaredPaths = UNIMPLEMENTED.map((u) => u.path);
const leaves = leafPaths(DEFAULTS, '');
const dead = [];
for (const leaf of leaves) {
  const key = leaf.split('.').pop();
  // 在**剥离了注释与字符串**的代码里搜键名标识符。两种真实读取形式都要算：
  //   cfg.thresholds.looseMinBytes        （属性访问）
  //   const { looseMinBytes } = cfg.thresholds   （解构——上一版只认属性访问，漏掉了这种）
  // 剥离已经挡掉了"只在文档/描述里提到"，所以这里可以按标识符匹配，
  // 不必再假设实现一定写成 `x.key`。
  const re = new RegExp('\\b' + key + '\\b');
  if (!re.test(implText)) dead.push(leaf);
}

const undeclared = dead.filter((d) => declaredPaths.indexOf(d) < 0);
assert(undeclared.length === 0,
  '这些配置项在 DEFAULT_CONFIG 里声明了，但 lib/bin 里没有任何读取点，也没有登记进 lib/config.js 的 UNIMPLEMENTED：' +
  undeclared.join(', ') + '（要么接线，要么删掉，要么显式登记为未实现）');

const stale = declaredPaths.filter((p) => dead.indexOf(p) < 0);
assert(stale.length === 0,
  '这些配置项登记为"未实现"，但代码里其实已经在读了，登记已过期：' + stale.join(', ') +
  '（过期的登记会让门禁变成永久借口）');

for (const u of UNIMPLEMENTED) {
  assert(leaves.indexOf(u.path) >= 0,
    'UNIMPLEMENTED 登记的 ' + u.path + ' 在 DEFAULT_CONFIG 里并不存在');
  assert(u.reason && u.reason.trim().length > 0, 'UNIMPLEMENTED 的 ' + u.path + ' 必须写明原因');
}

// 登记为未实现的配置项，不得被当成已有能力对外承诺。
//
// 判据按"披露位置"分化，因为两类文本的读者与误报风险不同：
//   - MCP 工具描述：**AI 直接读它做决策**，所以用短键名检查，且必须在同一段描述里
//     显式说明未实现。这里是防线重点——v0.7.0 的假承诺就写在这里。
//   - README：用**完整路径**（如 `retention.reports`）检查。因为短键名可能是常见英文词
//     （`reports` 在 README 里就当动词用过："a 0-item clean no longer reports success"），
//     按短名检查会把正常英文句子判成违规。
const DENIAL = /未实现|尚未|不支持|不会有任何效果|UNIMPLEMENTED/;

function assertNotPromisedByPath(where, text) {
  const lines = text.split(/\r?\n/);
  for (const u of UNIMPLEMENTED) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(u.path) < 0) continue;
      assert(DENIAL.test(lines[i]),
        where + ' 第 ' + (i + 1) + ' 行提到了未接线的配置项 "' + u.path + '"，却没有说明它未实现：' +
        lines[i].trim().slice(0, 120) + '（这正是 v0.7.0 把死配置当已实现承诺的复现路径）');
    }
  }
}
assertNotPromisedByPath('README.md', README);
assertNotPromisedByPath('README.zh-CN.md', README_ZH);

// MCP 工具描述逐条检查（AI 的决策输入，防线重点）
for (const t of mcpToolDescs) {
  const desc = String(t.description || '');
  for (const u of UNIMPLEMENTED) {
    const key = u.path.split('.').pop();
    if (desc.indexOf(key) < 0) continue;
    assert(DENIAL.test(desc),
      'MCP 工具 ' + t.name + ' 的描述提到了未接线的配置项 "' + key + '" 却没有说明它未实现。' +
      'AI 会把它读成已有能力（v0.7.0 正是这样承诺了三个死配置）。描述片段：' + desc.slice(0, 160));
  }
}

// ---------------------------------------------------------------- 结果
console.log('PASS docs-consistency: ' + registered.length + ' 个套件全部注册；' +
  toolNames.length + ' 个 MCP 工具、' + segs.length + ' 个受保护段、' +
  documentedCmds.length + ' 个文档命令、' + scriptRefs.size + ' 个脚本引用与实现一致；' +
  leaves.length + ' 个配置项中 ' + dead.length + ' 个已登记为未实现（无静默死配置）');
