// test/approval-gate.js — 发布审批门禁的行为验证（S4）
//
// 为什么门禁必须有测试：
//   参考项目（navigator）的教训是——**只有脚本级拦截是真的，而它家真正的拦截机制
//   恰恰是"以为有、其实早已失效"**：那个 deploy-guard 插件的正则只匹配已经删掉的旧
//   脚本，对现役命令毫无作用，团队却在"有防护"的错觉里运行了很久。
//   一个门禁如果只能靠"发布前手工点一次"来确认它有效，那么它一旦被改坏，
//   没有任何东西会告诉你——直到某次真的不该发的东西被发出去。
//
// 所以这里逐条验证"什么必须被拦、什么才该放行"。被测对象是 validateDoc：
// 判定逻辑与文件系统分离，因此本套件不碰真实审批目录（DSK_APPROVAL_DIR 都不用设，
// 因为纯函数根本不读文件），也不要求构建产物存在。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const approval = require('../scripts/approval.js');

const VERSION = '0.7.1';
const NOW = Date.parse('2026-09-12T12:00:00Z');
const TTL = 30;

// 假产物：两个"文件"，内容由我们控制，哈希即内容哈希
const FILES = {
  'C:/fake/disk-clean-win-x64.exe': 'ENGINE-BYTES',
  'C:/fake/disk-clean-setup-0.7.1.exe': 'INSTALLER-BYTES',
};
const PRIMARY = [
  { name: 'disk-clean-win-x64.exe', path: 'C:/fake/disk-clean-win-x64.exe', role: 'engine', producer: 'scripts/build-sea.ps1' },
  { name: 'disk-clean-setup-0.7.1.exe', path: 'C:/fake/disk-clean-setup-0.7.1.exe', role: 'installer', producer: 'scripts/build-installer.ps1' },
];
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
const HASH = {
  'C:/fake/disk-clean-win-x64.exe': sha('ENGINE-BYTES'),
  'C:/fake/disk-clean-setup-0.7.1.exe': sha('INSTALLER-BYTES'),
};

function validate(doc, over) {
  const o = Object.assign({
    version: VERSION,
    ttlMinutes: TTL,
    primary: PRIMARY,
    hashOf: (p) => HASH[p],
    exists: (p) => Object.prototype.hasOwnProperty.call(FILES, p),
    now: NOW,
  }, over || {});
  return approval.validateDoc(doc, o);
}

// 一份完全合法的审批
function goodDoc(over) {
  return Object.assign({
    kind: 'release',
    version: VERSION,
    artifacts: {
      'disk-clean-win-x64.exe': { sha256: HASH['C:/fake/disk-clean-win-x64.exe'], size: 12, role: 'engine' },
      'disk-clean-setup-0.7.1.exe': { sha256: HASH['C:/fake/disk-clean-setup-0.7.1.exe'], size: 15, role: 'installer' },
    },
    confirmedBy: '张三',
    confirmedAt: new Date(NOW - 5 * 60000).toISOString(),
    note: '',
  }, over || {});
}

const results = [];
function it(name, fn) {
  try { fn(); results.push({ name: name, ok: true }); }
  catch (e) { results.push({ name: name, ok: false, err: (e && e.message) || String(e) }); }
}

// ---------------------------------------------------------------- 应当放行
it('合法审批（5 分钟前、产物哈希一致）', () => {
  const r = validate(goodDoc());
  assert(r.ok, '应当放行，实际被拦：' + r.reason + ' / ' + r.detail);
  assert(r.by === '张三', '应记录批准人');
});

it('边界：恰好 29 分钟前批准仍在有效期内', () => {
  const r = validate(goodDoc({ confirmedAt: new Date(NOW - 29 * 60000).toISOString() }));
  assert(r.ok, '29 分钟应当仍有效，实际被拦：' + r.reason);
});

// ---------------------------------------------------------------- 应当拦截
it('拦截：没有审批文件', () => {
  // 走 IO 版本，指向一个必然不存在的版本号
  const r = approval.validate('9.9.9', TTL);
  assert(!r.ok, '没有审批文件时竟然放行');
  assert(r.reason === '没有审批文件', '拒绝理由应为"没有审批文件"，实际：' + r.reason);
});

it('拦截：审批文件不是合法 JSON（不得静默放行）', () => {
  const r = validate(null);
  assert(!r.ok, 'null 应当被拦');
  const r2 = validate('not an object');
  assert(!r2.ok, '字符串应当被拦');
});

it('拦截：kind 不是 release', () => {
  const r = validate(goodDoc({ kind: 'hotfix' }));
  assert(!r.ok && r.reason === 'kind 不匹配', '实际：' + r.reason);
});

