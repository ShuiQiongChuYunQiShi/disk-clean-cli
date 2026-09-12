// scripts/manifest.js — 项目清单的唯一读取入口（S3：声明式清单）
//
// 为什么要有这个文件：
//   此前"这次要发布什么"只存在于 publish-release.ps1 的局部变量、README 的表格、
//   和人的记忆里。实测同一批字面量在仓库里重复出现：disk-clean-win-x64 x29、
//   disk-clean-setup x17、disk-clean-cli x9、owner x5。任何一处改了、别处没改，
//   产物与文档就开始不一致——这正是 G53（checksums.txt 描述了另一个 exe）的成因。
//
// 本模块只做三件事：读清单、解析 ${version} 占位符、列出发布资产。
// 不放进 lib/：这是研发/发布工具，既不进 npm 包也不进 SEA exe（与 scripts/dev.js 同理）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'disk-clean.config.json');

let cache = null;

function raw() {
  if (cache) return cache;
  const text = fs.readFileSync(FILE, 'utf8');
  cache = JSON.parse(text); // 解析失败必须抛出：清单坏了就不能继续发布
  return cache;
}

// 把 ${version} 替换为给定版本；未提供版本时保留占位符（便于文档/断言使用）
function expand(value, version) {
  const v = version || require('../lib/version.js').VERSION;
  return String(value).split('${version}').join(v);
}

function identity(version) {
  const m = raw();
  return {
    product: m.product,
    repo: m.repo,
    branch: m.branch,
    npmPackage: m.npmPackage,
    version: version || require('../lib/version.js').VERSION,
  };
}

// 发布资产清单：name（远端文件名）/ path（本地绝对路径）/ role / producer / fingerprinted
function assets(version) {
  const m = raw();
  const list = (m.release && m.release.assets) || [];
  return list.map(function (a) {
    return {
      name: expand(a.name, version),
      path: path.join(ROOT, expand(a.path, version)),
      relativePath: expand(a.path, version),
      role: a.role,
      producer: a.producer,
      fingerprinted: !!a.fingerprinted,
    };
  });
}

function docs(version) {
  const m = raw();
  const out = {};
  for (const k of Object.keys(m.docs || {})) out[k] = expand(m.docs[k], version);
  return out;
}

function approvalTtlMinutes() {
  const m = raw();
  return (m.release && m.release.approvedByTtlMinutes) || 30;
}

// 只有真实产物（引擎/安装器）需要存在；校验和文件由发布脚本生成
function primaryAssets(version) {
  return assets(version).filter(function (a) { return a.role !== 'checksum'; });
}

module.exports = { ROOT, FILE, raw, expand, identity, assets, primaryAssets, docs, approvalTtlMinutes };
