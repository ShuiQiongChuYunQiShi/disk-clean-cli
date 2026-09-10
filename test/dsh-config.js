// test/dsh-config.js — 验证 README 里给 DSH 的那段 cordis.yml 配置真的可用
//
// 为什么要测"文档里的配置"：v0.5.0 删掉了 DSH 专有插件形态，改用一行
// `@deepseek-ai/dsh-mcp-client` 配置接入。这段配置成了唯一的 DSH 接入路径，
// 一旦路径写错、工具公开名不合法、或安全语义在换客户端后丢失，用户是照着文档踩坑的。
// 与其人工试，不如让它可执行：
//   1) 按 README 写的 command/args 真的把 server 拉起来
//   2) 走 DSH/SDK 的握手顺序 initialize -> notifications/initialized -> tools/list
//   3) 断言 DSH 会给工具起的公开名 `mcp__<serverName>__<rawName>` 合法且唯一，
//      并用公开名反查原始名真实调用一次
//   4) 断言破坏性工具经由这条通道仍然默认 dry-run（安全语义不因换客户端而丢）
//   5) 断言 stdout 只有协议行（DSH 的 SDK 也是逐行 JSON 解析）
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const repo = path.join(__dirname, '..');
const SERVER_NAME = 'disk-clean';

// —— 与 README 的 DSH 配置块严格对应 ——
const config = {
  serverName: SERVER_NAME,
  transport: 'stdio',
  command: 'node',
  args: [path.join(repo, 'bin', 'disk-clean-mcp.js')],
};
console.log('# DSH config under test:');
console.log('  serverName: ' + config.serverName);
console.log('  transport : ' + config.transport);
console.log('  command   : ' + config.command);
console.log('  args      : ' + JSON.stringify(config.args));

// DSH 的 publicToolName 规则：mcp__<serverName>__<rawName>
// （见 @deepseek-ai/dsh-mcp-client：字符替换后会追加 sha256 前缀消歧，
//   本项目的工具名与 serverName 全为 [a-z0-9_] 安全字符，走"clean case"）
function publicToolName(rawName) { return 'mcp__' + SERVER_NAME + '__' + rawName }

// 参数文件必须存在（配置写错路径时这里就该失败，这正是文档最容易出错的地方）
for (const a of config.args) {
  if (a.endsWith('.js')) assert(fs.existsSync(a), '配置里的脚本路径不存在：' + a);
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-dsh-cfg-'));
// 预置一份合成报告（落在子进程隔离的 HOME 下），这样破坏性工具能走到真正的
// dry-run 分支，而不是提前因"无报告"返回 —— 否则安全语义根本没被验证。
fs.mkdirSync(path.join(HOME, '.disk-clean'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.disk-clean', 'report.json'), JSON.stringify({
  summary: { roots: ['C:\\Users\\Test\\'], totalFiles: 1, totalDirs: 1, totalBytes: 1024 },
  suggestions: [{ type: 'junk-temp', estBytes: 1024, items: [{ label: 't', bytes: 1024, count: 1 }], paths: ['C:\\Users\\Test\\AppData\\Local\\Temp'] }],
  emptyDirSample: [],
  junk: [],
}), 'utf8');

const child = spawn(config.command, config.args, {
  env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME: HOME }),
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
});

let buf = '', out = '', errOut = '';
const pending = new Map();
child.stdout.on('data', function (d) {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    out += line + '\n';
    const m = JSON.parse(line);
    if (m.id != null && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m) }
  }
});
child.stderr.on('data', function (d) { errOut += d.toString('utf8') });

let id = 0;
function rpc(method, params) {
  const myId = ++id;
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error('timeout: ' + method)) }, 60000);
    pending.set(myId, function (m) { clearTimeout(t); resolve(m) });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method: method, params: params }) + '\n');
  });
}

