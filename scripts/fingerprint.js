// scripts/fingerprint.js — 断言"制品 == 源码"（S9：制品指纹断言）
//
// 解决的具体事故形态：
//   G53 —— v0.5.0 的 Release 里 checksums.txt 描述的是另一个构建的哈希。
//   更隐蔽的一种：先 build，再改代码，然后 publish。版本号完全一致、哈希自洽、
//   下载回验通过，但发布出去的 exe 里**没有最后那次修改**。
//   构建指纹（exe 内嵌 commit）是唯一能自动识别这种情况的证据。
//
// 用法：
//   node scripts/fingerprint.js show                     显示"源码侧应该是什么"
//   node scripts/fingerprint.js check [--exe <path>] [--allow-dirty] [--json]
//   node scripts/fingerprint.js check-node <bundle.js>   对 Node 产物做同样断言（测试用）
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const versionLib = require('../lib/version.js');

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1] !== undefined) ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.indexOf('--' + name) >= 0;

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? String(r.stdout || '').trim() : null;
}

// 源码侧期望值：版本来自唯一事实源，commit/脏树来自 git
function sourceExpectation() {
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const porcelain = git(['status', '--porcelain']);
  return {
    version: versionLib.VERSION,
    commit: commit,
    dirty: porcelain === null ? null : porcelain.length > 0,
  };
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// 读一件产物的自述：SEA exe 直接调用，Node bundle 用当前 node 执行
function readArtifactInfo(file, kind) {
  const exe = kind === 'node' ? process.execPath : file;
  const args = kind === 'node' ? [file, 'build-info'] : ['build-info'];
  const r = spawnSync(exe, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const out = String(r.stdout || '').trim();
  if (r.status !== 0) {
    return { ok: false, error: '执行 build-info 失败（exit ' + r.status + '）：' + out + String(r.stderr || '').trim() };
  }
  try {
    return { ok: true, info: JSON.parse(out) };
  } catch (e) {
    // 绝不吞掉异常：解析失败就是断言失败（参考项目曾因 catch 后未置失败位而假绿）
    return { ok: false, error: 'build-info 输出不是合法 JSON：' + out.slice(0, 200) };
  }
}

// 核心断言：产物自述必须与源码期望一致。返回 { ok, checks:[{name, ok, detail}] }
function check(file, opts) {
  const o = opts || {};
  const expect = sourceExpectation();
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  if (!fs.existsSync(file)) {
    add('产物存在', false, '找不到 ' + file + '（先跑 ' + (o.producer || 'scripts/build-sea.ps1') + '）');
    return { ok: false, checks, expect, info: null };
  }
  add('产物存在', true, path.relative(ROOT, file) + '  ' + (fs.statSync(file).size / 1048576).toFixed(1) + ' MB');

  const got = readArtifactInfo(file, o.kind);
  if (!got.ok) {
    add('可读取 build-info', false, got.error);
    return { ok: false, checks, expect, info: null };
  }
  add('可读取 build-info', true, JSON.stringify(got.info));
  const info = got.info;

  add('版本一致', info.version === expect.version,
    info.version + (info.version === expect.version ? ' == ' + expect.version : ' != 源码 ' + expect.version));

  if (!info.commit) {
    add('带构建指纹', false,
      '产物没有 commit 指纹：说明它不是由 scripts/build-sea.ps1 打包的（旧脚本或手搓产物）。' +
      '发布这种产物无法证明它等于当前源码。');
  } else {
    add('带构建指纹', true, 'commit=' + info.commit);
    add('commit 一致', info.commit === expect.commit,
      info.commit + (info.commit === expect.commit ? ' == HEAD' : ' != HEAD ' + expect.commit +
        ' —— 产物是在另一次提交上构建的，请重新构建'));
    const dirtyOk = o.allowDirty || info.dirty === false;
    add('构建时源码树干净', dirtyOk,
      info.dirty === false ? 'clean' :
        '产物由脏树构建（有未提交改动）：发布它等于发布一段仓库里不存在的代码' +
        (o.allowDirty ? '（--allow-dirty 已放行）' : '；提交后重新构建'));
    // 语义边界（这里比错过一次，值得写清楚）：上面断言的是**产物自述**的构建状态，
    // 不是"当前工作树此刻干净"——产物打完后再开下一版开发并不使旧产物失效。
    // "当前工作树是否已全部提交"是另一件事，只有调用方显式要求时才判定（发布脚本会传）。
    if (o.requireCleanWorktree) {
      add('当前工作树已提交', expect.dirty === false,
        expect.dirty === false ? 'clean' : '有未提交改动（发布时不允许：tag 指向的提交不含这些改动）');
    }
  }

  return { ok: checks.every((c) => c.ok), checks, expect, info };
}

function printChecks(res) {
  for (const c of res.checks) {
    console.log('  ' + (c.ok ? '\u2713' : '\u2717') + ' ' + c.name.padEnd(16) + c.detail);
  }
}

// ---------------------------------------------------------------- main
function main() {
  const cmd = process.argv[2];

  if (cmd === 'show') {
    const e = sourceExpectation();
    console.log(JSON.stringify(e, null, 2));
    return 0;
  }

  if (cmd === 'check' || cmd === 'check-node') {
    let file = argOf('exe', null);
    let kind = 'exe';
    if (cmd === 'check-node') {
      file = process.argv[3];
      kind = 'node';
    }
    if (!file) {
      const manifest = require('./manifest.js');
      const engine = manifest.primaryAssets().filter((a) => a.role === 'engine')[0];
      if (!engine) { console.error('清单里没有声明 engine 产物'); return 1; }
      file = engine.path;
    }
    const res = check(file, { kind: kind, allowDirty: hasFlag('allow-dirty'),
      requireCleanWorktree: hasFlag('require-clean-worktree'),
      producer: (require('./manifest.js').primaryAssets().filter((a) => a.role === 'engine')[0] || {}).producer });
    if (hasFlag('json')) {
      console.log(JSON.stringify({ ok: res.ok, file: file, expect: res.expect, info: res.info, checks: res.checks }, null, 2));
    } else {
      console.log('制品指纹断言: ' + path.relative(ROOT, file));
      printChecks(res);
      console.log(res.ok ? '  => 制品与源码一致' : '  => 断言失败');
    }
    return res.ok ? 0 : 1;
  }

  console.log([
    'disk-clean 制品指纹断言（S9）',
    '',
    '用法: node scripts/fingerprint.js <command>',
    '',
    '命令:',
    '  show                         显示源码侧期望（版本 / HEAD commit / 是否脏树）',
    '  check [--exe <path>]         断言引擎 exe 的内嵌指纹 == 当前源码',
    '        [--allow-dirty]        放行"构建时树是脏的"（默认拒绝）',
    '        [--require-clean-worktree]  同时要求当前工作树已全部提交（发布时用）',
    '        [--json]               机器可读输出',
    '  check-node <bundle.js>       对 Node 产物做同样断言（构建链自测用）',
    '',
    '指纹由 scripts/build-bundle.js 在打包时注入（见 lib/version.js 的 BUILD）。',
  ].join('\n'));
  return cmd ? 1 : 0;
}

module.exports = { check, sourceExpectation, sha256File, readArtifactInfo };
if (require.main === module) process.exit(main());
