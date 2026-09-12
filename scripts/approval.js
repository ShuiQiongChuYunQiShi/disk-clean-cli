// scripts/approval.js — 发布审批门禁（S4：唯一一处脚本级硬拦）
//
// ============================ 这个门禁到底防什么 ============================
// 必须说清楚，否则就是制造假安全感（参考项目的失效插件正是这个反面教材）。
//
// 它**能**防住：
//   - 顺手发布 / 默认发布：没有审批文件，publish-release.ps1 直接 exit 1。
//   - 橡皮图章：没有 --yes、没有 --force、没有 --skip-approval 这类开关。
//   - 审批之后产物被换掉：审批把**每个产物的 sha256** 一并封存，重新构建后哈希变了，
//     门禁就拒绝——"人看过的那份"和"要发出去的那份"必须是同一份字节。
//   - 陈旧审批：默认 30 分钟时效，过期即失效（并打印实际过了多久）。
//   - 版本错配：只接受与本次发布版本**完全相同**的字符串。
//     不接受 all / manual / 通配（参考项目正是把 "manual" 写进审批，导致复用永远不匹配）。
//   - 审批文件损坏：JSON 解析失败即失败，绝不"读不出来就当没限制"。
//
// 它**不能**防住：
//   - 一个能在本机任意写文件的代理：它可以写这份审批文件，也可以直接改这个脚本。
//     任何"本机文件 + 本机程序"的门禁都拦不住它——这是本机方案的原理性上限。
//     要真正的边界，只能让发布凭据（GH_TOKEN / NPM_TOKEN）不出现在该代理可达的环境里。
//
// 所以本门禁的定位是：**把发布从"默认动作"变成"一个刻意、留痕、与具体字节绑定的动作"**。
// 定位写在这里、也写在 docs/RELEASE-PLAYBOOK.md，两处必须一致。
// ==========================================================================
//
// 用法：
//   node scripts/approval.js request [--version <v>]              打印待批准内容 + 批准命令
//   node scripts/approval.js confirm [--version <v>] [--by <who>] 人：交互确认并落盘
//   node scripts/approval.js check   [--version <v>] [--ttl <min>] 门禁：退出码 0/1
//   node scripts/approval.js list                                 列出审批文件与是否仍有效
//   node scripts/approval.js revoke  --version <v>                撤销
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifest = require('./manifest.js');
const fp = require('./fingerprint.js');
const versionLib = require('../lib/version.js');

// 审批文件目录。DSK_APPROVAL_DIR 只用于测试隔离——让测试可以验证门禁行为
// 而不往真实的 ~/.disk-clean/approvals 里写垃圾（仓库已经因为"测试写真实主目录"
// 挨过一次批评，见 docs/PRODUCT-REVIEW.md 的 T1）。
const APPROVAL_DIR = process.env.DSK_APPROVAL_DIR ||
  path.join(os.homedir(), '.disk-clean', 'approvals');

// 显式拒绝的"看起来能绕过门禁"的参数：宁可报错，也不要让人以为存在旁路
const FORBIDDEN_FLAGS = ['--yes', '-y', '--force', '-f', '--skip-approval', '--no-approval', '--override'];

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1] !== undefined) ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.indexOf('--' + name) >= 0;

function fail(msg, hint) {
  console.error('\u2717 ' + msg);
  if (hint) console.error('  \u2192 ' + hint);
  return 1;
}

function approvalFile(version) {
  return path.join(APPROVAL_DIR, 'release-' + version + '.json');
}

// 待批准内容：把"要发的到底是哪几个字节"算清楚
function buildPayload(version) {
  const primary = manifest.primaryAssets(version);
  const artifacts = {};
  const missing = [];
  for (const a of primary) {
    if (!fs.existsSync(a.path)) { missing.push(a); continue; }
    const st = fs.statSync(a.path);
    artifacts[a.name] = { sha256: fp.sha256File(a.path), size: st.size, role: a.role };
  }
  return { version: version, artifacts: artifacts, missing: missing, primary: primary };
}

function nowIso() { return new Date().toISOString(); }

