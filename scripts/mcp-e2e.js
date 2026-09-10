// scripts/mcp-e2e.js — 端到端 MCP 冒烟：起真实进程，走完整调用链
// 用法: node scripts/mcp-e2e.js <测试根目录> [--exe <disk-clean 可执行文件>]
//   不带 --exe 时用 node bin/disk-clean-mcp.js（源码形态）
//   带 --exe 时用 <exe> mcp（SEA 单文件发布形态）—— 发布前必跑，否则"源码对、exe 坏"查不出来
// 验证：initialize -> tools/list -> disk_scan -> disk_report -> disk_clean(dry-run/confirm)
//       -> disk_recycle(list/restore) -> disk_dedup -> 安全负例 -> disk_audit，
//       并确认 dry-run 零副作用、stdout 无非协议输出。
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
// 解析位置参数与选项：位置参数是测试根目录，--exe 指定打包后的可执行文件。
// 注意别用 exeIdx+1 做索引过滤——没有 --exe 时 exeIdx=-1 会把第一个位置参数也滤掉。
const positional = [];
let exe = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--exe') { exe = argv[i + 1]; i++; continue }
  positional.push(argv[i]);
}
const root = positional[0];
if (!root) { console.error('usage: node scripts/mcp-e2e.js <root> [--exe <path>]'); process.exit(1) }
if (exe && !fs.existsSync(exe)) { console.error('exe not found: ' + exe); process.exit(1) }
if (!fs.existsSync(root)) { console.error('test root not found: ' + root); process.exit(1) }

// 隔离状态目录，避免污染真实 ~/.disk-clean
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-e2e-home-'));
const entry = exe ? path.resolve(exe) : path.join(__dirname, '..', 'bin', 'disk-clean-mcp.js');
const childArgs = exe ? ['mcp'] : [entry];
const child = spawn(exe || process.execPath, childArgs, {
  env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME: HOME }),
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
console.log('# target: ' + (exe ? 'EXE ' + entry + ' mcp' : 'node ' + entry));

let out = '', err = '', buf = '';
const pending = new Map();
child.stdout.on('data', function (d) {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    out += line + '\n';
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) { const r = pending.get(msg.id); pending.delete(msg.id); r(msg) }
  }
});
child.stderr.on('data', function (d) { err += d.toString('utf8') });

let nextId = 1;
function rpc(method, params, timeoutMs) {
  const id = nextId++;
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error('timeout: ' + method)) }, timeoutMs || 600000);
    pending.set(id, function (m) { clearTimeout(t); resolve(m) });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
  });
}
async function call(name, args) {
  const r = await rpc('tools/call', { name: name, arguments: args });
  const txt = r.result.content[0].text;
  let v; try { v = JSON.parse(txt) } catch (e) { v = { _raw: txt } }
  return { isError: !!r.result.isError, v: v };
}
function fmt(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++ }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}
const log = console.log;

