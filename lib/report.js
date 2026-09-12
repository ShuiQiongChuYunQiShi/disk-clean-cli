'use strict';
// lib/report.js — 报告溯源（T2）：生成时间 / 工具版本 / 扫描范围 / 耗时的唯一实现。
//
// 要解决的问题：
//   报告是全局单例 `~/.disk-clean/report.json`，任何一次扫描都直接覆盖上一次；
//   而 `report` 命令的终端输出里**不含生成时间**（Markdown 里有、终端里没有，两者还不一致）。
//   用户完全可能拿着一份三天前的报告做清理决策，界面上看不出来。
//   更麻烦的是：`clean` / `organize` 的候选路径与范围校验**都取自"最近报告"**——
//   报告被换掉之后，用户看到的候选来自另一棵树，却说不清为什么。
//
// 设计原则：
//   写入端存进去（stamp），读取端算好（describe），**三处显示（CLI/MCP/GUI）只做渲染**。
//   时间格式化只有这里一份——"三处各自格式化时间"必然漂移，本仓库已经吃过多次同样的亏。
//
// 关于旧报告：v0.7.0 及以前写出的报告没有 generatedAt。此时**不能假装它很新**
//   （用户会当真），也不能瞎猜它很旧（同样是编造）。所以如实返回 legacy=true，
//   让显示层说"生成时间未知"。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const audit = require('./audit.js');
const VERSION = require('./version.js').VERSION;

// 超过这个时长就提示报告可能已过期（R1-2 建议 24h）
const STALE_HOURS = 24;