// ---------------------------------------------------------------- request
function cmdRequest(version) {
  const p = buildPayload(version);
  if (p.missing.length) {
    return fail('产物缺失，没有可批准的内容：' + p.missing.map((a) => a.name).join(', '),
      '先构建：' + p.missing.map((a) => a.producer).join(' , '));
  }
  const payload = {
    kind: 'release',
    version: version,
    artifacts: p.artifacts,
    confirmedBy: '<填写批准人>',
    confirmedAt: '<批准时间，ISO8601>',
    note: '',
  };
  console.log('待批准的发布内容（批准 = 认可下面这些**具体字节**被发布）：');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');
  console.log('批准方式（需要人来做，脚本不代劳）：');
  console.log('  node scripts/approval.js confirm --version ' + version + ' --by "你的名字"');
  console.log('');
  console.log('审批有效期 ' + manifest.approvalTtlMinutes() + ' 分钟；产物在批准后再被改动，门禁会拒绝。');
  return 0;
}

// ---------------------------------------------------------------- confirm
// 交互确认：要求人手动输入版本号。不用 --yes，也不接受管道喂进来的空内容当确认。
function cmdConfirm(version) {
  const p = buildPayload(version);
  if (p.missing.length) {
    return fail('产物缺失，不能批准：' + p.missing.map((a) => a.name).join(', '),
      '先构建：' + p.missing.map((a) => a.producer).join(' , '));
  }
  const by = argOf('by', '');
  console.log('即将批准 v' + version + ' 的以下产物：');
  for (const name of Object.keys(p.artifacts)) {
    const a = p.artifacts[name];
    console.log('  ' + name + '  sha256=' + a.sha256.slice(0, 16) + '...  size=' + a.size);
  }
  if (!by) {
    return fail('缺少 --by <批准人>', '例如：--by "张三"；审批文件要记录是谁批准的');
  }
  // 必须由人键入完整版本号；这一输入无法被"顺手回车"糊弄过去
  process.stdout.write('请输入版本号 ' + version + ' 以确认（其他任何输入都会取消）: ');
  let typed = '';
  try {
    const buf = Buffer.alloc(256);
    const n = fs.readSync(0, buf, 0, buf.length, null);
    typed = buf.subarray(0, n).toString('utf8').replace(/[\r\n]+$/, '').trim();
  } catch (e) {
    typed = '';
  }
  if (typed !== version) {
    return fail('确认输入不匹配（收到 "' + typed + '"），已取消，未写入审批文件', '重新运行 confirm 并完整输入版本号');
  }

  const payload = {
    kind: 'release',
    version: version,
    artifacts: p.artifacts,
    confirmedBy: by,
    confirmedAt: nowIso(),
    note: argOf('note', ''),
  };
  fs.mkdirSync(APPROVAL_DIR, { recursive: true });
  const file = approvalFile(version);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('\u2713 已批准：' + file);
  console.log('  有效期 ' + manifest.approvalTtlMinutes() + ' 分钟（可在 disk-clean.config.json 调整）');
  return 0;
}