it('拦截：版本不匹配（这就是参考项目 C4 的错误——批准写成 "manual"）', () => {
  const r = validate(goodDoc({ version: 'manual' }));
  assert(!r.ok, '"manual" 版本竟然放行（那会让审批永远无法复用，等于门禁失效）');
  assert(r.reason === '审批版本不匹配', '实际：' + r.reason);
});

it('拦截：版本写成 all / 通配', () => {
  assert(!validate(goodDoc({ version: 'all' })).ok, '"all" 竟然放行');
  assert(!validate(goodDoc({ version: '0.7.x' })).ok, '通配竟然放行');
  assert(!validate(goodDoc({ version: '0.7.10' })).ok, '前缀相同但不同的版本竟然放行');
});

it('拦截：没有记录批准人', () => {
  assert(!validate(goodDoc({ confirmedBy: '' })).ok, '空批准人竟然放行');
  assert(!validate(goodDoc({ confirmedBy: '   ' })).ok, '空白批准人竟然放行');
  delete goodDoc().confirmedBy;
  const d = goodDoc(); delete d.confirmedBy;
  assert(!validate(d).ok, '缺 confirmedBy 竟然放行');
});

it('拦截：批准时间非法或在未来', () => {
  assert(!validate(goodDoc({ confirmedAt: 'yesterday' })).ok, '非法时间竟然放行');
  assert(!validate(goodDoc({ confirmedAt: new Date(NOW + 60 * 60000).toISOString() })).ok,
    '未来 1 小时的批准竟然放行');
});

it('拦截：审批过期（31 分钟，超过 30 分钟 TTL）', () => {
  const r = validate(goodDoc({ confirmedAt: new Date(NOW - 31 * 60000).toISOString() }));
  assert(!r.ok, '31 分钟前批准竟然仍有效');
  assert(r.reason === '审批已过期', '实际：' + r.reason);
  assert(/31 分钟/.test(r.detail), '过期理由应给出实际时长，实际：' + r.detail);
});

it('拦截：审批没有绑定任何产物', () => {
  assert(!validate(goodDoc({ artifacts: {} })).ok, '空 artifacts 竟然放行');
  const d = goodDoc(); delete d.artifacts;
  assert(!validate(d).ok, '缺 artifacts 竟然放行');
});

it('拦截：审批漏掉了某个产物', () => {
  const d = goodDoc();
  delete d.artifacts['disk-clean-setup-0.7.1.exe'];
  const r = validate(d);
  assert(!r.ok, '只批准了引擎、漏掉安装器，竟然放行');
  assert(r.reason === '审批漏了产物', '实际：' + r.reason);
});

it('拦截：审批里有清单外的产物（清单与审批不一致）', () => {
  const d = goodDoc();
  d.artifacts['sneaky-extra.exe'] = { sha256: 'x' };
  const r = validate(d);
  assert(!r.ok && r.reason === '审批里有清单外的产物', '实际：' + r.reason);
});

it('拦截：产物在批准后被改动（本门禁最核心的一条）', () => {
  // 这正是"批准的是字节，不是版本号"的验证点：版本没变、哈希变了 → 必须重批
  const d = goodDoc();
  d.artifacts['disk-clean-win-x64.exe'].sha256 = sha('SOMETHING-ELSE');
  const r = validate(d);
  assert(!r.ok, '产物被换掉却仍然放行——门禁失去意义');
  assert(r.reason === '产物在批准后被改动', '实际：' + r.reason);
  assert(/批准时/.test(r.detail) && /现在/.test(r.detail), '拒绝理由应同时给出两个哈希，实际：' + r.detail);
});

it('拦截：产物文件已不存在', () => {
  const r = validate(goodDoc(), { exists: () => false });
  assert(!r.ok && r.reason === '产物缺失', '实际：' + r.reason);
});

it('拦截：TTL 收紧后同一份审批失效（有效期由清单声明，不由批准方决定）', () => {
  const d = goodDoc({ confirmedAt: new Date(NOW - 10 * 60000).toISOString() });
  assert(validate(d, { ttlMinutes: 30 }).ok, 'TTL=30 时 10 分钟前的批准应有效');
  assert(!validate(d, { ttlMinutes: 5 }).ok, 'TTL=5 时 10 分钟前的批准应失效');
});