(async function () {
  // 1) DSH/SDK 握手顺序：initialize -> notifications/initialized -> tools/list
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'dsh-mcp-client', version: '1' },
  });
  assert(init.result && init.result.serverInfo, 'initialize 返回 serverInfo');
  assert(init.result.serverInfo.name === SERVER_NAME, 'serverInfo.name 与 serverName 一致：' + init.result.serverInfo.name);
  console.log('# initialize ok: ' + init.result.serverInfo.name + ' v' + init.result.serverInfo.version +
    ' protocol ' + init.result.protocolVersion);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = (await rpc('tools/list', {})).result.tools;
  assert(list.length >= 10, 'tools/list 至少 10 个工具');
  console.log('# tools/list ok: ' + list.length + ' 个');

  // 2) DSH 会注册成什么名字：逐个校验公开名合法且唯一
  const publicNames = list.map(function (t) { return publicToolName(t.name) });
  assert(new Set(publicNames).size === publicNames.length, '公开名唯一');
  for (const n of publicNames) {
    assert(/^[a-zA-Z0-9_-]{1,64}$/.test(n), '公开名符合函数名规范：' + n);
  }
  console.log('# DSH 侧将看到：' + publicNames.slice(0, 3).join(', ') + ' … (共 ' + publicNames.length + ')');

  // 3) 经公开名反查原始名并真实调用（这就是 DSH 内部做的事）
  const targetPublic = publicToolName('disk_drives');
  const raw = list.find(function (t) { return publicToolName(t.name) === targetPublic });
  assert(raw, '能用公开名反查到 disk_drives');
  const res = await rpc('tools/call', { name: raw.name, arguments: {} });
  assert(res.result && !res.result.isError, 'disk_drives 调用成功');
  const payload = JSON.parse(res.result.content[0].text);
  assert(payload.ok === true && Array.isArray(payload.drives), '返回结构化盘符数据');
  console.log('# tools/call ok 经 ' + targetPublic + ' -> ' + raw.name +
    '：' + payload.drives.length + ' 个盘，首个 ' + (payload.drives[0] ? payload.drives[0].drive + ' ' + payload.drives[0].usedText + '/' + payload.drives[0].totalText : 'n/a'));

  // 4) 破坏性工具经 DSH 通道也必须默认 dry-run（安全语义不能因为换了客户端就丢）
  const rb = await rpc('tools/call', { name: 'disk_clean', arguments: { type: 'recycle-bin' } });
  const rbPayload = JSON.parse(rb.result.content[0].text);
  assert(rbPayload.dryRun === true && rbPayload.ok === true,
    'recycle-bin 未确认时必须是 dry-run 成功预览（实际：' + JSON.stringify(rbPayload).slice(0, 160) + '）');
  assert(rbPayload.irreversible === true, 'recycle-bin 必须标注不可恢复');
  assert(typeof rbPayload.itemCount === 'number' || rbPayload.itemCount === null, 'recycle-bin 必须回报真实条目数');
  console.log('# 安全语义保持：recycle-bin 未确认 -> dryRun=true, irreversible=true, itemCount=' + rbPayload.itemCount);

  // 4b) 且必须显式提示需要 confirm
  assert(typeof rbPayload.next === 'string' && /confirm/.test(rbPayload.next), 'dry-run 结果必须提示如何确认');

  child.stdin.end();
  await new Promise(function (r) { child.on('close', r); setTimeout(r, 4000) });

  // 5) stdout 纯净性（DSH 的 SDK 解析器同样逐行 JSON）
  const lines = out.split('\n').filter(Boolean);
  assert(lines.length === 4, '响应行数应为 4（initialize/tools-list/2×tools-call），实际 ' + lines.length);
  for (const l of lines) assert(JSON.parse(l).jsonrpc === '2.0', '每行都是 JSON-RPC');
  assert(/ready:/.test(errOut), '启动诊断走 stderr');

  try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  console.log('\nPASS dsh-config: README 里的 DSH 配置可直接使用，' + list.length + ' 个工具以 mcp__' + SERVER_NAME + '__<name> 暴露');
})().catch(function (e) {
  console.error('FAIL: ' + (e && e.message ? e.message : String(e)));
  try { child.kill() } catch (e2) { /* ignore */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (e2) { /* ignore */ }
  process.exit(1);
});
