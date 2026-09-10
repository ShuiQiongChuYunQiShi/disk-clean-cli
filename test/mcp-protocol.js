// test/mcp-protocol.js - MCP 协议一致性 + 工具安全闸门测试
//
// 覆盖两层：
//   A. 进程内协议层：initialize / ping / tools/list / tools/call、错误码、
//      注解透传、破坏性工具默认 dry-run、安全负例（受保护路径 / 云同步 / 出扫描范围 / 白名单外）。
//   B. 真实入口子进程：bin/disk-clean-mcp.js —— 验证 stdout 只输出合法 JSON-RPC
//      （一旦有 stray 输出就会破坏协议流，这是 MCP server 最容易踩的坑）。
//
// 隔离：把 USERPROFILE/HOME 指向临时目录，所有状态（~/.disk-clean）都落在沙箱里，
// 绝不触碰真实报告与审计日志。
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');

// ---- 隔离 HOME（必须在 require lib/* 之前设置）----
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-mcp-test-'));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;

const audit = require('../lib/audit.js');
const { createServer, ERR } = require('../lib/mcp/server.js');
const { tools, SERVER_INFO, canonKey } = require('../lib/mcp/tools.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }) } catch (e) { /* ignore */ } }

// ---- 路径归一化（回收站匹配的基础）----
// 审计日志记录的是调用方给的原样路径，回收站 $I 记录的是系统写入的规范路径，
// 两者拼写经常不同。下面这组用例覆盖真实失配来源；短名用例在支持 8.3 短名的卷上
// 会真正构造出第二种拼写，不支持时自动降级为其它用例（不影响结论）。
function testCanonKey() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-canon-'));
  try {
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });

    // 构造一个真实存在的 8.3 短名拼写
    function shortForm(longPath) {
      const parts = longPath.split('\\');
      for (let i = parts.length - 1; i >= 1; i--) {
        if (parts[i].length <= 6) continue;
        for (let n = 1; n <= 9; n++) {
          const cand = parts.slice(0, i).concat(parts[i].slice(0, 6).toUpperCase() + '~' + n, parts.slice(i + 1)).join('\\');
          if (cand.toLowerCase() !== longPath.toLowerCase() && fs.existsSync(cand)) return cand;
        }
      }
      return null;
    }

    const a = canonKey(path.join(root, 'sub'));
    assert(a === canonKey(root.toUpperCase() + '\\SUB'), '大小写归一');
    assert(a === canonKey(path.join(root, 'sub') + '\\'), '尾部分隔符归一');
    assert(a === canonKey(path.join(root, '.', 'sub')), '".\\" 归一');
    assert(a === canonKey(path.join(root, 'sub', '..', 'sub')), '".." 归一');

    // 已不存在（被清理掉）的路径同样要能归一 —— 这是回归重点：
    // 上一版只对父目录 realpath，而清理后父目录已不存在，导致两边各留各的拼写而失配。
    const goneA = canonKey(path.join(root, 'gone-sub', 'Temp'));
    const goneB = canonKey(path.join(root, 'GONE-SUB', 'temp') + '\\');
    assert(goneA === goneB, '不存在的路径也要归一一致（清理后的真实情形）');

    const short = shortForm(root);
    if (short) {
      assert(canonKey(path.join(short, 'sub')) === a, '8.3 短名与长名归一一致（存在时）');
      assert(canonKey(path.join(short, 'gone-sub', 'Temp')) === goneA, '8.3 短名与长名归一一致（不存在时）');
      return 'short-name cases run';
    }
    return 'short names unavailable on this volume';
  } finally {
    rmrf(root);
  }
}

// 与 test/clean-safety.js 同构的合成报告
function synthReport() {
  return {
    summary: { roots: ['C:\\TempZone\\'], totalFiles: 3, totalDirs: 2, totalBytes: 4096 },
    suggestions: [
      { type: 'junk-temp', estBytes: 1000, items: [{ label: '用户临时目录', bytes: 1000, count: 1 }], paths: ['C:\\TempZone\\Temp'] },
      { type: 'stale-large', estBytes: 500 * 1024 * 1024, items: [{ path: 'C:\\TempZone\\old.mkv', bytes: 500 * 1024 * 1024 }] },
      { type: 'duplicates', estBytes: 2048, groups: [{ size: 1024, keep: 'C:\\TempZone\\keep.txt', removable: ['C:\\TempZone\\dup.txt'], scope: 'user' }] }
    ],
    emptyDirSample: ['C:\\TempZone\\empty-dir'],
    junk: [{ label: '回收站', bytes: 4096 }],
    organizeCandidates: [],
  };
}

