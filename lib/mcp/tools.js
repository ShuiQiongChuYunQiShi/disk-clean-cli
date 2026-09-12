'use strict';
// lib/mcp/tools.js — disk-clean 的 MCP 工具集（12 个）。
//
// 设计约束：
//   1) 每个工具都是 lib/* 现有能力的薄封装，不复制业务逻辑、不新增安全规则。
//   2) 安全闸门只有一处：lib/guard.js（受保护路径 / 云同步 / 扫描根归属），
//      清理白名单只有一处：lib/clean.js validate()。这里只做参数整形与结果裁剪。
//   3) 破坏性动作默认 dry-run，必须显式 confirm:true；可回滚动作在返回里给出回滚指引。
//   4) 返回值必须是最小的自有对象（只读叶子字段），不得把内部对象直接外抛。
const path = require('path');
const guard = require('../guard.js');
const audit = require('../audit.js');
const clean = require('../clean.js');
const organize = require('../organize.js');
const dedup = require('../dedup.js');
const health = require('../health.js');
const quota = require('../quota.js');
const mftscan = require('../mftscan.js');
const recyclebin = require('../recyclebin.js');
const configLib = require('../config.js');
const version = require('../version.js');

const CLEAN_TYPES = ['junk-temp', 'empty-dirs', 'duplicates', 'stale-large', 'recycle-bin'];
const MAX_LIST = 100;

function low(s) { return String(s || '').toLowerCase() }
function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}
function readReport() { return audit.readJson(audit.reportFile()) }

// 硬链接合并记录：单源在 lib/dedup.js（评审 A6 —— 此前 MCP 写 entries、CLI/GUI 写 merged，
// 两种 schema 互不相认，导致"AI 合并的文件 GUI/CLI 回滚不了"）。
function readDedupMap() { return dedup.readDedupMap() }
function writeDedupMap(entries) { return dedup.writeDedupMap(entries) }

// 从报告推导某类型的候选路径（与 CLI/GUI 同源语义：都用报告里的建议清单）
function pathsFor(type, rep) {
  if (!rep) return [];
  const sugg = rep.suggestions || [];
  if (type === 'duplicates') {
    const out = [];
    for (const s of sugg) if (s.type === 'duplicates') for (const g of (s.groups || [])) out.push.apply(out, g.removable || []);
    return out;
  }
  if (type === 'empty-dirs') return (rep.emptyDirSample || []).slice(0, 500);
  if (type === 'junk-temp') {
    for (const s of sugg) if (s.type === 'junk-temp' && Array.isArray(s.paths) && s.paths.length) return s.paths.slice(0, 500);
    return [];
  }
  if (type === 'stale-large') {
    const out = [];
    for (const s of sugg) if (s.type === 'stale-large') for (const it of (s.items || [])) out.push(it.path);
    return out.slice(0, 500);
  }
  return [];
}

function rootsOf(rep) {
  return (rep && rep.summary && Array.isArray(rep.summary.roots)) ? rep.summary.roots : [];
}

// 统一错误出口：MCP 客户端会读 isError + 这段文本，所以错误必须给出下一步动作
function parseDrive(input) {
  // 只接受 "C" / "C:" / "C:\" 三种形式；必须整体匹配，
  // 否则 /^([a-zA-Z]):?/ 会把 "nonsense" 当成 N 盘（宽松正则的经典误判）
  const m = /^\s*([a-zA-Z])\s*:?\s*[\\/]?\s*$/.exec(String(input || ''));
  return m ? m[1].toUpperCase() + ':' : null;
}

function fail(msg, hint) {
  return { ok: false, error: hint ? msg + '（' + hint + '）' : msg };
}

// 盘符容量：单一事实源在 lib/drives.js（v0.7.0 v7-9）。
// 此前这里与 lib/serve.js 各算一遍 statfsSync —— CLI 的 drives 命令若再写第三份，
// 就是重犯 A3（同一名单被抄成多份）的错误。
function listDrives() { return require('../drives.js').list() }

// 规范化路径键：用于跨来源比对（审计日志里是调用方给的原样路径，
// 回收站 $I 记录里是系统写入的规范路径）。两者拼写常常不同。
// 实现已上移到 lib/guard.js 单源（评审 A7），此处保留同名导出以兼容
// 既有调用与 test/mcp-protocol.js。
const canonKey = guard.canonKey;

