// test/rules-integrity.js - 规则表完整性（守住"静默覆盖"这类看不见的缺陷）
//
// 起因：lib/rules.js 的 EXT_CAT 里 `.ts` 同时出现在「媒体」和「代码」两行，
// 后写的静默覆盖先写的 —— 扫描分类结果与源码字面意思不符，而 node --check 不会报，
// 只有 esbuild 打包时才给一条 duplicate-object-key 警告（很容易被当噪音忽略）。
// 本测试从源码文本层面直接检查重复 key，并断言几个歧义扩展名的既定归属。
'use strict';
const fs = require('fs');
const path = require('path');
const rules = require('../lib/rules.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rules.js'), 'utf8');

// ---- 1. 源码级唯一性：每个扩展名 key 在同一处只能出现一次 ----
// 只扫 EXT_CAT 对象字面量的花括号范围，避免误伤 EXT_JUNK / 其它对象。
function blockOf(name) {
  const start = src.indexOf('const ' + name + ' = {');
  if (start < 0) throw new Error('FAIL: 未找到 ' + name + ' 定义');
  let depth = 0, i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(from + 1, i);
}

function keysOf(block) {
  // 匹配 `key:` 或 `'key':`，key 为扩展名样式的标识符（不含引号的裸词或带引号的串）
  const re = /(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_$~]+))\s*:/g;
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) out.push(m[1] || m[2] || m[3]);
  return out;
}

for (const spec of [['EXT_CAT', 100], ['EXT_JUNK', 3]]) {
  const name = spec[0], minKeys = spec[1];
  const keys = keysOf(blockOf(name));
  const seen = new Map();
  const dups = [];
  for (const k of keys) {
    if (seen.has(k)) dups.push(k); else seen.set(k, 1);
  }
  assert(dups.length === 0, name + ' 存在重复 key（后写会静默覆盖先写）：' + dups.join(', '));
  assert(keys.length >= minKeys, name + ' key 数量异常偏少（' + keys.length + ' < ' + minKeys + '），可能解析失败');
}

// ---- 2. 歧义扩展名的既定归属（显式决策，不靠对象字面量顺序） ----
assert(rules.EXT_CAT.ts === '代码', '.ts 应归「代码」（TypeScript 源码；MPEG 传输流请用 .m2ts）');
assert(rules.EXT_CAT.mts === '代码', '.mts 应归「代码」（与 .ts 保持一致）');
assert(rules.EXT_CAT.m2ts === '媒体', '.m2ts 应归「媒体」（无歧义的 MPEG 传输流）');
assert(rules.EXT_CAT.js === '代码' && rules.EXT_CAT.mjs === '代码' && rules.EXT_CAT.cjs === '代码', 'JS 家族归「代码」');

// ---- 3. 关键类别不能因为改动而消失 ----
const cats = new Set(Object.values(rules.EXT_CAT));
for (const c of ['媒体', '图片', '文档', '压缩包', '安装包', '代码', '临时', '系统', '数据库', '虚拟磁盘', '依赖包']) {
  assert(cats.has(c), '缺类别：' + c);
}

// ---- 4. 阈值健全性（规则表是阈值的单一来源，config.js 只是覆盖层） ----
const D = rules.DEFAULTS || {};
assert(typeof D.DUP_MIN_SIZE === 'number' && D.DUP_MIN_SIZE >= 1024, 'DEFAULTS.DUP_MIN_SIZE 有效');
assert(typeof D.STALE_LARGE_MIN === 'number' && D.STALE_LARGE_MIN > D.DUP_MIN_SIZE, 'STALE_LARGE_MIN 应大于 DUP_MIN_SIZE');
assert(typeof D.STALE_MS === 'number' && D.STALE_MS > 0, 'STALE_MS 为正数');
assert(typeof D.LOOSE_MIN === 'number' && D.LOOSE_MIN > 0, 'LOOSE_MIN 为正数');
assert(typeof rules.DUP_FULL_LIMIT === 'number' && rules.DUP_FULL_LIMIT > 0, 'DUP_FULL_LIMIT 为正数');
assert(rules.DUP_HEAD === 64 * 1024 && rules.DUP_TAIL === 64 * 1024, 'DUP_HEAD/DUP_TAIL 均为 64KB');

// 规则表阈值与 config.js 默认值必须一致，否则"扫描用什么阈值"取决于谁先加载
const cfg = require('../lib/config.js');
assert(cfg.DEFAULT_CONFIG.thresholds.dupMinBytes === D.DUP_MIN_SIZE,
  'config.dupMinBytes(' + cfg.DEFAULT_CONFIG.thresholds.dupMinBytes + ') 应等于 rules.DUP_MIN_SIZE(' + D.DUP_MIN_SIZE + ')');
assert(cfg.DEFAULT_CONFIG.thresholds.staleMinBytes === D.STALE_LARGE_MIN,
  'config.staleMinBytes 应等于 rules.STALE_LARGE_MIN');
assert(cfg.DEFAULT_CONFIG.thresholds.looseMinBytes === D.LOOSE_MIN,
  'config.looseMinBytes 应等于 rules.LOOSE_MIN');

// ---- 5. 云同步段常量与 guard.js 保持一致（否则报告与闸门会各说一套） ----
const guard = require('../lib/guard.js');
assert(rules.CLOUD_SYNC_SEG === guard.CLOUD_SYNC_SEG,
  'rules.CLOUD_SYNC_SEG(' + rules.CLOUD_SYNC_SEG + ') 必须等于 guard.CLOUD_SYNC_SEG(' + guard.CLOUD_SYNC_SEG + ')');

console.log('PASS rules-integrity: EXT_CAT ' + Object.keys(rules.EXT_CAT).length + ' 项无重复 key，' +
  cats.size + ' 个类别，阈值与云同步常量一致');