(async function () {
  log('== initialize');
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  log('   server:', init.result.serverInfo.name, 'v' + init.result.serverInfo.version, '| protocol', init.result.protocolVersion);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  log('== tools/list');
  const list = (await rpc('tools/list', {})).result.tools;
  log('   ' + list.length + ' tools:', list.map(t => t.name).join(', '));

  log('== disk_drives');
  const drives = await call('disk_drives', {});
  const d0 = drives.v.drives[0];
  log('   ' + d0.drive + ' ' + d0.usedText + ' / ' + d0.totalText + ' (' + d0.usedPercent + '%)');

  log('== disk_scan (真实扫描 ' + root + ')');
  const scan = await call('disk_scan', { roots: [root], lang: 'zh' }, 600000);
  log('   ok=' + scan.v.ok + ' files=' + scan.v.summary.totalFiles + ' bytes=' + fmt(scan.v.summary.totalBytes) +
      ' dirs=' + scan.v.summary.totalDirs + ' elapsed=' + scan.v.elapsedMs + 'ms');
  log('   建议类别: ' + (scan.v.suggestionIndex || []).map(s => s.type + '(' + (s.estText || s.estBytes || 0) + ')').join(', '));

  log('== disk_report');
  const rep = await call('disk_report', { section: 'summary' });
  log('   roots=' + JSON.stringify(rep.v.value.roots) + ' totalBytes=' + fmt(rep.v.value.totalBytes));

  log('== disk_clean dry-run (junk-temp)');
  const dry = await call('disk_clean', { type: 'junk-temp' });
  log('   ok=' + dry.v.ok + ' dryRun=' + dry.v.dryRun + ' pathCount=' + dry.v.pathCount +
      ' est=' + (dry.v.estText || '0 B') + (dry.v.error ? ' error=' + dry.v.error : ''));
  // dry-run 必须零副作用：全部候选路径都还得在
  const dryPaths = dry.v.paths || [];
  for (const p of dryPaths) log('   候选: ' + p);
  const survivedDryRun = dryPaths.every(p => fs.existsSync(p));
  log('   dry-run 零副作用（候选仍全部存在）: ' + survivedDryRun);
  const before = dryPaths.filter(p => fs.existsSync(p)).length;

  log('== disk_clean confirm=true (junk-temp)');
  const real = await call('disk_clean', { type: 'junk-temp', confirm: true });
  const after = dryPaths.filter(p => fs.existsSync(p)).length;
  log('   ok=' + real.v.ok + ' executed=' + real.v.executed + '/' + real.v.total +
      ' freed=' + (real.v.freedText || '0 B') + ' | 候选存活数 ' + before + ' -> ' + after);
  if (real.v.note) log('   note: ' + real.v.note);
  if (real.v.rollbackHint) log('   回滚提示: ' + real.v.rollbackHint);

  log('== disk_recycle list（应能看到刚清理的项）');
  const rec = await call('disk_recycle', { cmd: 'list' });
  log('   toolMatched=' + rec.v.toolMatched + ' totalInBin=' + rec.v.totalInBin);
  if (rec.v.hint) log('   hint: ' + rec.v.hint);

  // 刚确认清理了 N 项，那么回收站里就必须能找回这 N 项。
  // 这里必须断言，否则匹配逻辑坏掉时（例如路径拼写不一致导致失配）
  // 测试会"静默通过"，把不可恢复的清理当成成功发布出去 —— 实测踩过。
  const cleanedCount = real.v.executed || 0;
  if (cleanedCount > 0 && (rec.v.toolMatched || 0) < cleanedCount) {
    throw new Error('清理了 ' + cleanedCount + ' 项，但 disk_recycle list 只匹配到 ' +
      (rec.v.toolMatched || 0) + ' 项 —— 这些项将无法通过本工具恢复。' +
      '回收站内共 ' + rec.v.totalInBin + ' 项。' + (rec.v.hint ? ' hint: ' + rec.v.hint : ''));
  }
  log('   匹配数与清理数一致（' + rec.v.toolMatched + ' >= ' + cleanedCount + '）');

  log('== disk_recycle restore dry-run');
  const rkeys = (rec.v.items || []).map(i => i.key);
  const rrestore = await call('disk_recycle', { cmd: 'restore', keys: rkeys });
  log('   ok=' + rrestore.v.ok + ' dryRun=' + rrestore.v.dryRun + ' wouldRestore=' + rrestore.v.wouldRestore + (rrestore.v.error ? ' error=' + rrestore.v.error : ''));
  if (!rrestore.v.dryRun) throw new Error('未确认的 restore 必须停留在 dry-run：' + JSON.stringify(rrestore.v).slice(0, 200));

  log('== disk_recycle restore confirm=true');
  const rreal = await call('disk_recycle', { cmd: 'restore', keys: rkeys, confirm: true });
  const restored = (rreal.v.results || []).filter(x => x.ok).map(x => x.restoredTo);
  log('   ok=' + rreal.v.ok + ' restored=' + rreal.v.restored + ' failed=' + rreal.v.failed);
  for (const p of restored) log('   已恢复到: ' + p + '（存在: ' + fs.existsSync(p) + '）');
  if (rkeys.length && (rreal.v.restored || 0) === 0) {
    throw new Error('有 ' + rkeys.length + ' 个候选 key 但一项都没恢复成功：' +
      JSON.stringify(rreal.v).slice(0, 300));
  }
  // 恢复必须真的把文件放回磁盘，而不只是回报 ok
  const missingOnDisk = restored.filter(p => !fs.existsSync(p));
  if (missingOnDisk.length) {
    throw new Error('报告已恢复但磁盘上不存在：' + missingOnDisk.join(', '));
  }

  log('== disk_dedup scan');
  const dd = await call('disk_dedup', { cmd: 'scan', roots: [root], minBytes: 1 });
  log('   ok=' + dd.v.ok + ' groups=' + dd.v.groupCount + ' scannedFiles=' + dd.v.scannedFiles +
      ' save=' + (dd.v.totalSaveText || '0 B') + (dd.v.error ? ' error=' + dd.v.error : ''));

  log('== disk_dedup hardlink dry-run');
  if (dd.v.groups && dd.v.groups.length) {
    const hd = await call('disk_dedup', { cmd: 'hardlink', groups: dd.v.groups });
    log('   dryRun=' + hd.v.dryRun + ' groups=' + hd.v.groups + ' wouldSave=' + (hd.v.wouldSaveText || '0 B'));
  } else {
    log('   （测试树内无重复组，跳过）');
  }

  log('== 安全负例（必须全被拒绝）');
  const neg = [
    ['受保护系统路径', { type: 'junk-temp', paths: ['C:\\Windows\\System32\\cmd.exe'], confirm: true }],
    ['OneDrive 云同步', { type: 'junk-temp', paths: [root + '\\OneDrive\\Temp'], confirm: true }],
    ['扫描范围外', { type: 'junk-temp', paths: ['C:\\definitely-outside'], confirm: true }],
    ['白名单外', { type: 'empty-dirs', paths: [root + '\\Documents\\note1.txt'], confirm: true }],
    ['非法清理类型', { type: 'rm-rf-everything' }],
  ];
  for (const n of neg) {
    const r = await call('disk_clean', n[1]);
    log('   ' + (r.isError ? 'REFUSED' : '!! NOT REFUSED !!') + ' ' + n[0] + ': ' + (r.v.error || JSON.stringify(r.v).slice(0, 90)));
  }

  log('== disk_audit（应记录真实操作）');
  const aud = await call('disk_audit', { limit: 10 });
  log('   total=' + aud.v.total);
  for (const e of aud.v.entries.slice(0, 5)) log('   ' + e.ts + ' ' + e.type + '/' + e.action + ' executed=' + e.executed + ' result=' + e.result);

  log('== 非法盘符（严格校验）');
  const badDrive = await call('disk_quota', { drive: 'nonsense' });
  log('   ' + (badDrive.isError ? 'REFUSED' : '!! NOT REFUSED !!') + ': ' + badDrive.v.error);

  child.stdin.end();
  await new Promise(function (r) { child.on('close', r); setTimeout(r, 5000) });

  log('\n== stdout 纯净性检查');
  const lines = out.split('\n').filter(Boolean);
  let bad = 0;
  for (const l of lines) { try { const m = JSON.parse(l); if (m.jsonrpc !== '2.0') bad++ } catch (e) { bad++ } }
  log('   ' + lines.length + ' 行响应，非协议行: ' + bad);
  log('== stderr（诊断信息，应非空但只出现在这里）');
  log('   ' + err.trim().split('\n').join('\n   '));

  try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (e) {}
  if (bad > 0) { console.error('FAIL: stdout 混入了非协议输出'); process.exit(1) }
  console.log('\nE2E PASS');
})().catch(function (e) {
  console.error('E2E FAIL: ' + (e && e.stack ? e.stack : String(e)));
  try { child.kill() } catch (e2) {}
  process.exit(1);
});