// ---------- 进程内协议夹具 ----------
function makeHarness() {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = new Map();
  const rawLines = [];
  let buf = '';
  output.on('data', function (d) {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      rawLines.push(line);
      let msg = null;
      try { msg = JSON.parse(line) } catch (e) { msg = null }
      if (msg && msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
        const r = pending.get(msg.id);
        pending.delete(msg.id);
        r(msg);
      }
    }
  });
  const server = createServer({
    tools: tools(),
    serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    input: input,
    output: output,
    log: function () {},
  });
  let nextId = 1;
  function rpc(method, params) {
    const id = nextId++;
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { reject(new Error('timeout: ' + method)) }, 30000);
      pending.set(id, function (m) { clearTimeout(t); resolve(m) });
      server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }));
    });
  }
  function raw(text) { server.handleLine(text) }
  function settle() { return new Promise(function (r) { setTimeout(r, 50) }) }
  return { server: server, rpc: rpc, raw: raw, settle: settle, rawLines: rawLines };
}

// 取 tools/call 的文本载荷（JSON.stringify(value,null,2)）
function payload(res) {
  assert(res && res.result && Array.isArray(res.result.content), 'result.content 数组存在');
  const text = res.result.content[0].text;
  try { return JSON.parse(text) } catch (e) { return { _raw: text } }
}
function toolError(res) {
  assert(res && res.result && res.result.isError === true, 'isError 应为 true，实际：' + JSON.stringify(res));
  return payload(res);
}
function toolOk(res) {
  assert(res && res.result && !res.result.isError, '不应是错误，实际：' + JSON.stringify(res).slice(0, 400));
  return payload(res);
}