// ---------------------------------------------------------------- check
// 判定逻辑与 IO 分开，是为了能被穷举测试：`validateDoc` 不碰文件系统，
// 产物哈希、文件存在性、当前时间都由调用方注入。于是 test/approval-gate.js 可以
// 在**没有真实产物、也不碰真实审批目录**的前提下，逐条验证"什么该放行、什么该拦"。
// 门禁这种东西如果只能靠手工点一次来确认，它对将来的改动就没有约束力。
//
// 返回 { ok, reason, detail, hint } —— 所有分支都必须给出显式结论，
// 绝不允许"读不出来就放行"（参考项目曾因 catch 后未置失败位而假绿）。
function validateDoc(doc, o) {
  const artifactHash = o.hashOf;      // (path) -> sha256 hex
  const fileExists = o.exists;        // (path) -> bool
  const now = o.now;                  // ms

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, reason: '审批文件结构非法', detail: '顶层应为对象' };
  }
  if (doc.kind !== 'release') {
    return { ok: false, reason: 'kind 不匹配', detail: 'kind=' + JSON.stringify(doc.kind) + '，应为 "release"' };
  }
  // 精确匹配，不接受 all / manual / 通配。参考项目的教训：它的交互式批准把
  // 版本写成 "manual"，导致这份审批永远不可能与真实版本匹配——门禁形同虚设。
  if (doc.version !== o.version) {
    return { ok: false, reason: '审批版本不匹配',
      detail: '审批 ' + JSON.stringify(doc.version) + ' != 本次 ' + JSON.stringify(o.version),
      hint: '审批绑定的是精确版本号，不支持通配/all/manual；请为本版本重新批准' };
  }
  if (!doc.confirmedBy || typeof doc.confirmedBy !== 'string' || !doc.confirmedBy.trim()) {
    return { ok: false, reason: '审批文件没有记录批准人', detail: 'confirmedBy 为空' };
  }
  const at = Date.parse(doc.confirmedAt);
  if (!isFinite(at)) {
    return { ok: false, reason: '批准时间非法', detail: 'confirmedAt=' + JSON.stringify(doc.confirmedAt) };
  }
  const ageMin = (now - at) / 60000;
  if (ageMin < -2) {
    return { ok: false, reason: '批准时间在未来', detail: 'confirmedAt=' + doc.confirmedAt };
  }
  if (ageMin > o.ttlMinutes) {
    return { ok: false, reason: '审批已过期',
      detail: Math.round(ageMin) + ' 分钟前批准，超过 ' + o.ttlMinutes + ' 分钟',
      hint: '重新批准：node scripts/approval.js confirm --version ' + o.version + ' --by "<名字>"' };
  }
  if (!doc.artifacts || typeof doc.artifacts !== 'object' || Array.isArray(doc.artifacts) ||
      Object.keys(doc.artifacts).length === 0) {
    return { ok: false, reason: '审批没有绑定任何产物', detail: 'artifacts 为空' };
  }

  // 逐件核对：批准的是"这些字节"，不是"这个版本号"
  const declared = {};
  for (const a of o.primary) declared[a.name] = a;
  for (const name of Object.keys(doc.artifacts)) {
    if (!declared[name]) {
      return { ok: false, reason: '审批里有清单外的产物', detail: name,
        hint: '清单（disk-clean.config.json）与审批内容不一致，请重新批准' };
    }
  }
  for (const a of o.primary) {
    const entry = doc.artifacts[a.name];
    if (!entry) {
      return { ok: false, reason: '审批漏了产物', detail: a.name + ' 未被批准',
        hint: '重新批准：node scripts/approval.js confirm --version ' + o.version + ' --by "<名字>"' };
    }
    if (!fileExists(a.path)) {
      return { ok: false, reason: '产物缺失', detail: a.path, hint: '先构建：' + a.producer };
    }
    const actual = artifactHash(a.path);
    if (entry.sha256 !== actual) {
      return { ok: false, reason: '产物在批准后被改动',
        detail: a.name + '\n      批准时: ' + entry.sha256 + '\n      现在  : ' + actual,
        hint: '审批封存的是字节哈希，重新构建后必须重新批准（这正是本门禁的价值所在）' };
    }
  }
  return { ok: true, ageMinutes: Math.round(ageMin), by: doc.confirmedBy,
    artifacts: Object.keys(doc.artifacts).length };
}

// IO 包装：读文件、解析、注入真实哈希
function validate(version, ttlMinutes) {
  const file = approvalFile(version);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: '没有审批文件',
      detail: file + ' 不存在',
      hint: '由人批准：node scripts/approval.js confirm --version ' + version + ' --by "<名字>"' };
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, reason: '审批文件不可读', detail: (e && e.message) || String(e) };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    // 绝不 catch 后静默放行：解析失败就是失败
    return { ok: false, reason: '审批文件不是合法 JSON', detail: (e && e.message) || String(e),
      hint: '删掉它重新批准：' + file };
  }
  return validateDoc(doc, {
    version: version,
    ttlMinutes: ttlMinutes,
    primary: manifest.primaryAssets(version),
    hashOf: fp.sha256File,
    exists: fs.existsSync,
    now: Date.now(),
  });
}

function cmdCheck(version, ttlMinutes) {
  const r = validate(version, ttlMinutes);
  if (r.ok) {
    console.log('\u2713 发布审批有效：v' + version + ' by ' + r.by +
      '（' + r.ageMinutes + ' 分钟前，' + r.artifacts + ' 件产物哈希一致）');
    return 0;
  }
  console.error('\u2717 发布被拦截：' + r.reason);
  if (r.detail) console.error('    ' + r.detail);
  if (r.hint) console.error('    \u2192 ' + r.hint);
  return 1;
}

