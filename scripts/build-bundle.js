// scripts/build-bundle.js — SEA 打包第 1 步：esbuild 打包 + 构建指纹注入（S9）
//
// 为什么把这一步从 .ps1 挪进 Node：
//   1) esbuild 的 --define 值必须是 JSON 字面量（要带引号）。PowerShell 5.1 向原生
//      程序传含引号的参数有已知的转义陷阱，一旦被吃掉就会**静默**注入成裸标识符，
//      而 esbuild 只在打包时报一句话，产物看似正常。这里改为普通参数（纯十六进制、
//      true/false、ISO 时间），由 Node 侧 JSON.stringify，不经过任何 shell 引号规则。
//   2) 注入逻辑一旦是纯 JS，就能被测试直接调用（test/build-fingerprint.js 真的打一次包
//      并运行产物），而不是只断言"脚本里写了 --define"。
//
// 用法：node scripts/build-bundle.js --outfile dist/sea-bundle.js \
//         --commit a966ff6 --dirty false --built-at 2026-01-01T00:00:00Z
'use strict';
const fs = require('fs');
const path = require('path');

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1] !== undefined) ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(__dirname, '..');
const outfile = path.resolve(ROOT, argOf('outfile', path.join('dist', 'sea-bundle.js')));
const commit = argOf('commit', '');
const dirty = String(argOf('dirty', 'false')).toLowerCase() === 'true';
const builtAt = argOf('built-at', '');

// commit 由 git 短哈希或 "unknown" 组成；出现别的字符说明调用方传错了参数，
// 与其把奇怪的值注入进制品，不如在这里就失败。
if (commit && !/^[0-9a-f]{4,40}$|^unknown$/.test(commit)) {
  console.error('build-bundle: 非法 commit 值 "' + commit + '"（应为 git 短哈希或 unknown）');
  process.exit(2);
}

const define = {};
if (commit) {
  define.__BUILD_COMMIT__ = JSON.stringify(commit);
  define.__BUILD_DIRTY__ = dirty ? 'true' : 'false';
  define.__BUILD_AT__ = JSON.stringify(builtAt || new Date().toISOString());
}

fs.mkdirSync(path.dirname(outfile), { recursive: true });

let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  console.error('build-bundle: 未安装 esbuild，请先 npm install');
  process.exit(2);
}

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'bin', 'disk-clean.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outfile,
  define: define,
  logLevel: 'warning',
});

// 自证：注入是否真的落进了产物。缺了这一步，flag 名写错也只会在发布后才暴露。
if (commit) {
  const text = fs.readFileSync(outfile, 'utf8');
  if (text.indexOf(JSON.stringify(commit)) < 0) {
    console.error('build-bundle: 指纹未出现在产物中（commit=' + commit + '）');
    process.exit(3);
  }
}

console.log('bundle: ' + path.relative(ROOT, outfile) +
  (commit ? '  fingerprint=' + commit + (dirty ? '-dirty' : '') : '  fingerprint=(none)'));
