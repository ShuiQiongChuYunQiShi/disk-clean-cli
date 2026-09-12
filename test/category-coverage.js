// test/category-coverage.js — 分类覆盖率基线（T6）
//
// 要防的是什么：
//   "文件分类"是这个工具的头部卖点。但在真实磁盘上，它一度给出**「其他」76.6%**
//   ——最大的一类叫"未分类"。原因是真实盘被游戏资产（.pak 一个就 296.88 GB）和
//   AI 模型权重（.safetensors）占满，而规则表是按"通用办公文件"的思路写的。
//   也就是说：在最需要它给答案的场景里，这个功能什么也没说。
//
// 为什么要有基线而不是只修一次：
//   补规则很容易，但没有任何东西阻止它**慢慢退化**回去——删掉一条规则、
//   或新增一类文件而忘了补规则，都不会报错。所以这里把**一份真实的占用样本**
//   固化成断言：改动规则表导致"其他"占比上升，测试立刻失败。
//
// 样本来源：真实 D 盘扫描（windowsClear/D盘扫描分析报告.md，588.32 GB）的扩展名 Top30。
//   它是固定数据，不随运行环境变化，因此可以直接断言占比。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
const fmt = (n) => n.toFixed(2) + ' GB';

const { catOf, EXT_CAT } = require('../lib/rules.js');

// ---------------------------------------------------------------- 真实样本
const REAL_DISK_TOTAL_GB = 588.32;
const TOP30 = [
  ['pak', 296.88], ['safetensors', 41.87], ['dll', 32.28], ['', 31.87], ['zip', 18.30],
  ['bin', 18.05], ['mp4', 17.74], ['exe', 17.68], ['jar', 13.85], ['dat', 13.55],
  ['pgf', 6.00], ['lib', 5.84], ['ts', 5.68], ['db', 5.27], ['enc', 4.39], ['dsv', 4.00],
  ['ckpt', 3.97], ['7z', 3.72], ['pack', 3.07], ['pdf', 2.72], ['js', 2.68], ['msi', 2.48],
  ['cab', 2.23], ['jpg', 2.08], ['apk', 1.97], ['png', 1.73], ['hprof', 1.61], ['py', 1.20],
  ['pyc', 1.14], ['pyd', 1.09],
];

// ---------------------------------------------------------------- 1) 覆盖率
{
  const byCat = {};
  let classified = 0;
  for (const pair of TOP30) {
    // 传空 segs（不假设它们位于哪个目录）——这是**保守**算法：
    // 真实盘上 .safetensors 多在 models/ 下、.pak 多在游戏目录下，靠语境还能再降一截。
    const cat = catOf(pair[0], []);
    byCat[cat] = (byCat[cat] || 0) + pair[1];
    if (cat !== '其他') classified += pair[1];
  }
  // Top30 之外的尾部（总计与 Top30 之差）一律算作未分类，不粉饰
  const other = REAL_DISK_TOTAL_GB - classified;
  const share = other / REAL_DISK_TOTAL_GB;

  assert(share < 0.15,
    '「其他」在真实样本上占 ' + (share * 100).toFixed(1) + '%（' + fmt(other) + '），超过 15% 的基线。' +
    '规则表是否被改坏？' + JSON.stringify(byCat));

  // 目标（PRODUCT-REVIEW v9-1）是 < 30%；基线取 15% 是因为样本固定，
  // 留出的余量只够容纳"合理微调"，装不下"丢了一整类"。
  assert(share < 0.30, '未达到 PRODUCT-REVIEW 的 v9-1 目标（其他 < 30%）');

  // 各大类必须真的落在预期位置——只看占比会被"把什么都塞进某一类"骗过去
  assert(byCat['游戏资产'] > 290, '游戏资产应包含 .pak 那 296.88 GB，实际 ' + fmt(byCat['游戏资产'] || 0));
  assert(byCat['AI 模型'] > 40, 'AI 模型应包含 .safetensors 41.87 GB + .ckpt 3.97 GB，实际 ' + fmt(byCat['AI 模型'] || 0));
  assert(byCat['无扩展名'] > 30, '无扩展名应单独成一类（真实盘 31.87 GB，排第 4），实际 ' + fmt(byCat['无扩展名'] || 0));
  assert(byCat['开发产物'] > 9, '开发产物应包含 lib/hprof/pyc/pyd ≈ 9.68 GB，实际 ' + fmt(byCat['开发产物'] || 0));
  assert(byCat['移动安装包'] > 1.9, '移动安装包应包含 .apk 1.97 GB，实际 ' + fmt(byCat['移动安装包'] || 0));

  // 诚实性断言：这几个扩展名**确实**无法从扩展名本身判断用途
  // （同一台机器上 .bin 可能是模型权重、固件或任意数据；.dat/.pgf/.enc/.dsv 同理）。
  // 它们必须留在「其他」并出现在报告的"未分类 Top"里，而不是被硬塞一个分类
  // 去把指标做好看——那只是把"其他"改个名字，仍然没有信息量。
  for (const ext of ['bin', 'dat', 'pgf', 'enc', 'dsv']) {
    assert(catOf(ext, []) === '其他',
      '.' + ext + ' 在没有目录语境时必须诚实归为「其他」（它的用途无法从扩展名判断）');
  }
  console.log('  覆盖率：其他 ' + (share * 100).toFixed(1) + '%（' + fmt(other) + '/' + REAL_DISK_TOTAL_GB + ' GB）');
}

