'use strict';
// lib/serve.js — GUI 引擎的 HTTP 服务层（disk-clean serve --port <p> --token <t> --web <dir>）
// 复用现有 8 工具逻辑（零重写），仅包一层 JSON API + 静态前端托管。
// 安全：仅绑定 127.0.0.1；除 /api/health 外全部要求 Authorization: Bearer <token>。
// 扫描子进程复用 CLI 的 --internal-scan 机制（SEA 自我调用），进度经临时文件轮询。
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const audit = require('./audit.js');
const guard = require('./guard.js');
const organize = require('./organize.js');
const clean = require('./clean.js');
const configLib = require('./config.js');
const recyclebin = require('./recyclebin.js');
const scheduleLib = require('./schedule.js');
const mftLib = require('./mftscan.js');
const healthLib = require('./health.js');
const dedupLib = require('./dedup.js');
const quotaLib = require('./quota.js');
const restoreLib = require('./restore.js');
const { buildMarkdown } = require('./engine.js');
const { fmtBytes } = require('./organize.js');

const VER = require('./version.js').VERSION;
const MAX_JOBS = 20;

// ---------- 工具 ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function ok(res, obj) { send(res, 200, Object.assign({ ok: true }, obj)); }
function bad(res, error, code) { send(res, code || 400, { ok: false, error: String(error) }); }