// ---------------------------------------------------------------- list / revoke
function cmdList() {
  if (!fs.existsSync(APPROVAL_DIR)) {
    console.log('（还没有任何审批记录：' + APPROVAL_DIR + '）');
    return 0;
  }
  const files = fs.readdirSync(APPROVAL_DIR).filter((f) => /^release-.*\.json$/.test(f)).sort();
  if (!files.length) { console.log('（审批目录为空）'); return 0; }
  const ttl = manifest.approvalTtlMinutes();
  let live = 0;
  for (const f of files) {
    const version = f.replace(/^release-/, '').replace(/\.json$/, '');
    const r = validate(version, ttl);
    if (r.ok) live++;
    console.log('  ' + (r.ok ? '\u2713' : '\u2717') + ' v' + version.padEnd(10) +
      (r.ok ? '有效（' + r.ageMinutes + ' 分钟前 by ' + r.by + '）' : r.reason));
  }
  console.log('  共 ' + files.length + ' 份，有效 ' + live + ' 份，TTL ' + ttl + ' 分钟');
  return 0;
}

function cmdRevoke(version) {
  const file = approvalFile(version);
  if (!fs.existsSync(file)) return fail('没有可撤销的审批：' + file);
  fs.unlinkSync(file);
  console.log('\u2713 已撤销审批：' + file);
  return 0;
}

// ---------------------------------------------------------------- main
function main() {
  const argv = process.argv.slice(2);
  for (const bad of FORBIDDEN_FLAGS) {
    if (argv.indexOf(bad) >= 0) {
      return fail('参数 ' + bad + ' 不能用于审批：审批必须由人显式完成，任何 --yes 类开关都不代替它',
        '由人执行：node scripts/approval.js confirm --version <v> --by "<名字>"');
    }
  }
  const cmd = argv[0];
  const version = argOf('version', versionLib.VERSION);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return fail('版本号非法：' + version, '形如 0.7.1');
  }
  // 审批对象必须就是源码当前版本。否则会出现"批准了 0.7.2、却按 0.7.1 发出去"
  // 这类错配——版本号是单一事实源（lib/version.js），门禁不认第二份事实。
  if ((cmd === 'check' || cmd === 'confirm') && version !== versionLib.VERSION) {
    return fail('审批版本与源码版本不一致：' + version + ' vs lib/version.js ' + versionLib.VERSION,
      '先 bump 版本：node scripts/bump-version.js ' + versionLib.VERSION + ' ' + version + '，再批准');
  }
  const ttl = Number(argOf('ttl', manifest.approvalTtlMinutes())) || manifest.approvalTtlMinutes();

  switch (cmd) {
    case 'request': return cmdRequest(version);
    case 'confirm': return cmdConfirm(version);
    case 'check': return cmdCheck(version, ttl);
    case 'list': return cmdList();
    case 'revoke': return cmdRevoke(version);
    default:
      console.log([
        'disk-clean 发布审批门禁（S4）',
        '',
        '用法: node scripts/approval.js <command> [--version <x.y.z>]',
        '',
        '命令:',
        '  request   打印待批准内容（含每个产物的 sha256）与批准命令',
        '  confirm   人：交互输入版本号确认，写入 ~/.disk-clean/approvals/release-<v>.json',
        '  check    门禁：审批有效则退出 0，否则退出 1（publish-release.ps1 调用它）',
        '  list      列出全部审批记录与是否仍有效',
        '  revoke    删除某版本的审批记录',
        '',
        '审批绑定"版本号 + 每个产物的 sha256"，默认 30 分钟有效。',
        '没有 --yes / --force / --skip-approval：这些参数会被直接拒绝。',
        '能力边界见本文件头部注释与 docs/RELEASE-PLAYBOOK.md。',
      ].join('\n'));
      return cmd ? 1 : 0;
  }
}

module.exports = { validate, validateDoc, buildPayload, approvalFile, APPROVAL_DIR };
if (require.main === module) process.exit(main());
