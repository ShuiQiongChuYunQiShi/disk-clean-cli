'use strict';
// lib/credentials.js — 凭据的单一入口（GH_TOKEN / NPM_TOKEN）
//
// 为什么不能只用环境变量（这不是"图方便"，是实测出来的问题）：
//   Windows 的用户级环境变量只在**进程启动时**被快照进环境块。
//   用 [Environment]::SetEnvironmentVariable(name, value, 'User') 写进注册表之后，
//   已经运行的进程（例如一个常驻的编辑器 / agent 会话）不会更新，
//   由它 spawn 出来的子进程也读不到。实测确认：设完之后，同一个会话里 spawn 的
//   `node scripts/dev.js doctor` 仍然报 GH_TOKEN 未设置——因为进程环境里真的没有。
//   于是反复出现"我明明设过了，脚本还说没有"，而唯一的解释（要重启宿主进程）
//   没人知道。文件回退把这个问题彻底消掉。
//
// 两处来源，优先级明确：
//   1) 进程环境变量（CI、临时覆盖、新开的终端）——环境变量是**每进程**的，最贴近调用方意图；
//   2) ~/.disk-clean/credentials.json（本机持久；只在用户目录，永不入库）。
//
// 值永不回显：describe() 只回答"有没有、来自哪里、多长"，供 doctor 之类的地方显示状态。
// 本模块不输出、不记录、不写日志任何凭据内容。
const fs = require('fs');
const path = require('path');
const os = require('os');

const KEYS = ['GH_TOKEN', 'NPM_TOKEN'];

function dskDir() { return path.join(os.homedir(), '.disk-clean'); }
function credentialsFile() { return path.join(dskDir(), 'credentials.json'); }

function readFile() {
  let raw;
  try {
    raw = fs.readFileSync(credentialsFile(), 'utf8');
  } catch (e) {
    return {};   // 文件不存在是正常状态，不是错误
  }
  try {
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const o = JSON.parse(raw);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) {
    // 文件存在但解析不了：如实报错，而不是假装"没设凭据"——
    // 那会让人去反复设置一个其实已经写坏的文件。
    return { __parseError: e && e.message ? e.message : String(e) };
  }
}

// 解析单个凭据：返回 { value, source }，未找到时两者皆为空
function resolve(name) {
  const env = process.env[name];
  if (env && String(env).trim()) return { value: String(env).trim(), source: 'env' };
  const file = readFile();
  if (file.__parseError) return { value: null, source: null, fileError: file.__parseError };
  const v = file[name];
  if (v && String(v).trim()) return { value: String(v).trim(), source: 'file' };
  return { value: null, source: null };
}

function ghToken() { return resolve('GH_TOKEN') }
function npmToken() { return resolve('NPM_TOKEN') }

// 状态描述（不含值）
function describe() {
  const out = { file: credentialsFile(), fileExists: fs.existsSync(credentialsFile()), keys: {} };
  for (const name of KEYS) {
    const r = resolve(name);
    out.keys[name] = {
      present: !!r.value,
      source: r.source,                       // 'env' | 'file' | null
      length: r.value ? r.value.length : 0,
    };
    if (r.fileError) out.fileError = r.fileError;
  }
  return out;
}

// 写入/更新凭据文件；只覆盖传入的键，其余保持不动。
function save(values) {
  const src = values || {};
  const incoming = {};
  for (const k of KEYS) {
    if (src[k] && String(src[k]).trim()) incoming[k] = String(src[k]).trim();
  }
  if (!Object.keys(incoming).length) return { ok: false, error: '没有可写入的凭据（键名应为 ' + KEYS.join(' / ') + '）' };
  try {
    fs.mkdirSync(dskDir(), { recursive: true });
    const cur = readFile();
    delete cur.__parseError;
    for (const k of Object.keys(incoming)) cur[k] = incoming[k];
    const file = credentialsFile();
    // mode 在 Windows 上基本不起作用，写上无害；真正的保护来自文件位于用户目录
    fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch (e) { /* Windows 上忽略 */ }
    return { ok: true, file: file, keys: Object.keys(incoming) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// 从当前进程能看到的 User 级环境变量导入（换 token 时的常用路径）
function importFromUserEnv() {
  const { execFileSync } = require('child_process');
  const found = {};
  for (const name of KEYS) {
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        '[Console]::Out.Write([Environment]::GetEnvironmentVariable(\'' + name + '\',\'User\'))'
      ], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
      if (out) found[name] = out;
    } catch (e) { /* 取不到就跳过 */ }
  }
  if (!Object.keys(found).length) {
    return { ok: false, error: 'User 级环境变量里没有 ' + KEYS.join(' / ') + '（先设置，或在支持环境变量的终端里运行）' };
  }
  return save(found);
}

module.exports = { ghToken, npmToken, resolve, describe, save, importFromUserEnv, credentialsFile, KEYS };
