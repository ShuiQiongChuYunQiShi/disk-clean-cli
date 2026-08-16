// lib/schedule.js — 定时任务（Windows Task Scheduler / schtasks）
// 安全默认：schedule run 只做 scan + 报告归档，绝不执行破坏性操作（clean 需显式配置）。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function schedDir() { return path.join(os.homedir(), '.disk-clean', 'schedule'); }
function reportsDir() { return path.join(os.homedir(), '.disk-clean', 'reports'); }
function taskFile(name) { return path.join(schedDir(), name + '.json'); }

function readJson(p) {
  try {
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function writeJson(p, v) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

function validName(name) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name || '');
}
function validTime(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
}
function validDay(d) {
  return ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf((d || '').toUpperCase()) >= 0;
}

// schtasks 输出按系统代码页（中文系统为 GBK）；先严格 UTF-8，失败回退 GBK
function decodeOut(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) {
    try { return new TextDecoder('gbk').decode(buf); } catch (e2) { return buf.toString('latin1'); }
  }
}

function schtasks(args) {
  try {
    const r = spawnSync('schtasks.exe', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true });
    return { ok: r.status === 0, out: decodeOut(r.stdout || Buffer.alloc(0)), err: decodeOut(r.stderr || Buffer.alloc(0)) };
  } catch (e) {
    return { ok: false, out: '', err: e && e.message ? e.message : String(e) };
  }
}

// 标准 CSV 行解析（处理引号包裹），schtasks /fo csv 输出用
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// 任务触发命令：`cmd /c ""<exe>" "<entry>" schedule run <name>"`（整体引号包裹，符合 cmd /c 剥离规则）
function taskCommand(name, isSea) {
  const exe = process.execPath;
  const entry = isSea ? process.execPath : path.join(__dirname, '..', 'bin', 'disk-clean.js');
  const args = isSea ? ['schedule', 'run', name] : [entry, 'schedule', 'run', name];
  const inner = '"' + exe + '" ' + args.map(function(a) { return '"' + a + '"' }).join(' ');
  return 'cmd /c "' + inner + '"';
}

// ---------- add ----------
// opts: { name, when: once|daily|weekly, day, time, roots:[], config, clean }
function add(opts, isSea) {
  const name = opts && opts.name;
  if (!validName(name)) return { ok: false, error: '任务名仅允许字母/数字/-/_（1-64 字符）' };
  if (!validTime(opts.time)) return { ok: false, error: '时间格式错误（HH:MM，如 03:00）' };
  const when = opts.when || 'daily';
  if (['once', 'daily', 'weekly'].indexOf(when) < 0) return { ok: false, error: 'when 仅支持 once|daily|weekly' };
  if (when === 'weekly' && !validDay(opts.day)) return { ok: false, error: 'weekly 需要 --day MON..SUN' };
  if (!Array.isArray(opts.roots) || opts.roots.length === 0) return { ok: false, error: '缺少 --roots 扫描根' };
  if (opts.clean) return { ok: false, error: '定时任务不支持破坏性操作（clean 被禁用）——安全默认只做扫描+报告' };

  const cfg = {
    name: name, when: when, day: (opts.day || '').toUpperCase(), time: opts.time,
    roots: opts.roots, config: opts.config || null, clean: false,
    createdAt: new Date().toISOString()
  };
  if (!writeJson(taskFile(name), cfg)) return { ok: false, error: '无法写入任务配置' };

  const sc = [];
  const taskName = 'disk-clean-' + name;
  const tr = taskCommand(name, isSea);
  if (when === 'once') sc.push('/sc', 'ONCE', '/st', cfg.time);
  else if (when === 'daily') sc.push('/sc', 'DAILY', '/st', cfg.time);
  else sc.push('/sc', 'WEEKLY', '/d', cfg.day, '/st', cfg.time);
  const args = ['/create', '/tn', taskName, '/tr', tr, '/f'].concat(sc);
  const r = schtasks(args);
  if (!r.ok) {
    return { ok: false, error: 'schtasks 注册失败: ' + (r.err || r.out || '未知错误').trim().slice(0, 300) };
  }
  return { ok: true, taskName: taskName, cfg: cfg, note: '已注册定时任务 ' + taskName + '（' + when + (when === 'weekly' ? ' ' + cfg.day : '') + ' ' + cfg.time + '），运行命令: disk-clean schedule run ' + name };
}

// ---------- run ----------
// 由任务触发：读配置 → scan → 报告归档到 ~/.disk-clean/reports/<ts>-<name>.*
async function run(name, engineRun) {
  if (!validName(name)) return { ok: false, error: '任务名非法' };
  const cfg = readJson(taskFile(name));
  if (!cfg) return { ok: false, error: '任务配置不存在: ' + name };
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(reportsDir(), { recursive: true });
  const base = path.join(reportsDir(), ts + '-' + name);
  const reportFile = base + '.json';
  const argv = ['--roots', cfg.roots.join(';'), '--suggest', '--report', reportFile];
  if (cfg.config) argv.push('--config', cfg.config);
  try {
    const res = await engineRun(argv);
    if (!res || res.exitCode !== 0) {
      return { ok: false, error: (res && res.error) || '扫描失败', exitCode: res && res.exitCode };
    }
    return { ok: true, reportFile: reportFile, mdFile: reportFile.replace(/\.json$/i, '') + '.md', summary: res.data && res.data.summary };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ---------- list ----------
function list() {
  const out = [];
  try {
    const files = fs.readdirSync(schedDir());
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const cfg = readJson(path.join(schedDir(), f));
      if (cfg) out.push(cfg);
    }
  } catch (e) { /* 无配置目录 */ }
  // 查询 schtasks 状态
  const r = schtasks(['/query', '/fo', 'csv', '/nh']);
  const registered = {};
  if (r.ok) {
    for (const line of r.out.split('\n')) {
      const f = parseCsvLine(line);
      if (f.length >= 3 && f[0]) {
        const tn = f[0].trim().replace(/^\\+/, '');
        if (tn.indexOf('disk-clean-') === 0) {
          registered[tn] = { status: (f[2] || '').trim(), next: (f[1] || '').trim() };
        }
      }
    }
  }
  return out.map(function(cfg) {
    const t = registered['disk-clean-' + cfg.name];
    return { name: cfg.name, when: cfg.when, day: cfg.day, time: cfg.time, roots: cfg.roots, status: t ? t.status : '未注册', nextRun: t ? t.next : null };
  });
}

// ---------- remove ----------
function remove(name, isSea) {
  if (!validName(name)) return { ok: false, error: '任务名非法' };
  const taskName = 'disk-clean-' + name;
  const r = schtasks(['/delete', '/tn', taskName, '/f']);
  try { fs.unlinkSync(taskFile(name)); } catch (e) { /* 忽略 */ }
  if (!r.ok) {
    // 任务可能已不存在，但配置已删——视为成功
    return { ok: true, taskName: taskName, note: '配置已删除（schtasks 删除返回: ' + (r.err || r.out || '').trim().slice(0, 100) + '）' };
  }
  return { ok: true, taskName: taskName, note: '已删除任务 ' + taskName + ' 及配置' };
}

module.exports = { add, run, list, remove, validName, schedDir, reportsDir, taskFile };
