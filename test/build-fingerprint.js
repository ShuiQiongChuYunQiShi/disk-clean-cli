// test/build-fingerprint.js — 构建指纹注入的真实性验证（S9）
//
// 为什么需要一个"真的打一次包"的测试：
//   指纹机制最容易失败的地方不是"想不想注入"，而是**注入没生效却看不出来**——
//   esbuild 的 --define 键名写错、值被 shell 吃掉引号、构建脚本换了参数名，
//   这些都不会报错，只会让 exe 里少一个字符串。而缺失指纹的产物照样能构建、
//   照样能上传、照样能通过下载回验（哈希是自洽的），只是无法证明它等于源码。
//   所以这里不看脚本里"写没写 --define"，而是**真的执行一次注入、运行产物、读它自己的自述**。
//
// 依赖说明：本套件需要 esbuild（devDependency）。这是全仓库唯一需要构建工具的套件，
// 因此 CI 把 `npm ci` 放在测试之前。若未安装，这里会明确失败而不是跳过——
// 静默 SKIP 会让这条闸门在真正需要它的时候悄悄变成绿的。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const versionLib = require('../lib/version.js');
const fingerprint = require('../scripts/fingerprint.js');

// ---------------------------------------------------------------- 1) 源码形态的兜底
// 未注入时必须安全回落（`typeof 未声明标识符` 是安全的，直接读取会 ReferenceError），
// 而且不能伪装成"有指纹"——源码形态就没有指纹可言。
{
  const info = versionLib.buildInfo();
  assert(info.version === versionLib.VERSION, 'buildInfo.version 应等于 version.js 的 VERSION');
  assert(info.commit === null && info.dirty === null && info.fingerprint === null,
    '未注入时 commit/dirty/fingerprint 都应为 null，实际：' + JSON.stringify(info));
  assert(info.form === 'node', '未注入时 form 应为 node，实际 ' + info.form);
}

// ---------------------------------------------------------------- 2) 真实打包注入
let esbuildAvailable = true;
try { require('esbuild'); } catch (e) { esbuildAvailable = false; }
assert(esbuildAvailable,
  '未安装 esbuild，无法验证构建指纹注入。请先 `npm install`（本套件是唯一需要构建工具的套件，' +
  '因为"注入是否真的生效"只能通过真的打包一次来证明）');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-fp-'));
const expect = fingerprint.sourceExpectation();
assert(expect.commit, '无法取得 HEAD commit（git 不可用？）');

function bundle(name, commit, dirty) {
  const out = path.join(tmpDir, name);
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'build-bundle.js'),
    '--outfile', out,
    '--commit', commit,
    '--dirty', dirty ? 'true' : 'false',
    '--built-at', '2026-01-01T00:00:00Z',
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  assert(r.status === 0,
    'build-bundle.js 失败（exit ' + r.status + '）：' + String(r.stdout || '') + String(r.stderr || ''));
  assert(fs.existsSync(out), 'bundle 未生成：' + out);
  return out;
}

// 2a) 注入值必须原样出现在产物自述里
let goodBundle;
try {
  goodBundle = bundle('good.js', expect.commit, false);
  const info = fingerprint.readArtifactInfo(goodBundle, 'node');
  assert(info.ok, '运行注入后的产物失败：' + info.error);
  assert(info.info.commit === expect.commit,
    '产物自述的 commit(' + info.info.commit + ') != 注入值(' + expect.commit + ')');
  assert(info.info.dirty === false,
    '产物自述的 dirty(' + info.info.dirty + ') != 注入值(false)');
  assert(info.info.version === versionLib.VERSION,
    '产物自述的 version(' + info.info.version + ') != ' + versionLib.VERSION);
  assert(info.info.fingerprint === versionLib.VERSION + '+' + expect.commit,
    'fingerprint 拼装不正确：' + info.info.fingerprint);
  assert(info.info.form === 'sea', '注入后 form 应为 sea（表示"这是一件带指纹的产物"）');

  // 2b) 正向：指纹与当前源码一致的产物应当通过断言。
  //     注意这里**不**传 requireCleanWorktree：套件可能在开发中途运行（工作树本来就脏），
  //     而"产物自述来自干净的树 + commit 等于 HEAD"已经足够证明它等于当前源码。
  const pass = fingerprint.check(goodBundle, { kind: 'node' });
  assert(pass.ok, '对与源码一致的产物，指纹断言应当通过，实际失败于：' +
    JSON.stringify(pass.checks.filter((c) => !c.ok)));

  // 2c) 负向：commit 对不上的产物必须被拒绝
  //     没有这一条，"闸门永远返回通过"这种最危险的故障就无法被发现。
  const staleBundle = bundle('stale.js', 'deadbee', false);
  const failResult = fingerprint.check(staleBundle, { kind: 'node' });
  assert(!failResult.ok, 'commit 与 HEAD 不一致的产物竟然通过了指纹断言（闸门失效）');
  const failedNames = failResult.checks.filter((c) => !c.ok).map((c) => c.name);
  assert(failedNames.indexOf('commit 一致') >= 0,
    '拒绝理由里应包含"commit 一致"，实际失败项：' + failedNames.join(', '));

  // 2d) 负向：脏树构建必须被拒绝（除非显式放行）
  const dirtyBundle = bundle('dirty.js', expect.commit, true);
  assert(!fingerprint.check(dirtyBundle, { kind: 'node' }).ok,
    '脏树构建的产物竟然通过了指纹断言（发布它等于发布仓库里不存在的代码）');
  assert(fingerprint.check(dirtyBundle, { kind: 'node', allowDirty: true }).ok,
    '--allow-dirty 应当放行脏树产物');

  // 2e) 负向：非法 commit 值必须在打包阶段就被拒绝，而不是被注入进产物
  const bad = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'build-bundle.js'), '--outfile', path.join(tmpDir, 'bad.js'),
    '--commit', 'not a hash; DROP', '--dirty', 'false',
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert(bad.status !== 0, '非法 commit 值应当让 build-bundle.js 失败，实际 exit ' + bad.status);

  console.log('PASS build-fingerprint: 注入生效（commit=' + expect.commit +
    '），一致产物通过；commit 过期 / 脏树 / 非法值三类均被拒绝');
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
}
