'use strict';
// lib/version.js — 版本单一事实源（评审 P2-4）。
//
// 背景：此前版本号散落在 6 处（bin/disk-clean.js、lib/serve.js、package.json、
// gui/shell/*.csproj、installer/*.iss、gui/web/index.html），只有 scripts/bump-version.js
// 一条脚本串起来，漏改就会漂移。这里把 VERSION 定为唯一可写事实源：
//   - 需要版本号的代码一律 require('./version.js').VERSION
//   - scripts/bump-version.js 负责改这里的 VERSION 并同步其它派生产物
//   - verify() 供测试/发布前校验所有派生源是否一致
// 注意：SEA 单文件环境不能依赖外部 package.json，所以 VERSION 必须是字面量常量。
const fs = require('fs');
const path = require('path');

const VERSION = '0.7.2';

const ROOT = path.resolve(__dirname, '..');

// 派生源清单：{ 名称: [相对路径, 正则(首个捕获组为版本号)] }
// 只列“必须写出字面量版本号”的产物；纯代码引用 version.js 的文件见 REFERENCES。
const SOURCES = {
  'lib/version.js': ['lib/version.js', /const VERSION = '([^']+)'/],
  'package.json': ['package.json', /"version"\s*:\s*"([^"]+)"/],
  // package-lock.json 有两个版本字段，且长期没人管：
  // 从 v0.2.0 到 v0.5.0 它一直停在 0.1.0（bump 脚本没碰它，npm ci 也不校验版本字段，
  // 所以三个版本都没人发现）。归入派生源后由 verify() 与 bump 脚本一并守住。
  'package-lock.json (root)': ['package-lock.json', /^\s{2}"version"\s*:\s*"([^"]+)"/m],
  'package-lock.json (packages[""])': ['package-lock.json', /"packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?"version"\s*:\s*"([^"]+)"/],
  'gui/shell/DiskCleanUi.csproj': ['gui/shell/DiskCleanUi.csproj', /<Version>([^<]+)<\/Version>/],
  'installer/disk-clean-ui.iss': ['installer/disk-clean-ui.iss', /#define\s+MyAppVersion\s+"([^"]+)"/],
  'gui/web/index.html': ['gui/web/index.html', /id="verLabel"[^>]*>v?([0-9][^<\s]*)/],
};

// 这些文件不得再写死版本号，只能用 require(...version.js).VERSION
const REFERENCES = {
  'bin/disk-clean.js': ['bin/disk-clean.js', /require\('\.\.\/lib\/version\.js'\)\.VERSION/],
  'lib/serve.js': ['lib/serve.js', /require\('\.\/version\.js'\)\.VERSION/],
};

// ---------- 构建指纹（S9：制品可验证） ----------
//
// 起因：v0.5.0 的 Release 里 checksums.txt 描述的是一个**已经不存在的构建**
// （G53），而"这次发布的 exe 到底是从哪个 commit 打出来的"从来无从得知——
// 只比版本号的话，"先构建、再改代码、然后发布"这种错误完全隐形。
//
// 做法：SEA 打包时由 scripts/build-sea.ps1 用 esbuild --define 注入三个常量，
//       exe 内部因此自带"我是谁、从哪个 commit 来、源码是否干净"。
// 为什么用 --define 而不是生成一个文件：生成物会引入"生成物是否已同步"的第四种
//       状态（本仓库已经在版本号上吃过这个亏），而 define 只影响那一次打包，
//       仓库里不留任何生成物，`node` 直跑（开发/测试/npm 包）也不受影响。
//
// 注意 typeof 的写法：未注入时必须回落到 dev 占位；直接读未声明的标识符会
// ReferenceError。esbuild --define 会把 __BUILD_COMMIT__ 整体替换为字面量，
// 于是 `typeof <字面量>` 在两种形态下都成立且都安全。
const BUILD = readBuildInfo();

function readBuildInfo() {
  const commit = (typeof __BUILD_COMMIT__ !== 'undefined') ? __BUILD_COMMIT__ : null;
  if (!commit) return { commit: null, dirty: null, builtAt: null, fingerprint: null };
  const dirty = (typeof __BUILD_DIRTY__ !== 'undefined') ? !!__BUILD_DIRTY__ : null;
  const builtAt = (typeof __BUILD_AT__ !== 'undefined') ? __BUILD_AT__ : null;
  return {
    commit: commit,
    dirty: dirty,
    builtAt: builtAt,
    fingerprint: VERSION + '+' + commit + (dirty ? '-dirty' : ''),
  };
}

function readSource(name) {
  const spec = SOURCES[name];
  if (!spec) return { name: name, ok: false, error: '未知版本源' };
  const file = path.join(ROOT, spec[0]);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { name: name, file: file, ok: false, error: '无法读取：' + (e && e.message ? e.message : String(e)) };
  }
  const m = spec[1].exec(raw);
  if (!m) return { name: name, file: file, ok: false, error: '未匹配到版本号' };
  return { name: name, file: file, ok: true, version: m[1].trim() };
}

// 汇总所有派生源的版本；mismatches 为与 VERSION 不一致者
function verify() {
  const out = [];
  const mismatches = [];
  for (const name of Object.keys(SOURCES)) {
    const r = readSource(name);
    out.push(r);
    if (!r.ok || r.version !== VERSION) mismatches.push(r);
  }
  // 引用型文件：必须引用 version.js，且不得残留字面量 const VER = 'x.y.z'
  for (const name of Object.keys(REFERENCES)) {
    const spec = REFERENCES[name];
    const file = path.join(ROOT, spec[0]);
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8') } catch (e) { raw = '' }
    const hasRef = spec[1].test(raw);
    const literal = /const VER = '[0-9]/.exec(raw);
    const ok = hasRef && !literal;
    const r = {
      name: name, file: file, ok: ok,
      version: hasRef ? VERSION : null,
      error: ok ? null : (literal ? '仍写死版本号：' + literal[0] : '未引用 lib/version.js'),
    };
    out.push(r);
    if (!ok) mismatches.push(r);
  }
  return { ok: mismatches.length === 0, version: VERSION, sources: out, mismatches: mismatches };
}

// 构建信息的机器可读形式（`disk-clean build-info` 用；发布脚本据此断言制品 == 源码）
function buildInfo() {
  return {
    version: VERSION,
    commit: BUILD.commit,
    dirty: BUILD.dirty,
    builtAt: BUILD.builtAt,
    fingerprint: BUILD.fingerprint,
    // sea = 单文件 exe（构建指纹应存在）；node = 源码/开发形态（指纹本就该是 null）
    form: BUILD.commit ? 'sea' : 'node',
  };
}

module.exports = { VERSION, BUILD, buildInfo, SOURCES, REFERENCES, verify, readSource };