async function main() {
  // ================= A. 进程内协议层 =================
  const h = makeHarness();

  // A-1. 路径归一化（回收站匹配的前提，不需要真实删除）
  const canonNote = testCanonKey();
  console.log('   路径归一化用例: ' + canonNote);

  // A0. 无报告时：依赖报告的工具必须明确报错并给出下一步
  const noReport = toolError(await h.rpc('tools/call', { name: 'disk_report', arguments: {} }));
  assert(/尚无扫描报告/.test(noReport.error) && /disk_scan/.test(noReport.error), 'A0 disk_report 无报告时给出提示');
  const noReportClean = toolError(await h.rpc('tools/call', { name: 'disk_clean', arguments: { type: 'junk-temp' } }));
  assert(/尚无扫描报告/.test(noReportClean.error), 'A0 disk_clean 无报告时拒绝');

  // A1. initialize 握手
  const init = await h.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert(init.result && init.result.protocolVersion === '2024-11-05', 'A1 protocolVersion');
  assert(init.result.serverInfo && init.result.serverInfo.name === 'disk-clean', 'A1 serverInfo.name');
  assert(init.result.capabilities && init.result.capabilities.tools, 'A1 tools capability');

  // A2. ping
  const ping = await h.rpc('ping', {});
  assert(ping.result && typeof ping.result === 'object', 'A2 ping 返回空对象');

  // A3. tools/list 结构与注解
  const list = (await h.rpc('tools/list', {})).result.tools;
  assert(Array.isArray(list) && list.length >= 12, 'A3 工具数 >=12，实际 ' + list.length);
  const names = list.map(function (t) { return t.name });
  assert(new Set(names).size === names.length, 'A3 工具名唯一');
  for (const t of list) {
    assert(typeof t.name === 'string' && t.name.indexOf('disk_') === 0, 'A3 命名前缀：' + t.name);
    assert(typeof t.description === 'string' && t.description.length > 40, 'A3 描述足够详细：' + t.name);
    assert(t.inputSchema && t.inputSchema.type === 'object', 'A3 inputSchema 是 object：' + t.name);
    assert(Array.isArray(t.inputSchema.required), 'A3 required 数组：' + t.name);
    for (const r of t.inputSchema.required) {
      assert(t.inputSchema.properties && t.inputSchema.properties[r], 'A3 required 字段有定义：' + t.name + '.' + r);
    }
    assert(t.annotations && typeof t.annotations.destructiveHint === 'boolean', 'A3 注解透传：' + t.name);
  }
  const byName = {};
  for (const t of list) byName[t.name] = t;
  assert(byName.disk_scan.annotations.readOnlyHint === true, 'A3 disk_scan 只读');
  assert(byName.disk_clean.annotations.destructiveHint === true, 'A3 disk_clean 破坏性');
  assert(byName.disk_organize.annotations.destructiveHint === true, 'A3 disk_organize 破坏性');
  assert(byName.disk_dedup.annotations.destructiveHint === true, 'A3 disk_dedup 破坏性');
  assert(byName.disk_health.annotations.readOnlyHint === true, 'A3 disk_health 只读');

  // A4. 错误码
  const unknown = await h.rpc('tools/call', { name: 'nope_tool', arguments: {} });
  assert(unknown.error && unknown.error.code === ERR.INVALID_PARAMS, 'A4 未知工具 -> -32602');
  const unknownMethod = await h.rpc('does/not/exist', {});
  assert(unknownMethod.error && unknownMethod.error.code === ERR.METHOD_NOT_FOUND, 'A4 未知方法 -> -32601');
  const noName = await h.rpc('tools/call', { arguments: {} });
  assert(noName.error && noName.error.code === ERR.INVALID_PARAMS, 'A4 缺 name -> -32602');
  h.raw('{ not json');
  await h.settle();
  const parseErr = JSON.parse(h.rawLines[h.rawLines.length - 1]);
  assert(parseErr.error && parseErr.error.code === ERR.PARSE, 'A4 坏 JSON -> -32700');
  h.raw(JSON.stringify({ id: 999, method: 'ping' }));
  await h.settle();
  const invalidReq = JSON.parse(h.rawLines[h.rawLines.length - 1]);
  assert(invalidReq.error && invalidReq.error.code === ERR.INVALID_REQUEST, 'A4 缺 jsonrpc -> -32600');

  // 写入合成报告：A0 之后再写，之后的工具都基于它
  audit.writeJson(audit.reportFile(), synthReport());

  // A5. 只读工具（不需要报告）
  const drives = toolOk(await h.rpc('tools/call', { name: 'disk_drives', arguments: {} }));
  assert(drives.ok && Array.isArray(drives.drives), 'A5 disk_drives 返回盘符数组');
  if (drives.drives.length) {
    const d0 = drives.drives[0];
    assert(typeof d0.totalBytes === 'number' && d0.totalBytes > 0, 'A5 容量为真实数值（非目录块数）');
    assert(d0.totalBytes >= d0.freeBytes, 'A5 total >= free');
    assert(typeof d0.usedText === 'string' && /[BKMG T]B/.test(d0.usedText.replace(' ', '')), 'A5 人类可读容量');
  }
  const cfg = toolOk(await h.rpc('tools/call', { name: 'disk_config', arguments: { cmd: 'get' } }));
  assert(cfg.ok && cfg.config && cfg.config.thresholds && cfg.config.thresholds.dupMinBytes === 1048576, 'A5 disk_config get 默认值');
  const badDrive = toolError(await h.rpc('tools/call', { name: 'disk_quota', arguments: { drive: 'nonsense' } }));
  assert(/无效盘符/.test(badDrive.error), 'A5 无效盘符被拒绝');
  const auditRes = toolOk(await h.rpc('tools/call', { name: 'disk_audit', arguments: {} }));
  assert(auditRes.ok && Array.isArray(auditRes.entries), 'A5 disk_audit 返回数组');

  // A6. 未确认的破坏性工具必须 dry-run
  const dedupNoRoots = toolError(await h.rpc('tools/call', { name: 'disk_dedup', arguments: { cmd: 'scan', roots: ['Z:\\nonexistent-root'] } }));
  assert(/不可访问/.test(dedupNoRoots.error), 'A6 dedup 根不可访问时拒绝（不静默返回 0 组）');
  const hlinkDry = toolOk(await h.rpc('tools/call', {
    name: 'disk_dedup', arguments: { cmd: 'hardlink', groups: [{ size: 10, files: [{ path: 'C:\\TempZone\\a', size: 10 }, { path: 'C:\\TempZone\\b', size: 10 }] }] },
  }));
  assert(hlinkDry.dryRun === true && hlinkDry.groups === 1, 'A6 hardlink 未确认 -> dry-run');
  const rbDry = toolOk(await h.rpc('tools/call', { name: 'disk_clean', arguments: { type: 'recycle-bin' } }));
  assert(rbDry.dryRun === true && rbDry.irreversible === true, 'A6 recycle-bin 未确认 -> dry-run 且标注不可恢复');
  assert(typeof rbDry.note === 'string' && /不可恢复/.test(rbDry.note), 'A6 recycle-bin 明示不可恢复');

  // A7. 报告类工具
  const rep0 = toolOk(await h.rpc('tools/call', { name: 'disk_report', arguments: {} }));
  assert(rep0.ok && rep0.summary && rep0.summary.totalBytes === 4096, 'A7 disk_report 读取合成报告');
  const repSum = toolOk(await h.rpc('tools/call', { name: 'disk_report', arguments: { section: 'summary' } }));
  assert(repSum.section === 'summary' && repSum.value.roots[0] === 'C:\\TempZone\\', 'A7 section 过滤');
  const repBad = toolError(await h.rpc('tools/call', { name: 'disk_report', arguments: { section: 'nonexistent' } }));
  assert(/无此字段/.test(repBad.error), 'A7 未知 section 报错');

  // A8. 安全负例：受保护路径 / 云同步 / 出扫描范围 / 白名单外
  const cases = [
    ['C:\\Windows\\System32\\kernel32.dll', /受保护的系统路径/, '受保护系统路径'],
    ['C:\\TempZone\\OneDrive\\temp', /OneDrive 云同步/, 'OneDrive 云同步'],
    ['D:\\Elsewhere\\Temp', /不在扫描范围内/, '出扫描范围'],
    ['C:\\TempZone\\not-in-whitelist', /不在建议清单|不在临时/, '白名单外'],
  ];
  for (const c of cases) {
    const r = toolError(await h.rpc('tools/call', { name: 'disk_clean', arguments: { type: 'junk-temp', paths: [c[0]], confirm: true } }));
    assert(c[1].test(r.error), 'A8 ' + c[2] + ' 被拒绝（实际：' + r.error + '）');
  }

  // A9. 白名单内 + 未确认 -> dry-run，且绝不产生审计记录
  const before = audit.readAudit().length;
  const dry = toolOk(await h.rpc('tools/call', { name: 'disk_clean', arguments: { type: 'junk-temp', paths: ['C:\\TempZone\\Temp'] } }));
  assert(dry.dryRun === true && dry.pathCount === 1, 'A9 白名单内未确认 -> dry-run');
  assert(audit.readAudit().length === before, 'A9 dry-run 不写审计日志');

  // A10. 类型缺少候选时明确报错（不静默跳过）
  const emptyCand = toolError(await h.rpc('tools/call', { name: 'disk_clean', arguments: { type: 'empty-dirs', paths: ['C:\\TempZone\\nope'] } }));
  assert(/不在空文件夹清单/.test(emptyCand.error), 'A10 empty-dirs 白名单外拒绝');

  // A11. organize plan（合成报告无散落目录 -> 空计划但 ok）
  const orgPlan = toolOk(await h.rpc('tools/call', { name: 'disk_organize', arguments: { cmd: 'plan' } }));
  assert(orgPlan.ok === true, 'A11 organize plan 可执行');
  const orgBad = toolError(await h.rpc('tools/call', { name: 'disk_organize', arguments: { cmd: 'apply', items: [] } }));
  assert(/缺少 items/.test(orgBad.error), 'A11 apply 缺 items 拒绝');
  const orgUnknown = toolError(await h.rpc('tools/call', { name: 'disk_organize', arguments: { cmd: 'nuke' } }));
  assert(/未知命令/.test(orgUnknown.error), 'A11 未知 cmd 拒绝');

  // A12. 非法枚举值
  const badType = toolError(await h.rpc('tools/call', { name: 'disk_clean', arguments: { type: 'everything' } }));
  assert(/未知清理类型/.test(badType.error), 'A12 非法清理类型拒绝');

  // ================= B. 真实入口子进程 =================
  const entry = path.join(__dirname, '..', 'bin', 'disk-clean-mcp.js');
  const child = spawn(process.execPath, [entry], {
    env: Object.assign({}, process.env, { USERPROFILE: TMP_HOME, HOME: TMP_HOME }),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '', errOut = '';
  child.stdout.on('data', function (d) { out += d.toString('utf8') });
  child.stderr.on('data', function (d) { errOut += d.toString('utf8') });
  function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n') }
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'disk_drives', arguments: {} } });
  child.stdin.end();
  const exitCode = await new Promise(function (resolve) {
    const t = setTimeout(function () { try { child.kill() } catch (e) {} resolve('timeout') }, 60000);
    child.on('close', function (code) { clearTimeout(t); resolve(code) });
  });

  assert(exitCode === 0, 'B stdin 关闭后应正常退出（实际 ' + exitCode + '）');
  assert(/ready:/.test(errOut), 'B 启动信息走 stderr');
  const lines = out.split('\n').filter(function (l) { return l.trim() });
  assert(lines.length === 3, 'B stdout 只应有 3 条协议响应，实际 ' + lines.length + '：' + out.slice(0, 300));
  const msgs = lines.map(function (l) {
    let m = null;
    try { m = JSON.parse(l) } catch (e) { throw new Error('B stdout 出现非 JSON 行（会破坏协议流）：' + l) }
    assert(m && m.jsonrpc === '2.0', 'B 每行都是 JSON-RPC 2.0');
    return m;
  });
  const byId = {};
  for (const m of msgs) byId[m.id] = m;
  assert(byId[1] && byId[1].result && byId[1].result.serverInfo.name === 'disk-clean', 'B 子进程 initialize');
  assert(byId[2] && byId[2].result.tools.length >= 12, 'B 子进程 tools/list');
  assert(byId[3] && byId[3].result && !byId[3].result.isError, 'B 子进程 tools/call disk_drives');

  console.log('PASS mcp-protocol: ' + list.length + ' tools, 协议/注解/错误码/安全负例/路径归一化/子进程 stdout 纯净性 均通过');
}

main().then(function () {
  rmrf(TMP_HOME);
  process.exit(0);
}).catch(function (e) {
  rmrf(TMP_HOME);
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