// ---------------------------------------------------------------- 2) 目录语境补判
{
  const cases = [
    // 游戏：扩展名直接判定
    [['pak', ['wegameapps', 'rail_apps', 'deltaforce', 'content', 'paks']], '游戏资产'],
    // AI 模型：扩展名直接判定
    [['safetensors', ['backup', 'documents', 'comfyui', 'models']], 'AI 模型'],
    // 用途未知的扩展名，靠目录语境补判（这是 T6 相对旧实现的关键改进）
    [['bin', ['backup', 'documents', 'comfyui', 'models', 'diffusion_models']], 'AI 模型'],
    [['bin', ['work', 'tool']], '其他'],
    [['xyz-unknown-ext', ['wegameapps', 'rail_apps']], '游戏'],
    // 无扩展名单独成类
    [['', ['backup', 'xwechat_files']], '无扩展名'],
    // 既有行为不能被打乱
    [['mp4', ['users', 'videos']], '媒体'],
    [['dll', ['windows', 'system32']], '系统'],
  ];
  for (const pair of cases) {
    const got = catOf(pair[0][0], pair[0][1]);
    assert(got === pair[1],
      'catOf(' + JSON.stringify(pair[0][0]) + ', ' + JSON.stringify(pair[0][1]) + ') = ' + got + '，期望 ' + pair[1]);
  }
  // 旧 API 的行为必须保持：classifyDir 未命中时返回 '其他'（不是 null）
  const rules = require('../lib/rules.js');
  assert(rules.dirCat(['nothing-matches-here']) === null, 'dirCat 未命中应返回 null，便于调用方区分');
}