function tools() {
  return [
    {
      name: 'disk_scan',
      description: '扫描磁盘/目录并生成报告（JSON + Markdown）。同步执行，整盘扫描可能需要数分钟。返回概览统计、类别分布、大目录/大文件 Top、垃圾点与智能建议（散落目录、重复文件、陈旧大文件、可整理候选）。OneDrive 等云同步目录只统计不做哈希、不给清理建议（避免触发云端下载）；扫描过程不修改任何文件。后续 disk_clean / disk_organize / disk_dedup 都依赖本报告做白名单校验，所以通常先调用本工具。',
      annotations: { title: '扫描磁盘生成报告', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          roots: { type: 'array', items: { type: 'string' }, description: '扫描根路径，如 ["D:\\\\"] 或 ["C:\\\\","D:\\\\"]；省略则扫描全部本地盘' },
          exclude: { type: 'array', items: { type: 'string' }, description: '排除的绝对路径（可选）' },
          suggest: { type: 'boolean', description: '是否生成智能建议与整理候选（默认 true；false 可显著加快扫描）' },
          lang: { type: 'string', enum: ['zh', 'en'], description: 'Markdown 报告语言，默认跟随系统' },
        },
        required: [],
      },
      handler: async function (args) {
        const engine = require('../engine.js');
        const argv = [];
        const roots = Array.isArray(args.roots) ? args.roots.filter(Boolean) : [];
        if (roots.length) argv.push('--roots', roots.join(';'));
        if (Array.isArray(args.exclude) && args.exclude.length) argv.push('--exclude', args.exclude.join(';'));
        if (args.suggest !== false) argv.push('--suggest');
        if (args.lang) argv.push('--lang', String(args.lang));
        argv.push('--report', audit.reportFile());
        const res = await engine.run(argv);
        if (!res || res.exitCode === 3) return fail('扫描被取消', '重试 disk_scan；若反复取消请缩小 roots 范围');
        if (!res.data || res.data.ok === false) return fail('扫描失败：' + ((res.data && res.data.error) || '未知错误'), '检查 roots 是否存在、是否有读取权限');
        const d = res.data;
        return {
          ok: true,
          reportFile: d.reportFile,
          mdFile: d.mdFile,
          summary: d.summary,
          category: (d.category || []).slice(0, 15),
          topDirs: (d.topDirs || []).slice(0, 10),
          topFiles: (d.topFiles || []).slice(0, 10),
          junk: (d.junk || []).slice(0, 10),
          suggestionIndex: (d.suggestions || []).map(function (s) {
            return { type: s.type, title: s.title, risk: s.risk, estBytes: s.estBytes, estText: s.estBytes ? fmtBytes(s.estBytes) : null };
          }),
          organizeCounts: d.organizeCounts,
          // T2：报告溯源。调用方（尤其 AI）拿着报告做清理决策，必须知道它是何时、
          // 对哪个范围生成的——否则"基于一份旧报告清理当前磁盘"会被当成现状。
          provenance: require('../report.js').describe({ summary: d.summary }),
          elapsedMs: d.elapsedMs,
          note: '完整报告已写入 reportFile（Markdown 版为 mdFile）。用 disk_report 读细节；清理/整理/查重都基于本报告。',
        };
      },
    },
    {
      name: 'disk_report',
      description: '读取最近一次磁盘扫描报告（只读，不重新扫描）。不传 section 返回精简全貌；传 section 只取该部分，避免整份建议清单撑爆上下文。',
      annotations: { title: '读取扫描报告', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['summary', 'category', 'topDirs', 'topFiles', 'junk', 'suggestions', 'markdown', 'history'], description: '只返回该部分；markdown 返回可读报告全文；history 返回历次扫描的归档清单' },
          limit: { type: 'number', description: '数组类 section 的返回条数上限（默认 15，最大 100）' },
        },
        required: [],
      },
      handler: async function (args) {
        const rep = readReport();
        if (!rep) return fail('尚无扫描报告', '先调用 disk_scan');
        const limit = Math.min(MAX_LIST, Math.max(1, Number(args.limit) || 15));
        const s = args.section;
        if (s === 'markdown') {
          let text = '';
          try { text = require('fs').readFileSync(audit.mdFile(), 'utf8') } catch (e) { text = '' }
          if (!text) return fail('未找到 Markdown 报告', '重新运行 disk_scan 生成');
          return { ok: true, markdown: text.slice(0, 60000) };
        }
        if (s === 'history') {
          // T3：报告历史。报告是全局单例、每次扫描覆盖，没有历史就无法回答
          // "昨天那 40 GB 是哪些目录"。这里只回清单（不解压每份报告，那可能几十 MB）。
          const items = require('../report.js').listArchives().slice(0, limit).map(function (it) {
            return { name: it.name, file: it.file, bytes: it.bytes, generatedLocal: it.generatedLocal };
          });
          return {
            ok: true,
            section: 'history',
            value: items,
            note: '历次扫描的归档清单（新→旧）。归档为 gzip，用 CLI `disk-clean report <文件名>` 打开某一份。',
          };
        }
        if (s) {
          if (rep[s] === undefined) return fail('报告中无此字段：' + s, '可用：summary/category/topDirs/topFiles/junk/suggestions/markdown');
          const v = Array.isArray(rep[s]) ? rep[s].slice(0, limit) : rep[s];
          return { ok: true, section: s, value: v };
        }
        return {
          ok: true,
          summary: rep.summary,
          category: (rep.category || []).slice(0, limit),
          topDirs: (rep.topDirs || []).slice(0, limit),
          topFiles: (rep.topFiles || []).slice(0, limit),
          junk: (rep.junk || []).slice(0, limit),
          suggestions: (rep.suggestions || []).slice(0, limit),
          emptyDirCount: (rep.emptyDirSample || []).length,
          organizeCandidateCount: (rep.organizeCandidates || []).length,
          // T2：这份报告是什么时候、对哪个范围生成的（含"已过期"判断）
          provenance: require('../report.js').describe(rep),
          reportFile: audit.reportFile(),
          mdFile: audit.mdFile(),
        };
      },
    },
    {
      name: 'disk_drives',
      description: '列出本地盘符与真实容量（总/已用/可用/使用率）。容量来自卷文件系统统计，与资源管理器一致（不受目录块数误读影响）。',
      annotations: { title: '列出盘符与容量', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async function () {
        const drives = listDrives();
        if (!drives.length) return fail('未发现任何本地盘', '确认系统至少有一个可访问卷');
        return { ok: true, count: drives.length, drives: drives };
      },
    },
    {
      name: 'disk_clean',
      description: '清理垃圾。type=junk-temp（临时/缓存）/empty-dirs（空文件夹）/duplicates（重复文件多余副本）/stale-large（陈旧大文件）这四类是把文件移入回收站、可恢复；type=recycle-bin 是清空回收站、永久删除不可恢复。默认 dry-run 只预览并回报真实条目数，必须显式传 confirm:true 才执行。paths 省略时自动从最近报告的建议清单提取；所有路径都经白名单 + 系统目录/云同步校验，清单外路径一律拒绝（不会静默跳过）。',
      annotations: { title: '清理垃圾（默认 dry-run）', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: CLEAN_TYPES, description: '清理类型' },
          paths: { type: 'array', items: { type: 'string' }, description: '要清理的绝对路径（省略则按类型从最近报告提取）' },
          confirm: { type: 'boolean', description: 'true=真正执行；省略或 false=仅预览（dry-run）' },
        },
        required: ['type'],
      },
      handler: async function (args) {
        const type = String(args.type || '');
        if (CLEAN_TYPES.indexOf(type) < 0) return fail('未知清理类型：' + type, '可用：' + CLEAN_TYPES.join(' / '));
        const rep = readReport();
        if (!rep) return fail('尚无扫描报告', '先调用 disk_scan');
        let paths = Array.isArray(args.paths) ? args.paths.filter(Boolean) : [];
        if (!paths.length && type !== 'recycle-bin') paths = pathsFor(type, rep);
        if (!paths.length && type !== 'recycle-bin') {
          return fail('既没有传 paths，也没能从最近报告中提取到 ' + type + ' 候选', '先 disk_scan（suggest=true），或显式传 paths');
        }
        const dryRun = args.confirm !== true;
        const r = await clean.execute(type, paths, rep, dryRun);
        if (!r.ok) return r;
        if (r.dryRun) {
          return {
            ok: true, dryRun: true, type: type,
            paths: (r.paths || []).slice(0, MAX_LIST),
            pathCount: (r.paths || []).length,
            estBytes: r.estBytes, estText: r.estBytes ? fmtBytes(r.estBytes) : null,
            itemCount: r.itemCount, irreversible: !!r.irreversible,
            note: r.note,
            next: '确认无误后以 confirm:true 再次调用同一工具执行',
          };
        }
        // 评审 B4：部分成功必须以 isError 上报。只返回 ok:true 的话，模型会照返回值
        // 复述"清理完成"，而实际上有项目因被占用/权限不足被静默跳过（提示词铁律 24：
        // AI 直接照返回值复述结论，所以"没全做完"绝不能伪装成 ok）。
        if (r.partial) {
          return {
            content: [{
              type: 'text',
              text: '部分完成：' + (r.note || ('仅 ' + r.executed + '/' + r.total + ' 项成功')) +
                '。请对剩余项重试，或在确认它们已不需要后继续。',
            }],
            isError: true,
            ok: false, partial: true, type: type, executed: r.executed, total: r.total,
            freedBytes: r.freedBytes, freedText: r.freedBytes ? fmtBytes(r.freedBytes) : null,
            rollbackHint: '已成功的项可调用 disk_recycle cmd=list 查看并 cmd=restore 恢复',
          };
        }
        return {
          ok: true, type: type, executed: r.executed, total: r.total,
          freedBytes: r.freedBytes, freedText: r.freedBytes ? fmtBytes(r.freedBytes) : null,
          itemCount: r.itemCount,
          escapedWhitelist: r.escapedWhitelist,
          note: r.note,
          rollbackHint: type === 'recycle-bin' ? '此操作不可恢复' : '可调用 disk_recycle cmd=list 查看并 cmd=restore 恢复',
        };
      },
    },
    {
      name: 'disk_organize',
      description: '整理散落目录（把装错位置的目录/文件移进 <盘>:\\整理区\\<分类>\\，不删除）。cmd=plan 生成计划（只读；includeProgram=true 会追加程序/游戏目录，风险高且会自动重写快捷方式）；cmd=apply 执行（需 confirm:true，可回滚）；cmd=rollback 回滚最后一批（需 confirm:true，含快捷方式还原）。',
      annotations: { title: '整理散落目录', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['plan', 'apply', 'rollback'], description: '操作命令' },
          includeProgram: { type: 'boolean', description: 'cmd=plan：是否包含程序/游戏目录（默认 false）' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'cmd=apply：计划项数组（原样取自 plan 输出的 items）' },
          confirm: { type: 'boolean', description: 'apply / rollback 需 true 才执行' },
        },
        required: ['cmd'],
      },
      handler: async function (args) {
        const cmd = String(args.cmd || '');
        const rep = readReport();
        if (cmd === 'plan') {
          if (!rep) return fail('尚无扫描报告', '先调用 disk_scan（suggest=true 才会产生整理候选）');
          const r = await organize.plan({ reportFile: audit.reportFile(), includeProgram: !!args.includeProgram });
          if (!r.ok) return r;
          return {
            ok: true, itemCount: (r.items || []).length, totalBytes: r.totalBytes,
            totalText: r.totalBytes ? fmtBytes(r.totalBytes) : null,
            dirCount: r.dirCount, fileCount: r.fileCount, programCount: r.programCount,
            items: (r.items || []).slice(0, MAX_LIST),
            note: r.note,
            next: '核对后将 items 原样交给 disk_organize cmd=apply confirm=true 执行（可 rollback 回滚）',
          };
        }
        if (cmd === 'apply') {
          const items = Array.isArray(args.items) ? args.items : [];
          if (!items.length) return fail('缺少 items', '先调用 disk_organize cmd=plan 取得计划项');
          const roots = rootsOf(rep);
          if (args.confirm !== true) return await organize.apply(items, { roots: roots, dryRun: true });
          const r = await organize.apply(items, { roots: roots, dryRun: false });
          if (r.ok) r.rollbackHint = '可调用 disk_organize cmd=rollback confirm=true 回滚最后一批';
          return r;
        }
        if (cmd === 'rollback') {
          if (args.confirm !== true) return await organize.rollback({ dryRun: true });
          return await organize.rollback({ dryRun: false });
        }
        return fail('未知命令：' + cmd, '可用：plan / apply / rollback');
      },
    },
    {
      name: 'disk_dedup',
      description: '重复文件处理。cmd=scan 按大小→头尾哈希→（小文件）全哈希查重，自动跳过系统/程序目录与 OneDrive 云同步目录，默认只看 ≥1MB 文件；cmd=hardlink 把每组重复合并为硬链接（保留每组第一个文件，其余转硬链接指向它，省空间、内容等价，需 confirm:true）；cmd=rollback 把上次合并的硬链接还原为独立副本（需 confirm:true）。',
      annotations: { title: '重复文件查重与硬链接合并', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['scan', 'hardlink', 'rollback'], description: '操作命令' },
          roots: { type: 'array', items: { type: 'string' }, description: 'cmd=scan：扫描根（省略则用最近报告的扫描范围）' },
          minBytes: { type: 'number', description: 'cmd=scan：重复候选最小字节（默认 1MB）' },
          groups: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'cmd=hardlink：重复组数组（原样取自 scan 输出的 groups）' },
          confirm: { type: 'boolean', description: 'hardlink / rollback 需 true 才执行' },
        },
        required: ['cmd'],
      },
      handler: async function (args) {
        const cmd = String(args.cmd || '');
        if (cmd === 'scan') {
          const rep = readReport();
          let roots = Array.isArray(args.roots) ? args.roots.filter(Boolean) : [];
          if (!roots.length) roots = rootsOf(rep);
          if (!roots.length) return fail('缺少 roots，且最近报告里没有扫描范围', '传入 roots，或先 disk_scan');
          // 根不可访问时必须报错：否则会静默返回“0 组重复”，被误读成“没有重复文件”
          const fsLib = require('fs');
          const missing = roots.filter(function (r) { try { return !fsLib.existsSync(r) } catch (e) { return true } });
          const usable = roots.filter(function (r) { return missing.indexOf(r) < 0 });
          if (!usable.length) return fail('扫描根全部不可访问：' + missing.join(', '), '检查盘符/路径是否存在且可读');
          roots = usable;
          const minBytes = Number(args.minBytes) > 0 ? Number(args.minBytes) : undefined;
          const r = await dedup.scan(roots, { minBytes: minBytes });
          if (!r.ok) return r;
          const groups = (r.groups || []).map(function (g) {
            return { size: g.size, sizeText: fmtBytes(g.size), approx: !!g.approx, files: g.files, removable: g.files.slice(1).map(function (f) { return f.path }) };
          });
          return {
            ok: true, roots: roots,
            rootsMissing: missing.length ? missing : undefined,
            groupCount: groups.length,
            scannedFiles: r.scannedFiles,
            totalSaveBytes: r.totalSaveBytes, totalSaveText: fmtBytes(r.totalSaveBytes),
            elapsedMs: r.elapsedMs,
            groups: groups.slice(0, 50),
            truncated: groups.length > 50,
            next: '两种处理方式：① disk_clean type=duplicates（把多余副本移入回收站，推荐）② disk_dedup cmd=hardlink（合并为硬链接，保留全部路径）',
          };
        }
        if (cmd === 'hardlink') {
          const groups = Array.isArray(args.groups) ? args.groups : [];
          if (!groups.length) return fail('缺少 groups', '先 disk_dedup cmd=scan 取得重复组');
          // 评审 A1：approx 组（>32MB 仅 head+tail 抽样）不得合并为硬链接。
          // 这里显式分流，让模型看到"为什么这些组不能合并、该改用什么"，
          // 而不是把它们混进 normalized 后被底层静默拒绝。
          const approxGroups = groups.filter(function (g) { return g && g.approx === true; });
          const exactGroups = groups.filter(function (g) { return g && g.approx !== true; });
          const normalized = exactGroups.filter(function (g) { return g && Array.isArray(g.files) && g.files.length > 1 })
            .map(function (g) { return { size: g.size, files: g.files.map(function (f) { return { path: f.path, size: f.size || g.size } }) } });
          const approxNote = approxGroups.length
            ? { approxGroupsRejected: approxGroups.length, approxReason: '这些组仅经 head+tail 各 64KB 抽样比对（approx=true），大文件内容可能不同；建立硬链接会造成不可逆的内容损坏。请改用 disk_clean type=duplicates（移入回收站，可恢复）。' }
            : null;
          if (!normalized.length) {
            if (approxNote) {
              return { ok: false, error: '没有可安全合并的组：' + approxGroups.length + ' 组是近似组（approx=true）', hint: approxNote.approxReason };
            }
            return fail('groups 里没有可合并的组（每组需含 >1 个文件）');
          }
          if (args.confirm !== true) {
            const wouldSave = normalized.reduce(function (a, g) { return a + (g.size || 0) * (g.files.length - 1) }, 0);
            return { ok: true, dryRun: true, groups: normalized.length, approxGroupsRejected: approxNote ? approxNote.approxGroupsRejected : 0, approxReason: approxNote ? approxNote.approxReason : undefined, wouldSaveBytes: wouldSave, wouldSaveText: fmtBytes(wouldSave), note: 'dry-run：传 confirm:true 才合并为硬链接（可 rollback 回滚）' };
          }
          // 回滚记录：{victim, keep, size}（append-only，保留 keep 才能在回滚时从保留副本复制，无需整文件读内存）
          const map = readDedupMap();
          const entries = map.entries.slice();
          const results = [];
          let failed = 0, refused = 0;
          for (const g of normalized) {
            const rs = dedup.hardlinkGroup(g, false);
            for (const x of rs) {
              if (x.action === 'hardlink') {
                entries.push({ victim: x.to, keep: x.from, size: g.size || 0, at: new Date().toISOString() });
                results.push(x);
              } else if (x.action === 'refused') { refused++; results.push(x) }
              else if (x.action === 'fail') { failed++; results.push(x) }
            }
          }
          writeDedupMap(entries);
          audit.appendAudit({
            ts: new Date().toISOString(), type: 'dedup', action: 'hardlink',
            paths: results.filter(function (x) { return x.action === 'hardlink' }).map(function (x) { return x.to }).slice(0, 200),
            executed: results.filter(function (x) { return x.action === 'hardlink' }).length,
            result: (failed || refused) ? 'partial' : 'ok',
          });
          const mergedCount = results.filter(function (x) { return x.action === 'hardlink' }).length;
          if (!mergedCount) {
            return fail('没有任何文件被合并为硬链接（' + failed + ' 个失败，' + refused + ' 个被安全闸门拒绝）', '检查目标文件是否被占用、是否与保留文件同卷；被拒绝的多为受保护路径或近似组');
          }
          return {
            ok: true, merged: mergedCount, failed: failed, refused: refused,
            results: results.slice(0, MAX_LIST),
            note: '已合并 ' + mergedCount + ' 个重复文件为硬链接' + (failed ? '，' + failed + ' 个失败' : '') + (refused ? '，' + refused + ' 个被安全闸门拒绝' : '') + '（所有路径仍可正常访问）',
            rollbackHint: '可调用 disk_dedup cmd=rollback confirm=true 还原为独立副本',
          };
        }
        if (cmd === 'rollback') {
          const entries = readDedupMap().entries;
          if (!entries.length) return fail('没有可回滚的硬链接合并记录', '只有 disk_dedup cmd=hardlink 执行过才有记录');
          if (args.confirm !== true) {
            return { ok: true, dryRun: true, wouldRestore: entries.length, note: 'dry-run：传 confirm:true 才还原为独立副本（会重新占用磁盘空间）' };
          }
          const rs = dedup.rollbackHardlinks(entries);
          const okPaths = new Set(rs.filter(function (x) { return x.action === 'restored' }).map(function (x) { return low(x.path) }));
          const failedList = rs.filter(function (x) { return x.action !== 'restored' });
          // 只移除成功项：失败项与其 keep 信息保留，便于修好环境后重试
          writeDedupMap(entries.filter(function (e) { return !okPaths.has(low(e.victim)) }));
          audit.appendAudit({
            ts: new Date().toISOString(), type: 'dedup', action: 'rollback',
            paths: rs.slice(0, 200).map(function (x) { return x.path }),
            executed: okPaths.size, result: failedList.length ? 'partial' : 'ok',
          });
          if (!okPaths.size) return fail('还原失败（0/' + entries.length + '）', (failedList[0] && failedList[0].error) || '文件可能已被删除或被占用');
          return {
            ok: true, restored: okPaths.size, failed: failedList.length,
            failedList: failedList.slice(0, 20),
            note: '已还原 ' + okPaths.size + '/' + entries.length + ' 个硬链接为独立副本',
          };
        }
        return fail('未知命令：' + cmd, '可用：scan / hardlink / rollback');
      },
    },
    {
      name: 'disk_health',
      description: '物理磁盘健康检查（需管理员权限）：型号/介质/总线/固件/序列号、温度、SSD 剩余寿命、通电小时与次数、启停与磁头加载次数、读写纠错与不可纠正错误计数、健康分级与问题列表，以及物理盘到盘符卷的映射。同时返回每盘最近 20 次采样趋势（同一盘 60 秒内只采一次，避免频繁调用磨损/抖动）。',
      annotations: { title: '磁盘健康检查', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async function () {
        const r = health.check();
        if (!r.ok) return fail(r.error, '请以管理员身份运行；部分虚拟机/RAID 控制器不暴露 SMART');
        return { ok: true, diskCount: r.disks.length, disks: r.disks, trend: r.trend, rawFile: r.file };
      },
    },
    {
      name: 'disk_quota',
      description: '按用户统计某盘占用（需管理员权限，直读 NTFS MFT）：每个用户账户的总占用与 Downloads/Documents/Desktop 等子目录明细，以及系统区占用。适合定位“谁把盘占满了”。',
      annotations: { title: '按用户统计磁盘占用', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: { drive: { type: 'string', description: '盘符，如 "C:" 或 "D:"' } },
        required: ['drive'],
      },
      handler: async function (args) {
        const drive = parseDrive(args.drive);
        if (!drive) return fail('无效盘符：' + String(args.drive || ''), '形如 "C:" 或 "D:"');
        const r = quota.analyze(drive);
        if (!r.ok) return fail(r.error || '统计失败', '请以管理员身份运行，且目标卷需为 NTFS');
        return {
          ok: true, drive: r.drive, mftRecords: r.mftRecords, elapsedMs: r.elapsedMs,
          systemBytes: r.systemBytes, systemText: fmtBytes(r.systemBytes),
          users: (r.users || []).map(function (u) {
            return { name: u.name, bytes: u.bytes, text: fmtBytes(u.bytes), subdirs: u.subdirs.map(function (s) { return { name: s.name, bytes: s.bytes, text: fmtBytes(s.bytes) } }) };
          }),
          note: '统计来自 $MFT 目录项，已去重硬链接，结果可能略小于资源管理器显示值。',
        };
      },
    },
    {
      name: 'disk_mftscan',
      description: 'MFT 直读快速扫描（需管理员权限，仅 NTFS）：直接解析 $MFT 元数据，比目录遍历快约 8 倍，适合整盘快速摸底。返回概要、类别分布、扩展名 Top、大目录 Top 与大文件 Top。注意：结果只读、不落盘报告，因此不能直接用于 disk_clean 的白名单校验（清理请用 disk_scan）。',
      annotations: { title: 'MFT 直读快速扫描', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          drive: { type: 'string', description: '盘符，如 "D:"' },
          limit: { type: 'number', description: '各 Top 列表返回条数（默认 15，最大 100）' },
        },
        required: ['drive'],
      },
      handler: async function (args) {
        const drive = parseDrive(args.drive);
        if (!drive) return fail('无效盘符：' + String(args.drive || ''), '形如 "D:"');
        const limit = Math.min(MAX_LIST, Math.max(1, Number(args.limit) || 15));
        const r = mftscan.scan(drive);
        if (!r.ok) return fail(r.error || '扫描失败', '需要管理员权限且目标卷为 NTFS（FAT32/exFAT/网络盘不支持）');
        const sum = r.summary || {};
        return {
          ok: true, drive: r.drive, elapsedMs: r.elapsedMs,
          summary: Object.assign({}, sum, {
            totalBytesText: fmtBytes(sum.totalBytes),
            sysBytesText: fmtBytes(sum.sysBytes),
          }),
          category: (r.category || []).slice(0, limit),
          extTop: (r.extTop || []).slice(0, limit),
          topDirs: (r.topDirs || []).slice(0, limit),
          topFiles: (r.topFiles || []).slice(0, limit),
        };
      },
    },
    {
      name: 'disk_audit',
      description: '读取本工具的操作审计日志（JSONL）：每次清理/整理/查重/回收站恢复的时间、类型、动作、涉及路径、释放字节、成功项数与结果。用于回答“刚才到底动了什么”以及排查失败原因。',
      annotations: { title: '读取操作审计日志', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回最近多少条（默认 50，最大 500）' },
          type: { type: 'string', description: '只返回该类型：clean / organize / dedup / shortcuts / recycle-restore / recycle-bin' },
        },
        required: [],
      },
      handler: async function (args) {
        let all = audit.readAudit();
        if (args.type) {
          const t = String(args.type);
          all = all.filter(function (e) { return e && (e.type === t || e.action === t) });
        }
        const limit = Math.min(500, Math.max(1, Number(args.limit) || 50));
        const entries = all.slice(-limit).reverse();
        return {
          ok: true, total: all.length, returned: entries.length,
          entries: entries,
          auditFile: audit.auditFile(),
          note: '按时间倒序（最新在前）。freedBytes 为估算释放量；recycle-bin 类型为永久删除。',
        };
      },
    },
    {
      name: 'disk_recycle',
      description: '回收站操作。cmd=list 列出可恢复条目（只列出经本工具清理的项，按审计日志匹配，避免误恢复别人的文件）；cmd=restore keys=[...] 恢复到原路径（同名时自动加 " (restored)" 后缀，需 confirm:true）。只能恢复本工具删除的文件。',
      annotations: { title: '回收站列出与恢复', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['list', 'restore'], description: '操作命令' },
          keys: { type: 'array', items: { type: 'string' }, description: 'cmd=restore：条目标识（原样取自 list 输出的 key）' },
          confirm: { type: 'boolean', description: 'restore 需 true 才执行' },
        },
        required: ['cmd'],
      },
      handler: async function (args) {
        const cmd = String(args.cmd || '');
        const all = recyclebin.list();
        const toolPaths = new Set();
        for (const e of audit.readAudit()) {
          if (e && Array.isArray(e.paths)) for (const p of e.paths) toolPaths.add(canonKey(p));
        }
        const matched = all.filter(function (x) { return toolPaths.has(canonKey(x.originalPath)) });
        if (cmd === 'list') {
          const out = {
            ok: true, toolMatched: matched.length, totalInBin: all.length,
            items: matched.slice(0, MAX_LIST).map(function (x) {
              return { key: x.key, originalPath: x.originalPath, size: x.size, sizeText: fmtBytes(x.size), deletedAt: x.deletedAt };
            }),
            note: matched.length ? '这些是本工具清理过的项，可用 keys 恢复' : '回收站中没有本工具清理过的项（非本工具删除的文件不在此列，请用资源管理器还原）',
          };
          // 回收站非空但一项都匹配不上时，说明审计里没有对应记录：
          // 要么清理是别的工具/手工做的，要么审计已被轮转清掉。
          // 明确说出来，避免被读成"回收站是空的"。
          if (!matched.length && all.length) {
            out.hint = '回收站里有 ' + all.length + ' 项，但审计日志中没有匹配的清理记录（可能由其它工具或手工删除，或审计日志已轮转）。本工具只能恢复自己清理过的项。';
          }
          return out;
        }
        if (cmd === 'restore') {
          const keys = Array.isArray(args.keys) ? args.keys.filter(Boolean) : [];
          if (!keys.length) {
            const hint = matched.length
              ? '先 disk_recycle cmd=list 取得 key（当前有 ' + matched.length + ' 项可恢复）'
              : '先 disk_recycle cmd=list 取得 key；若 list 返回 toolMatched=0，说明回收站里没有本工具清理过的项';
            return fail('缺少 keys', hint);
          }
          const allowed = new Set(matched.map(function (x) { return low(x.key) }));
          const rejected = keys.filter(function (k) { return !allowed.has(low(k)) });
          if (rejected.length) return fail('只能恢复本工具清理过的项，拒绝 ' + rejected.length + ' 个 key', '先用 cmd=list 确认可用 key');
          if (args.confirm !== true) {
            return { ok: true, dryRun: true, wouldRestore: keys.length, note: 'dry-run：传 confirm:true 才恢复（同名文件会自动改名，不覆盖）' };
          }
          const results = recyclebin.restore(keys);
          const okResults = results.filter(function (r) { return r.ok });
          audit.appendAudit({
            ts: new Date().toISOString(), type: 'recycle-restore', action: 'recycle-restore',
            paths: okResults.map(function (r) { return r.restoredTo }),
            executed: okResults.length, result: okResults.length ? 'ok' : 'error',
          });
          if (!okResults.length) return fail('恢复失败（0/' + keys.length + '）', (results[0] && results[0].error) || '条目可能已被清空或原路径不可写');
          return {
            ok: true, restored: okResults.length, failed: results.length - okResults.length,
            results: results.slice(0, MAX_LIST),
            note: '已恢复 ' + okResults.length + '/' + keys.length + ' 项',
          };
        }
        return fail('未知命令：' + cmd, '可用：list / restore');
      },
    },
    {
      name: 'disk_config',
      description: '读取或修改规则配置（~/.disk-clean/config.json）：清理/整理阈值（散落目录与陈旧文件的大小与天数、重复文件最小字节）、exclude 排除前缀、审计日志上限（retention.auditLines）、报告历史保留份数（retention.reports）。cmd=get 读当前配置（含默认值合并结果）；cmd=set 改一项；cmd=reset 恢复默认。注意：配置只能收窄而不能放宽安全边界——系统目录与 OneDrive 始终由 lib/guard.js 拒绝，不受配置影响。注意：config.json 里还存在 junkRules / organizeRules 两个字段，但引擎尚未读取它们（见 lib/config.js 的 UNIMPLEMENTED），设置它们不会有任何效果。',
      annotations: { title: '读写规则配置', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['get', 'set', 'reset'], description: '操作命令' },
          key: { type: 'string', description: 'cmd=set：配置键，支持点号路径，如 thresholds.staleMinDays' },
          value: { type: 'string', description: 'cmd=set：值（纯数字会自动转成数字，其余按字符串）' },
        },
        required: ['cmd'],
      },
      handler: async function (args) {
        const file = configLib.configPath();
        const cmd = String(args.cmd || 'get');
        if (cmd === 'get') return { ok: true, config: configLib.load(file), file: file };
        if (cmd === 'reset') {
          const r = configLib.save(configLib.DEFAULT_CONFIG, file);
          return r.ok ? { ok: true, reset: true, file: r.file, config: configLib.DEFAULT_CONFIG } : fail(r.error);
        }
        if (cmd === 'set') {
          const key = String(args.key || '');
          if (!key) return fail('缺少 key', '如 thresholds.staleMinDays');
          if (args.value === undefined || args.value === null) return fail('缺少 value');
          const cfg = configLib.load(file);
          const parts = key.split('.').filter(Boolean);
          let cur = cfg;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          const last = parts[parts.length - 1];
          const raw = String(args.value);
          const num = Number(raw);
          cur[last] = (raw !== '' && !isNaN(num)) ? num : raw;
          const r = configLib.save(cfg, file);
          if (!r.ok) return fail(r.error || '写入配置失败', '检查 ~/.disk-clean 是否可写');
          return { ok: true, saved: true, key: key, value: cur[last], file: r.file, note: '配置对后续 disk_scan 生效' };
        }
        return fail('未知命令：' + cmd, '可用：get / set / reset');
      },
    },
  ];
}

module.exports = {
  tools: tools,
  pathsFor: pathsFor,
  readReport: readReport,
  listDrives: listDrives,
  canonKey: canonKey,
  CLEAN_TYPES: CLEAN_TYPES,
  SERVER_INFO: { name: 'disk-clean', version: version.VERSION },
};