function readBody(req, maxBytes) {
  return new Promise(function(resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function(c) {
      size += c.length;
      if (size > (maxBytes || 2 * 1024 * 1024)) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function() {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

let IS_SEA = false;
try { IS_SEA = !!(require('node:sea') && require('node:sea').isSea()); } catch (e) { IS_SEA = false; }

// 盘符容量：单一事实源在 lib/drives.js（v0.7.0 v7-9）。
// 此前这里与 lib/mcp/tools.js 各算一遍 statfsSync。
function listDrives() { return require('./drives.js').list() }

// ---------- 扫描任务（后台子进程 + 进度轮询） ----------
const jobs = new Map();

function spawnScanJob(body) {
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const roots = Array.isArray(body.roots) && body.roots.length ? body.roots : listDrives().map(function(d) { return d.drive });
  const reportPath = body.report || audit.reportFile();
  const progressPath = path.join(os.tmpdir(), 'dsk-gui-progress-' + id + '.json');
  const argv = ['--roots', roots.join(';'), '--suggest', '--report', reportPath, '--progress', progressPath];
  if (Array.isArray(body.exclude) && body.exclude.length) argv.push('--exclude', body.exclude.join(';'));
  if (body.lang) argv.push('--lang', body.lang);
  const self = IS_SEA ? ['--internal-scan'] : [process.argv[1], '--internal-scan'];
  let proc = null;
  try {
    proc = spawn(process.execPath, self.concat(argv), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { error: '无法启动扫描进程: ' + e.message };
  }
  const job = {
    id: id,
    proc: proc,
    roots: roots,
    reportPath: reportPath,
    progressPath: progressPath,
    stderr: '',
    done: false,
    error: null,
    startedAt: new Date().toISOString()
  };
  proc.stderr.on('data', function(d) { job.stderr += d.toString('utf8'); });
  proc.on('error', function(e) {
    job.done = true; job.error = '扫描进程启动失败: ' + e.message;
  });
  proc.on('close', function(code) {
    // 给进度文件一点落盘时间
    setTimeout(function() {
      job.done = true;
      if (code !== 0) {
        job.error = job.stderr.trim() || ('扫描失败 (exit ' + code + ')');
        try {
          const lastLine = job.stderr.trim().split('\n').pop();
          if (lastLine && lastLine.startsWith('\n')) { const j = JSON.parse(lastLine.trim()); if (j && j.error) job.error = j.error; }
        } catch (e) { /* ignore */ }
      }
    }, 200);
  });
  // 报告 markdown 也生成
  proc.on('close', function() {
    setTimeout(function() {
      try {
        const rep = audit.readJson(job.reportPath);
        if (rep) {
          const lang = body.lang || 'zh';
          const md = buildMarkdown(rep, rep.elapsedMs || 0, lang);
          fs.writeFileSync(audit.mdFile(), md, 'utf8');
        }
      } catch (e) { /* md 失败不阻断 */ }
    }, 300);
  });
  jobs.set(id, job);
  // 防止无限增长：超限时删除最旧的已完成任务并清掉进度文件
  if (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    const oldJob = jobs.get(oldest);
    jobs.delete(oldest);
    if (oldJob) { try { fs.unlinkSync(oldJob.progressPath || ''); } catch (e) { /* ignore */ } }
  }
  return { jobId: id, roots: roots };
}

function readProgress(job) {
  try {
    const raw = fs.readFileSync(job.progressPath, 'utf8');
    const p = JSON.parse(raw);
    return p;
  } catch (e) { return null; }
}

// ---------- 从报告自动提取清理候选（与 CLI cmdClean 逻辑一致） ----------
// 评审 A3：此前这里自留一份 7 段 SYS_RE 正则；现统一走 guard（16 段 + 尾部匹配 + OneDrive）
const TEMP_RE = /(\\temp\\|\\tmp\\|\\cache\\|\\prefetch\\|\\thumbcache\\|\\iconcache\\|(^|[\\/])(temp|tmp|cache|prefetch|thumbcache|iconcache)([\\/]|$))/i;
function safeOnly(list) { return (list || []).filter(function(p) { return guard.isProtectedPath(String(p).toLowerCase()) === false }) }
function extractCleanPaths(type, rep) {
  const sugg = rep.suggestions || [];
  if (type === 'duplicates') {
    const paths = [];
    for (const s of sugg) if (s.type === 'duplicates') for (const g of (s.groups || [])) paths.push.apply(paths, safeOnly(g.removable || []));
    return paths;
  }
  if (type === 'empty-dirs') {
    return safeOnly((rep.emptyDirSample || []).slice(0, 200));
  }
  if (type === 'junk-temp') {
    // v0.3.2+ 引擎在建议里附带真实路径样本，优先使用
    for (const s of sugg) if (s.type === 'junk-temp' && Array.isArray(s.paths) && s.paths.length > 0) {
      return safeOnly(s.paths).slice(0, 300);
    }
    return safeOnly((rep.emptyDirSample || []).filter(function(p) { return TEMP_RE.test(String(p)) })).slice(0, 200);
  }
  if (type === 'stale-large') {
    const paths = [];
    for (const s of sugg) if (s.type === 'stale-large') for (const it of (s.items || [])) paths.push(it.path);
    return safeOnly(paths);
  }
  return [];
}

// ---------- 各 API 实现 ----------
const healthCache = { ts: 0, result: null };

async function handleApi(pathname, body, res, qs) {
  // GET /api/health
  if (pathname === '/api/health') return ok(res, { version: VER, service: 'disk-clean' });

  // GET /api/drives
  if (pathname === '/api/drives') return ok(res, { drives: listDrives() });

  // POST /api/scan → 启动后台扫描
  if (pathname === '/api/scan' && body && typeof body === 'object') {
    const r = spawnScanJob(body);
    if (r.error) return bad(res, r.error);
    return ok(res, r);
  }

  // GET /api/scan/status?job=<id>
  if (pathname === '/api/scan/status') {
    const id = qs && qs.get('job');
    const job = jobs.get(id);
    if (!job) return bad(res, '未知扫描任务: ' + id, 404);
    const p = readProgress(job);
    if (!job.done) return ok(res, { done: false, progress: p || null, startedAt: job.startedAt });
    const rep = audit.readJson(job.reportPath);
    return ok(res, {
      done: true,
      error: job.error,
      report: rep || null,
      progress: p || null,
      startedAt: job.startedAt
    });
  }

  // POST /api/scan/cancel {job} — 中断扫描子进程（SIGTERM → engine 置 cancelled，报告 status=cancelled）
  if (pathname === '/api/scan/cancel' && body && typeof body === 'object') {
    const job = jobs.get(body.job);
    if (!job) return bad(res, '未知扫描任务: ' + body.job, 404);
    if (job.done) return ok(res, { cancelled: false, note: '任务已完成' });
    try { job.proc.kill(); } catch (e) { return bad(res, e.message); }
    return ok(res, { cancelled: true });
  }

  // GET /api/report — 最近一次报告
  if (pathname === '/api/report') {
    const rep = audit.readJson(audit.reportFile());
    if (!rep) return bad(res, '尚无扫描报告（请先运行一次扫描）', 404);
    return ok(res, { report: rep });
  }

  // POST /api/clean {type, paths, dryRun} — dryRun 默认 true；true 时为预览
  if (pathname === '/api/clean' && body && typeof body === 'object') {
    const type = body.type;
    const rep = audit.readJson(audit.reportFile());
    if (!rep) return bad(res, '未找到扫描报告（请先运行 scan）');
    // GUI 一键清理传空 paths 时，从最近报告自动提取候选（与 CLI 提取逻辑一致）
    let paths = Array.isArray(body.paths) ? body.paths : [];
    if (paths.length === 0 && type !== 'recycle-bin') {
      paths = extractCleanPaths(type, rep);
      if (type !== 'duplicates' && paths.length === 0) {
        return bad(res, '未从报告中提取到 ' + type + ' 候选路径，请先扫描或显式传入路径');
      }
    }
    const v = clean.validate(type, paths, rep);
    if (!v.ok) return bad(res, v.error);
    const dryRun = body.dryRun !== false; // 默认预览
    if (body.restorePoint && !dryRun) {
      const rp = restoreLib.create('disk-clean GUI clean ' + type);
      if (!rp.ok) return bad(res, '还原点创建失败: ' + rp.message);
    }
    const r = await clean.execute(type, v.paths, rep, dryRun);
    if (!r.ok) return bad(res, r.error);
    return ok(res, { dryRun: !!r.dryRun, note: r.note, result: r });
  }

  // POST /api/organize {cmd: plan|apply|rollback, ...}
  if (pathname === '/api/organize' && body && typeof body === 'object') {
    const cmd = body.cmd;
    if (cmd === 'plan') {
      const r = await organize.plan({ includeProgram: !!body.includeProgram, reportFile: audit.reportFile() });
      if (!r.ok) return bad(res, r.error);
      audit.writeJson(audit.planFile(), r.items);
      return ok(res, { items: r.items, note: r.note });
    }
    if (cmd === 'apply') {
      const items = Array.isArray(body.items) && body.items.length ? body.items : audit.readJson(audit.planFile());
      if (!Array.isArray(items) || items.length === 0) return bad(res, '缺少整理计划（先运行 organize plan）');
      const rep = audit.readJson(audit.reportFile());
      const roots = rep && Array.isArray(rep.summary.roots) ? rep.summary.roots : [];
      const dryRun = body.dryRun !== false;
      if (body.restorePoint && !dryRun) {
        const rp = restoreLib.create('disk-clean GUI organize apply');
        if (!rp.ok) return bad(res, '还原点创建失败: ' + rp.message);
      }
      const r = await organize.apply(items, { roots: roots, dryRun: dryRun });
      if (!r.ok) return bad(res, r.error);
      return ok(res, { dryRun: !!r.dryRun, note: r.note, failed: r.failed || [] });
    }
    if (cmd === 'rollback') {
      const dryRun = body.dryRun !== false;
      const r = await organize.rollback({ dryRun: dryRun });
      if (!r.ok) return bad(res, r.error);
      return ok(res, { dryRun: !!r.dryRun, note: r.note, failed: r.failed || [] });
    }
    return bad(res, 'organize cmd: plan | apply | rollback');
  }

  // GET /api/audit
  if (pathname === '/api/audit') return ok(res, { entries: audit.readAudit() });

  // GET /api/health-check（SMART/SSD；服务端缓存 TTL 30s，?force=1 绕过）
  if (pathname === '/api/health-check') {
    const force = qs.get('force') === '1';
    if (!force && healthCache.result && (Date.now() - healthCache.ts) < 30 * 1000) {
      return ok(res, healthCache.result);
    }
    const r = healthLib.check();
    if (!r.ok) return bad(res, r.error);
    healthCache.result = { disks: r.disks, trend: r.trend || null, file: r.file };
    healthCache.ts = Date.now();
    return ok(res, healthCache.result);
  }

  // POST /api/mftscan {drive}
  if (pathname === '/api/mftscan' && body && typeof body === 'object') {
    const drive = /^[a-zA-Z]:/.test(body.drive || '') ? body.drive : 'D:';
    const d = /^([a-zA-Z]):/.exec(drive);
    if (!d) return bad(res, '无效盘符: ' + drive);
    const t0 = Date.now();
    const r = mftLib.scan(d[1] + ':');
    if (!r.ok) return bad(res, r.error + '（需要管理员权限且为 NTFS 卷）');
    return ok(res, { summary: r.summary, category: r.category, topDirs: r.topDirs, elapsedMs: Date.now() - t0 });
  }

  // POST /api/dedup {roots, minBytes, hardlink, dryRun, rollback}
  if (pathname === '/api/dedup' && body && typeof body === 'object') {
    if (body.rollback) {
      // 统一读单一 map（评审 A6）：旧实现只读 map.merged，读不到 MCP 侧写的 entries
      const map = dedupLib.readDedupMap();
      const entries = map.entries.filter(function(e) { return e && e.victim && fs.existsSync(e.victim); });
      if (!entries.length) return bad(res, '没有可回滚的硬链接记录');
      const rr = dedupLib.rollbackHardlinks(entries);
      let restored = 0, failed = 0;
      const failedPaths = {};
      for (const x of rr) { if (x.action === 'restored') restored++; else { failed++; failedPaths[String(x.path).toLowerCase()] = true; } }
      const remain = map.entries.filter(function(e) { return failedPaths[String(e.victim).toLowerCase()]; });
      if (remain.length) dedupLib.writeDedupMap(remain);
      else { try { fs.unlinkSync(audit.dedupMapFile()); } catch (e) { /* ignore */ } }
      return ok(res, { restored: restored, failed: failed });
    }
    // roots 缺省时复用最近一次主页扫描的范围（报告 summary.roots），绝不静默回退全盘；
    // 无报告则要求调用方显式传入（避免对用户未看过的盘执行哈希/硬链接操作）。
    let roots = Array.isArray(body.roots) && body.roots.length ? body.roots : null;
    if (!roots) {
      const rep = audit.readJson(audit.reportFile());
      const rp = rep && Array.isArray(rep.summary.roots) ? rep.summary.roots : [];
      if (rp.length) roots = rp;
    }
    if (!roots || roots.length === 0) return bad(res, '未指定扫描范围：请先执行主页扫描或显式传入 roots');
    const r = await dedupLib.scan(roots, { minBytes: body.minBytes || undefined });
    if (!r.ok) return bad(res, r.error || '去重扫描失败');
    if (!body.hardlink) return ok(res, { groups: r.groups, scannedFiles: r.scannedFiles, totalDupBytes: r.totalDupBytes, totalSaveBytes: r.totalSaveBytes, elapsedMs: r.elapsedMs });
    // 硬链接合并（默认预览，dryRun true 时仅统计）
    const dryRun = body.dryRun !== false;
    let mergedN = 0, failN = 0, refusedN = 0;
    const merged = [];
    for (const g of r.groups) {
      const rr = dedupLib.hardlinkGroup(g, dryRun);
      for (const x of rr) {
        if (x.action === 'hardlink' || x.action === 'hardlink(预览)') { mergedN++; if (!dryRun) merged.push(x.to); }
        else if (x.action === 'refused') refusedN++;
        else if (x.action === 'fail') failN++;
      }
    }
    if (!dryRun && merged.length > 0) {
      // 统一 map schema（评审 A6）：一律写 entries，与 MCP 侧一致，旧 merged 仅兼容读
      dedupLib.appendDedupEntries(merged.map(function (p) { return { victim: p, keep: null, size: 0 } }));
    }
    return ok(res, { dryRun: dryRun, hardlinked: mergedN, failed: failN, refusedApprox: refusedN, totalSaveBytes: r.totalSaveBytes });
  }

  // POST /api/quota {drive}
  if (pathname === '/api/quota' && body && typeof body === 'object') {
    const drive = /^[a-zA-Z]:/.test(body.drive || '') ? body.drive : 'C:';
    const r = quotaLib.analyze(drive);
    if (!r.ok) return bad(res, r.error + '（需要管理员权限且为 NTFS 卷）');
    return ok(res, { users: r.users, systemBytes: r.systemBytes, mftRecords: r.mftRecords, elapsedMs: r.elapsedMs });
  }

  // GET/POST /api/config
  if (pathname === '/api/config') {
    const file = configLib.configPath();
    if (body && body.action === 'set' && body.key && body.value !== undefined) {
      const cfg = configLib.load(file);
      const keys = String(body.key).split('.');
      let cur = cfg;
      for (let i = 0; i < keys.length - 1; i++) {
        if (cur[keys[i]] === undefined || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
        cur = cur[keys[i]];
      }
      const last = keys[keys.length - 1];
      const num = Number(body.value);
      cur[last] = (body.value !== '' && !isNaN(num) && String(body.value).trim() !== '') ? num : body.value;
      const r = configLib.save(cfg, file);
      if (!r.ok) return bad(res, r.error);
      return ok(res, { saved: true, key: body.key, file: r.file });
    }
    if (body && body.action === 'reset') {
      const r = configLib.save(configLib.DEFAULT_CONFIG, file);
      if (!r.ok) return bad(res, r.error);
      return ok(res, { reset: true, file: r.file });
    }
    return ok(res, { config: configLib.load(file), file: file });
  }

  // POST /api/schedule {action: add|run|list|remove, ...}
  if (pathname === '/api/schedule' && body && typeof body === 'object') {
    const action = body.action;
    if (action === 'add') {
      const r = scheduleLib.add({
        name: body.name, when: body.when, day: body.day, time: body.time,
        roots: Array.isArray(body.roots) ? body.roots : [], config: body.config
      }, IS_SEA);
      if (!r.ok) return bad(res, r.error);
      return ok(res, { note: r.note });
    }
    if (action === 'run') {
      const r = await scheduleLib.run(body.name, engineRun).catch(function(e) { return { ok: false, error: e.message }; });
      if (!r.ok) return bad(res, r.error);
      return ok(res, { summary: r.summary || null, reportFile: r.reportFile, mdFile: r.mdFile });
    }
    if (action === 'remove') {
      const r = scheduleLib.remove(body.name, IS_SEA);
      if (!r.ok) return bad(res, r.error);
      return ok(res, { note: r.note });
    }
    if (action === 'list') {
      return ok(res, { items: scheduleLib.list() });
    }
    return bad(res, 'schedule action: add | run | list | remove');
  }

  // GET  /api/recycle/list  — 仅本工具清理项（审计匹配）
  if (pathname.startsWith('/api/recycle/list')) {
    const all = recyclebin.list();
    // 评审 A7：此处原用 String(p).toLowerCase() 直接比较，会在 8.3 短名
    // （ADMINI~1 vs Administrator）等情况下失配 —— MCP 侧早已改用 canonKey 修掉同类问题，
    // serve 停留在那一步，后果是"GUI 恢复列表漏掉自己刚清理的项"。现统一走 guard.canonKey。
    const auditEntries = audit.readAudit();
    const toolPaths = new Set();
    for (const e of auditEntries) {
      if (e && Array.isArray(e.paths)) for (const p of e.paths) toolPaths.add(guard.canonKey(p));
      if (e && Array.isArray(e.keys)) for (const k of e.keys) toolPaths.add(String(k).toLowerCase());
    }
    const items = all.filter(function(x) { return toolPaths.has(guard.canonKey(x.originalPath)); });
    // audit 命中为空时，total 提示有可恢复项但未匹配本工具（避免误判为"空回收站"）
    return ok(res, { items: items, total: all.length, matched: items.length });
  }

  // POST /api/recycle/restore {keys:[], dryRun}
  if (pathname === '/api/recycle/restore' && body && typeof body === 'object') {
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return bad(res, 'keys required');
    const dryRun = body.dryRun !== false; // 默认预览
    if (dryRun) return ok(res, { dryRun: true, wouldRestore: keys.length, note: 'dry-run preview: ' + keys.length + ' items' });
    // 仅允许审计匹配项（同上，改用 canonKey 以兼容短名/规范路径差异）
    const all = recyclebin.list();
    const auditEntries = audit.readAudit();
    const toolPaths = new Set();
    for (const e of auditEntries) if (e && Array.isArray(e.paths)) for (const p of e.paths) toolPaths.add(guard.canonKey(p));
    const matchedKeys = new Set(all.filter(function(x){ return toolPaths.has(guard.canonKey(x.originalPath)); }).map(function(x){ return String(x.key).toLowerCase(); }));
    for (const k of keys) if (!matchedKeys.has(String(k).toLowerCase())) return bad(res, 'key not in tool-cleaned set: ' + k);
    const results = recyclebin.restore(keys);
    const okCount = results.filter(function(r){ return r.ok; }).length;
    audit.appendAudit({ ts: new Date().toISOString(), type: 'recycle-restore', action: 'recycle-restore', keys: keys, results: results, okCount: okCount });
    return ok(res, { restored: okCount, results: results });
  }

  return bad(res, '未知 API: ' + pathname, 404);
}

// ---------- 静态前端托管（白名单扩展名 + 路径穿越防护） ----------
const STATIC_EXT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };

function serveStatic(req, res, webDir) {
  // 评审 B6：decodeURIComponent 对畸形转义（/%、%zz）会抛 URIError，
  // 未捕获时直接打崩请求处理（本地 DoS）。现在失败即 400。
  let rel;
  try {
    rel = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    return bad(res, 'bad request: malformed URL escape', 400);
  }
  if (rel === '/') rel = '/index.html';
  const ext = path.extname(rel).toLowerCase();
  if (!STATIC_EXT[ext]) return bad(res, 'not found', 404);
  // 评审 P2-6：不能用 file.startsWith(webDir) 判定越界——
  // webDir=C:\app\web 时 C:\app\web-evil\x.js 也满足前缀匹配。改用 path.relative 语义。
  const root = path.resolve(webDir);
  const file = path.resolve(root, '.' + rel);
  const relToRoot = path.relative(root, file);
  if (relToRoot === '' || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    return bad(res, 'forbidden', 403);
  }
  fs.readFile(file, function(err, data) {
    if (err) return bad(res, 'not found', 404);
    res.writeHead(200, { 'Content-Type': STATIC_EXT[ext], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// ---------- 入口 ----------
function start(opts) {
  const port = Number(opts.port) || 0;
  const token = opts.token || '';
  const webDir = opts.web ? path.resolve(opts.web) : null;
  let addr = null;

  const server = http.createServer(function(req, res) {
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    const qs = new URLSearchParams(url.split('?')[1] || '');

    // 防 DNS rebinding：Host 必须是 127.0.0.1:<port> 或 localhost:<port>（本机浏览器/WebView2 均满足）
    const host = String(req.headers['host'] || '');
    if (host && host !== '127.0.0.1:' + addr.port && host !== 'localhost:' + addr.port) {
      send(res, 403, { ok: false, error: 'forbidden host' });
      return;
    }

    // API：除 /api/health 外全部鉴权
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/health') {
        handleApi(pathname, null, res, qs);
        return;
      }
      const auth = req.headers['authorization'] || '';
      // 评审 P2-7：默认只接受 Authorization 头。token 出现在 URL query 会进浏览器历史、
      // Referer 与代理日志；仅当前端调试时用 DSK_ALLOW_QUERY_TOKEN=1 显式放开。
      const allowQueryToken = process.env.DSK_ALLOW_QUERY_TOKEN === '1';
      const authOk = auth === 'Bearer ' + token || (allowQueryToken && qs.get('token') === token);
      if (!authOk || !token) {
        send(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      readBody(req).then(function(b) { return handleApi(pathname, b, res, qs); })
        .catch(function(e) { bad(res, e.message, 400); });
      return;
    }

    // 静态
    if (webDir) { serveStatic(req, res, webDir); return; }
    send(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(port, '127.0.0.1', function() {
    addr = server.address();
    console.log('DSK_SERVE_URL=http://127.0.0.1:' + addr.port);
    console.log('DSK_SERVE_TOKEN=' + token);
  });

  function shutdown() {
    for (const job of jobs.values()) { try { job.proc.kill(); } catch (e) { /* ignore */ } }
    try { server.close(); } catch (e) { /* ignore */ }
    setTimeout(function() { process.exit(0); }, 50);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}

// scheduleLib.run 需要的引擎调用（与 CLI 一致：engine.run 返回 {exitCode,data,error}）
async function engineRun(argv) {
  const { run } = require('./engine.js');
  return run(argv);
}

module.exports = { start, VER };