// ---------------------------------------------------------------- 3) 端到端：报告必须含"未分类 Top"
{
  // 扫描树**不能**放在 %TEMP% 下：`temp` 是一条目录规则，于是未分类扩展名会先按语境
  // 被判成「临时/缓存」，看不到"未分类"。这也说明两级的顺序是对的——扩展名优先、
  // 目录语境兜底——但也提醒：断言要放在不受语境干扰的位置，否则测的不是想测的东西。
  // 用仓库内的 test/tree/（.gitignore 已忽略），路径段不含任何目录规则关键词。
  const tree = path.join(ROOT, 'test', 'tree', 'cat-coverage');
  try {
    fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 });
    const scanRoot = path.join(tree, 'scanme');
    fs.mkdirSync(scanRoot, { recursive: true });
    // 一个已分类的大文件 + 一个未分类的大文件：报告里应只出现后者
    fs.writeFileSync(path.join(scanRoot, 'movie.mp4'), Buffer.alloc(300 * 1024, 0x41));
    fs.writeFileSync(path.join(scanRoot, 'blob.unknownext99'), Buffer.alloc(200 * 1024, 0x42));
    const reportPath = path.join(tree, 'r.json');

    // 语言必须**显式**指定。这一条是 CI 教我加的：CI 跑在 en-US 系统上，
    // buildMarkdown 自动检测后生成英文标题（"Uncategorized by size"），
    // 而本地是中文系统 → 同一个断言两边结果不同。
    // 也就是说这条测试原本依赖了外部环境（与 PLAYBOOK 第 43 条同类），
    // 而"只在 CI 上失败的测试"正是这种依赖的典型表现。语言钉死后两边一致。
    const scan = (lang, file) => {
      execFileSync(process.execPath,
        [path.join(ROOT, 'bin', 'disk-clean.js'), 'scan', scanRoot, '--report', file, '--lang', lang],
        { encoding: 'utf8', windowsHide: true, timeout: 180000 });
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };

    const rep = scan('zh', reportPath);
    assert(Array.isArray(rep.uncategorizedTop), '报告必须含 uncategorizedTop 字段（v9-2）');
    const exts = rep.uncategorizedTop.map((u) => u.ext);
    assert(exts.indexOf('unknownext99') >= 0,
      '未分类的扩展名必须出现在 uncategorizedTop 里，实际：' + JSON.stringify(rep.uncategorizedTop));
    assert(exts.indexOf('mp4') < 0, '已分类的扩展名不应出现在未分类清单里');

    const md = fs.readFileSync(reportPath.replace(/\.json$/i, '') + '.md', 'utf8');
    assert(md.indexOf('未分类占用 Top') >= 0, 'Markdown 报告（zh）必须含"未分类占用 Top"段落');
    assert(md.indexOf('unknownext99') >= 0, 'Markdown 的未分类段落应列出该扩展名');

    // 英文侧同样要存在——否则"加了段落"只对中文成立，英文报告仍会把缺口藏起来
    const enPath = path.join(tree, 'en.json');
    const repEn = scan('en', enPath);
    assert(repEn.uncategorizedTop.some((u) => u.ext === 'unknownext99'),
      'uncategorizedTop 与语言无关，英文报告也应含该扩展名');
    const mdEn = fs.readFileSync(enPath.replace(/\.json$/i, '') + '.md', 'utf8');
    assert(mdEn.indexOf('Uncategorized by size') >= 0, 'Markdown 报告（en）也必须含未分类段落');
  } finally {
    try { fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- 4) 规则表自身的一致性
{
  // 一条扩展名不能同时属于两个分类（表是对象，重复键会被静默吞掉——正是这种
  // "写了两遍、只有后者生效"最容易让人误以为规则已生效）
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'rules.js'), 'utf8');
  const block = /const EXT_CAT = \{([\s\S]*?)\n\};/.exec(src);
  assert(block, '找不到 EXT_CAT 定义');
  const seen = {};
  const dup = [];
  for (const m of block[1].matchAll(/'?([a-z0-9_]+)'?\s*:\s*'/g)) {
    if (seen[m[1]]) dup.push(m[1]);
    seen[m[1]] = true;
  }
  assert(dup.length === 0, 'EXT_CAT 里有重复键（后者会静默覆盖前者）：' + dup.join(', '));

  // 分类名不能是"其他"以外的兜底词混进表里（那会让覆盖率的计算失去意义）
  for (const key of Object.keys(EXT_CAT)) {
    assert(EXT_CAT[key] !== '其他', 'EXT_CAT 不应显式把扩展名映射到「其他」，直接不写即可');
  }
}

console.log('PASS category-coverage: 真实样本覆盖率、目录语境补判、"未分类 Top"端到端、规则表自洽 均通过');