// ---------------------------------------------------------------- 参数层
it('拒绝 --yes / --force 之类的旁路开关', () => {
  const { execFileSync } = require('child_process');
  for (const flag of ['--yes', '--force', '--skip-approval']) {
    let code = 0, out = '';
    try {
      out = execFileSync(process.execPath,
        [path.join(ROOT, 'scripts', 'approval.js'), 'check', '--version', VERSION, flag],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = e.status === null ? -1 : e.status;
      out = String(e.stdout || '') + String(e.stderr || '');
    }
    assert(code !== 0, flag + ' 竟然没有让门禁报错（存在旁路就等于没有门禁）');
    assert(out.indexOf('不能用于审批') >= 0, flag + ' 的报错应说明它不能代替审批，实际：' + out.trim().slice(0, 120));
  }
});

it('审批版本必须与 lib/version.js 一致', () => {
  const { execFileSync } = require('child_process');
  const versionLib = require('../lib/version.js');
  const bogus = versionLib.VERSION === '9.9.9' ? '8.8.8' : '9.9.9';
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath,
      [path.join(ROOT, 'scripts', 'approval.js'), 'check', '--version', bogus],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status === null ? -1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  assert(code !== 0, '审批版本与源码版本不一致时应当失败');
  assert(out.indexOf('不一致') >= 0, '应当说明版本不一致，实际：' + out.trim().slice(0, 120));
});

it('审批渠道：旧文件视为交互、--session 如实标注、乱填值归一化', () => {
  // 为什么要这一条：审批文件记录"同意是从哪来的"（本机键盘键入，还是会话中明确同意）。
  // 它防的不是别人，而是**把会话同意标成本机交互确认**——那是伪造证据，
  // 而伪造的证据比没有证据更糟，因为它看起来更硬。
  assert(validate(goodDoc()).channel === 'interactive',
    '没有 channel 字段的旧审批文件应视为交互确认（那时只有那一条路径）');
  assert(validate(goodDoc({ channel: 'interactive' })).channel === 'interactive', 'interactive 应被识别');
  assert(validate(goodDoc({ channel: 'session' })).channel === 'session', 'session 应被识别');
  assert(validate(goodDoc({ channel: 'trust-me' })).channel === 'interactive',
    '未知渠道值必须归一化为 interactive —— 乱填一个名字不该换来更可信的标记');
  assert(validate(goodDoc({ channel: 'SESSION' })).channel === 'interactive',
    '渠道匹配区分大小写，避免拼写差异产生"看起来是但又不太是"的第三种状态');
});

it('发布脚本：资产名必须展开 ${version} 占位符（v0.7.1 已发布缺陷）', () => {
  // v0.7.1 实际发出去的文件里带着字面量 `disk-clean-setup-${version}.exe`：
  // 清单的 name 和 path 都写了 ${version} 占位符，但脚本只展开了 path。
  // 后果有两层——远端资产查不到（报成一句莫名其妙的 "remote setup size != local"），
  // 以及**把未展开的占位符写进了已发布的 checksums.txt 与 SHA256SUMS.txt**。
  // 后者才是真问题：用户拿到的是自相矛盾的校验文件。
  // 所以这里静态禁止"直接拿 $xxxAsset.name 当远端名"，必须经 ManifestName 展开。
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-release.ps1'), 'utf8');
  const offenders = (src.match(/=\s*\$\w+Asset\.name/g) || []);
  assert(offenders.length === 0,
    '发布脚本里出现了未展开的资产名赋值（' + offenders.join(', ') +
    '）——必须写成 `ManifestName $xxxAsset`，否则 ${version} 会原样写进发布产物');
  assert(/function ManifestName/.test(src), '发布脚本应提供 ManifestName 来展开资产名');
});

it('门禁位置：approval check 必须排在任何写操作之前', () => {
  // 门禁"存在"和门禁"在正确的位置"是两件事。若有人把审批检查挪到创建 tag 之后，
  // 门禁依然会拦住本次发布，但**已经在远端留下了 tag**——不可逆的副作用先发生了。
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-release.ps1'), 'utf8');
  const lines = src.split(/\r?\n/);
  const gateAt = lines.findIndex((l) => l.indexOf('approval.js') >= 0);
  assert(gateAt >= 0, 'publish-release.ps1 里没有调用 approval.js —— 发布流程没有审批门禁');
  const WRITE_VERBS = ["'push'", "'tag'", "'create'", "'upload'", "'edit'", "'delete'"];
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('RunNative') < 0) continue;
    if (!WRITE_VERBS.some((v) => lines[i].indexOf(v) >= 0)) continue;
    if (i < gateAt) offenders.push('第 ' + (i + 1) + ' 行：' + lines[i].trim());
  }
  assert(offenders.length === 0,
    '这些写操作排在审批门禁之前，未获批准的发布也会先产生副作用：\n      ' + offenders.join('\n      '));
});

// ---------------------------------------------------------------- 结果
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (!r.ok) console.log('  x ' + r.name + '\n      ' + r.err);
}
if (failed.length) throw new Error('FAIL: ' + failed.length + '/' + results.length + ' 项审批门禁断言未通过');
console.log('PASS approval-gate: ' + results.length + ' 项断言（放行 2 项、拦截 ' +
  (results.length - 2) + ' 项）；产物哈希绑定、版本精确匹配、30 分钟时效、无旁路开关均已验证');