// 写入端：给报告对象补溯源字段。幂等，不覆盖已有值。
function stamp(rep) {
  if (!rep || typeof rep !== 'object') return rep;
  if (!rep.generatedAt) rep.generatedAt = new Date().toISOString();
  if (!rep.tool || typeof rep.tool !== 'object') rep.tool = { name: 'disk-clean', version: VERSION };
  return rep;
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// ISO → 本地时间文本（用户看的是本地时间，不是 UTC）
function localText(iso) {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return null;
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 相对时间文本
function humanAge(ms) {
  if (!isFinite(ms)) return '未知';
  if (ms < 0) return '刚刚';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '不到 1 分钟前';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  return d + ' 天前';
}

// 读取端：把溯源算成结构化的、可直接渲染的形式。rep 可以为 null（无报告）。
function describe(rep) {
  const out = {
    present: !!rep,
    generatedAt: null,      // ISO；旧报告回落到 summary.scannedAt
    generatedLocal: null,   // 本地时间文本
    timeSource: null,       // 时间是哪个字段来的（generatedAt / summary.scannedAt）
    ageMs: null,
    ageText: '未知',
    stale: false,           // 是否超过 STALE_HOURS（时间未知时一律 false——无从判断的事不猜）
    staleHours: STALE_HOURS,
    legacy: false,          // 完全没有时间信息的报告
    version: null,
    elapsedMs: null,
    roots: [],
    rootsText: '未知',
  };
  if (!rep) return out;

  // 时间来源：顶层 generatedAt 为权威（v0.7.1 起由 stamp 写入）。
  // 旧报告回落到 summary.scannedAt —— 它从更早的版本就存在（Markdown 一直在用它），
  // 所以"上一版报告无法判断新旧"其实不成立，能判断的就必须判断，而不是笼统说"未知"。
  // 两个字段都在同一次扫描里写入、相差毫秒级，因此这里只需要一个明确的优先顺序，
  // 不需要任何"对齐"逻辑。
  const rawAt = rep.generatedAt || (rep.summary && rep.summary.scannedAt);
  const t = Date.parse(rawAt);
  if (isFinite(t)) {
    out.generatedAt = new Date(t).toISOString();
    out.generatedLocal = localText(out.generatedAt);
    out.ageMs = Date.now() - t;
    out.ageText = humanAge(out.ageMs);
    out.stale = out.ageMs > STALE_HOURS * 3600000;
    out.timeSource = rep.generatedAt ? 'generatedAt' : 'summary.scannedAt';
  } else {
    out.legacy = true;
  }
  out.version = (rep.tool && rep.tool.version) || null;
  out.elapsedMs = typeof rep.elapsedMs === 'number' ? rep.elapsedMs : null;
  out.roots = (rep.summary && Array.isArray(rep.summary.roots)) ? rep.summary.roots.slice() : [];
  out.rootsText = out.roots.length ? out.roots.join(', ') : '未知';
  return out;
}

// 一行式摘要，给日志/单行场景用
function summaryLine(rep) {
  const d = describe(rep);
  if (!d.present) return '无报告';
  const when = d.legacy ? '生成时间未知' : (d.generatedLocal + '（' + d.ageText + '）');
  return d.rootsText + ' · ' + when + (d.stale ? ' · 已过期' : '');
}

// ---------------------------------------------------------------- 报告历史（T3）
//
// `retention.reports`（默认 30，"保留最近 N 份报告"）从很早就写在默认配置里，
// 但**从来没有任何读取点**——也就是说"报告历史"这个能力从未存在，配置里却写着。
// 而报告恰恰是全局单例、每次扫描直接覆盖：没有历史，就没有任何办法回看
// "昨天那 40 GB 是哪些目录"，而 T2 补上的溯源也只有当前这一份能看。
//
// 归档用 gzip：一个磁盘清理工具不该为了存历史自己吃掉几百 MB，
// 而报告内容（大量重复的路径字符串）压缩率很高。读取端由 audit.readJson 统一解压，
// 调用方不需要区分文件是否压缩。

function archiveStamp(iso) {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return String(Date.now());
  return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

// 保留最近 keep 份。文件名以 YYYYMMDD-HHMMSS 开头，字典序即时间序。
// 旧版定时任务的归档名是 ISO 形式（`2026-09-12T...`），`-` 排在数字之前，
// 所以它们会被当成更早的记录优先清掉——正确且无需特判。
function pruneArchives(dir, keep) {
  if (typeof keep !== 'number' || keep < 0) return 0;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.json(\.gz)?$/i.test(f)); } catch (e) { return 0; }
  files.sort();
  const excess = files.slice(0, Math.max(0, files.length - keep));
  let removed = 0;
  for (const f of excess) {
    try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (e) { /* ignore */ }
  }
  return removed;
}

// 归档一份报告。返回 { ok, file, bytes, keep, pruned } —— 失败不抛，由调用方决定是否提示。
function archive(rep, opts) {
  const o = opts || {};
  if (!rep || typeof rep !== 'object') return { ok: false, error: '报告对象为空' };
  const dir = o.dir || audit.reportsDir();
  const keep = (typeof o.keep === 'number') ? o.keep : audit.maxReports();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const at = rep.generatedAt || (rep.summary && rep.summary.scannedAt) || new Date().toISOString();
    const base = archiveStamp(at) + (o.name ? '-' + o.name : '');
    let file = path.join(dir, base + '.json.gz');
    let n = 1;
    // 同一秒内的两次扫描会撞名：加序号，绝不覆盖已经存在的历史
    while (fs.existsSync(file)) { n++; file = path.join(dir, base + '-' + n + '.json.gz'); }
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(rep), 'utf8')));
    const pruned = pruneArchives(dir, keep);
    return { ok: true, file: file, bytes: fs.statSync(file).size, keep: keep, pruned: pruned };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// 列出归档，新的在前。时间从文件名解析——不为了一个列表去解压每一份报告
// （真实整盘报告可能几十 MB，30 份全解压是纯粹的浪费）。
function listArchives(opts) {
  const o = opts || {};
  const dir = o.dir || audit.reportsDir();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.json(\.gz)?$/i.test(f)); } catch (e) { return []; }
  files.sort();
  files.reverse();
  const items = files.map(function (f) {
    let size = 0, mtime = null;
    try {
      const st = fs.statSync(path.join(dir, f));
      size = st.size;
      mtime = st.mtime.toISOString();
    } catch (e) { /* ignore */ }
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(f);
    return {
      name: f,
      file: path.join(dir, f),
      bytes: size,
      mtime: mtime,
      gzip: /\.gz$/i.test(f),
      generatedLocal: m ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]) : null,
      // 旧版定时归档的名字是 ISO + 任务名，没有生成时间可解析——如实标记，不硬套格式
      legacyName: !m,
    };
  });
  return typeof o.limit === 'number' ? items.slice(0, o.limit) : items;
}

module.exports = {
  stamp, describe, summaryLine, localText, humanAge,
  archive, listArchives, pruneArchives,
  STALE_HOURS, VERSION,
};
