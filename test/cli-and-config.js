// test/cli-and-config.js — v0.7.0 的 CLI 命令面与配置契约回归
//
// 本套件守住 v0.7.0 修的那批"代码在骗调用方 / 同一动作不同入口不一致"的问题，
// 每一条都对应一个已确认的真实缺陷：
//
//   v7-5  config.blacklist 是死配置，却在 MCP 工具描述里被承诺 → 已删除
//   v7-6  retention.auditLines 永不生效（audit 硬编码 2000）        → 现真正生效
//   v7-3  dedup rollback 不要求 --yes（organize rollback 却要求）    → 现统一
//   v7-4  CLI clean 缺 stale-large 分支（MCP 却支持）               → 现补上
//   v7-9  CLI 没有 drives 命令；盘符容量有两份实现                   → 现单源 + 新命令
//   v7-2  每个 victim 一次 PowerShell（141ms）                      → 现 fs.linkSync（<1ms）
//   v7-7  跨盘 copy 成功但源未删 → 双份副本不被告知                  → 现显式上报
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const repo = path.join(__dirname, '..');
const cli = path.join(repo, 'bin', 'disk-clean.js');

function runCli(args, home) {
  return execFileSync('node', [cli].concat(args), {
    encoding: 'utf8', timeout: 120000, windowsHide: true,
    env: Object.assign({}, process.env, { USERPROFILE: home, HOME: home }),
  });
}

(async () => {
  let n = 0;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-v07-home-'));
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-v07-tree-'));
  const prevHome = os.homedir();
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    // ============ v7-5：blacklist 必须已从配置与工具描述中消失 ============
    const config = require('../lib/config.js');
    const def = config.DEFAULT_CONFIG;
    assert(!('blacklist' in def), 'v7-5 DEFAULT_CONFIG 不应再有 blacklist 字段');
    const toolsSrc = fs.readFileSync(path.join(repo, 'lib', 'mcp', 'tools.js'), 'utf8');
    assert(!/blacklist/.test(toolsSrc), 'v7-5 MCP 工具描述不应再承诺 blacklist');
    // 但保留解释性注释是允许的（防止后人以为漏删又加回去）
    const cfgSrc = fs.readFileSync(path.join(repo, 'lib', 'config.js'), 'utf8');
    assert(/blacklist[\s\S]{0,120}从未被任何引擎代码读取/.test(cfgSrc), 'v7-5 应保留"为何删除"的说明注释');
    n++;

    // ============ T4：同类问题按**类别**清查，不逐项修 ============
    // v0.7.0 只处理了 blacklist，同一批里的 junkRules / organizeRules 漏了网，
    // 而且在同一版又被 MCP 工具描述承诺了一遍。这次一次清掉，
    // 并断言"被删掉的能力不得卷土重来"——包括描述里不得再提、删除理由必须留档。
    for (const key of ['junkRules', 'organizeRules']) {
      assert(!(key in def), 'T4 DEFAULT_CONFIG 不应再有 ' + key + ' 字段');
      assert(!new RegExp(key).test(toolsSrc), 'T4 MCP 工具描述不应再提及 ' + key);
      assert(new RegExp(key + '[\\s\\S]{0,400}要么实现').test(cfgSrc),
        'T4 config.js 应保留 ' + key + ' 的删除说明（否则后人会以为漏删又加回去）');
    }
    // 报告历史在 v0.7.1 真正接线了，所以未接线名单里不应再留着它
    assert(!config.UNIMPLEMENTED.some(function (u) { return u.path === 'retention.reports'; }),
      'T4 retention.reports 已实现，不应再登记为未接线');
    n++;

    // ============ 凭据入口：环境变量优先、文件回退、永不回显 ============
    // 起因（实测）：Windows 用户级环境变量只在进程启动时快照，设好之后已经在运行的
    // 会话（及其 spawn 的子进程）读不到，于是反复出现"我明明设过了，脚本还说没设"。
    // 凭据文件就是为了消掉这个问题，所以它的解析规则必须有测试守着。
    {
      const cred = require('../scripts/credentials.js');
      const credFile = cred.credentialsFile();
      const savedEnv = process.env.GH_TOKEN;
      delete process.env.GH_TOKEN;
      try {
        assert(!fs.existsSync(credFile), '隔离 HOME 下不应已有凭据文件（否则测试会污染真实凭据）');
        assert(!cred.ghToken().value, '没有凭据时应返回空值');
        assert(!cred.describe().keys.GH_TOKEN.present, 'describe 应如实报"未设置"');

        // 写入后能读回，来源标记为 file
        const saved = cred.save({ GH_TOKEN: 'gh-test-value', NPM_TOKEN: 'npm-test-value' });
        assert(saved.ok, 'save 应成功：' + saved.error);
        assert(cred.ghToken().source === 'file' && cred.ghToken().value === 'gh-test-value',
          '应从凭据文件读回写入的值');

        // 环境变量优先（CI 与临时覆盖依赖这一条）
        process.env.GH_TOKEN = 'from-env';
        assert(cred.ghToken().source === 'env' && cred.ghToken().value === 'from-env',
          '环境变量必须优先于凭据文件');
        delete process.env.GH_TOKEN;
        assert(cred.ghToken().source === 'file', '删掉环境变量后应回落到凭据文件');

        // 只更新一个键不得抹掉另一个（否则换 GH token 会把 npm 一起清空）
        cred.save({ GH_TOKEN: 'gh-test-2' });
        assert(cred.npmToken().value === 'npm-test-value', 'save 不应抹掉未传入的键');

        // describe 用于 doctor 显示状态，绝不能泄露内容
        const desc = JSON.stringify(cred.describe());
        assert(desc.indexOf('gh-test-2') < 0 && desc.indexOf('npm-test-value') < 0,
          'describe 绝不能包含凭据内容：' + desc);

        // 文件损坏时如实报错，而不是假装"没设置"——否则会让人反复设置一个已写坏的文件
        fs.writeFileSync(credFile, '{ this is not json', 'utf8');
        const broken = cred.describe();
        assert(broken.fileError, '凭据文件损坏时应报出解析错误');
        assert(!broken.keys.GH_TOKEN.present, '损坏时值应为空');

        // 空值不得被当成有效凭据写入
        fs.unlinkSync(credFile);
        assert(!cred.save({ GH_TOKEN: '   ', NPM_TOKEN: '' }).ok, '全空输入应拒绝写入');
      } finally {
        try { fs.unlinkSync(credFile); } catch (e) { /* ignore */ }
        if (savedEnv) process.env.GH_TOKEN = savedEnv;
      }
    }
    n++;

    // ============ T5：建议行必须显示 title，而不是 [type] type 这种重复 ============
    // 起因：CLI 读的是 `s.label`，而建议对象里的字段名是 `title`（Markdown 与 MCP 都用对了，
    // 只有这一处读错），于是回落到 type，输出了 `[junk-temp] junk-temp`。
    // README 里记录的 `[organize-folders] 目录整理建议` 一直是对的——错的是代码。
    {
      const repFile = path.join(tree, 'suggest.json');
      fs.writeFileSync(repFile, JSON.stringify({
        generatedAt: new Date().toISOString(),
        tool: { name: 'disk-clean', version: 'test' },
        summary: { roots: ['D:\\'], totalBytes: 1024, totalFiles: 1, totalDirs: 1, status: 'done' },
        category: [],
        suggestions: [
          { type: 'organize-folders', title: '目录整理建议', risk: 'low', items: [{ path: 'D:\\a', bytes: 100 }] },
          { type: 'junk-temp', title: '清理临时与缓存文件', risk: 'low', items: [{ path: 'D:\\t', bytes: 50 }] },
        ],
      }), 'utf8');
      const out = runCli(['report', repFile], home);
      assert(out.indexOf('目录整理建议') >= 0, 'T5 建议行应显示 title，实际输出：\n' + out);
      assert(out.indexOf('清理临时与缓存文件') >= 0, 'T5 每条建议都应显示 title');
      assert(!/\[organize-folders\]\s+organize-folders/.test(out),
        'T5 不应再出现 [type] type 这种无意义重复，实际输出：\n' + out);
      assert(!/\[junk-temp\]\s+junk-temp/.test(out), 'T5 同上（junk-temp）');
    }
    n++;

    // ============ v7-6：retention.auditLines 必须真正生效 ============
    const audit = require('../lib/audit.js');
    assert(typeof audit.maxAuditLines === 'function', 'v7-6 应导出 maxAuditLines 以便验证');
    // 默认配置 → 取 config 里的 5000（而非旧硬编码 2000）
    assert(audit.maxAuditLines() === 5000, 'v7-6 默认应读 config 的 5000，实际 ' + audit.maxAuditLines());
    // 写一份自定义 config → 立即生效（惰性读取，无需重启）
    fs.mkdirSync(path.join(home, '.disk-clean'), { recursive: true });
    fs.writeFileSync(path.join(home, '.disk-clean', 'config.json'),
      JSON.stringify({ retention: { auditLines: 123 } }), 'utf8');
    assert(audit.maxAuditLines() === 123, 'v7-6 改了 config 应立即生效，实际 ' + audit.maxAuditLines());
    // 非法值回落默认，不能返回 0/NaN（那会让轮转把日志清空）
    fs.writeFileSync(path.join(home, '.disk-clean', 'config.json'),
      JSON.stringify({ retention: { auditLines: 0 } }), 'utf8');
    assert(audit.maxAuditLines() === audit.DEFAULT_MAX_AUDIT_LINES, 'v7-6 非法值应回落默认值');
    fs.unlinkSync(path.join(home, '.disk-clean', 'config.json'));
    n++;

    // ============ v7-9：drives 单源 + 命令存在 ============
    const drivesLib = require('../lib/drives.js');
    const list = drivesLib.list();
    assert(Array.isArray(list) && list.length > 0, 'v7-9 drives.list() 应返回至少一个盘');
    const d0 = list[0];
    for (const k of ['drive', 'totalBytes', 'usedBytes', 'freeBytes', 'availBytes', 'totalText', 'usedText']) {
      assert(d0[k] !== undefined, 'v7-9 drives.list() 缺字段 ' + k);
    }
    assert(/^[A-Z]:$/.test(d0.drive), 'v7-9 drive 形如 "C:"，实际 ' + d0.drive);
    // GUI 前端消费的短名字段必须保留（否则盘符卡片显示 0）
    for (const k of ['total', 'used', 'free', 'avail']) {
      assert(typeof d0[k] === 'number', 'v7-9 必须保留 GUI 兼容别名 ' + k);
    }
    // 计算逻辑必须单源：tools.js / serve.js 都不应再各自 statfsSync 算容量。
    // 注意断言的是**真实调用** `fs.statfsSync(`，注释里提到该名字是允许的
    // （注释恰恰是在解释"为什么抽走"）。
    const tSrc = fs.readFileSync(path.join(repo, 'lib', 'mcp', 'tools.js'), 'utf8');
    const sSrc = fs.readFileSync(path.join(repo, 'lib', 'serve.js'), 'utf8');
    assert(!/fs\.statfsSync\(/.test(tSrc), 'v7-9 tools.js 不应再自己调 fs.statfsSync');
    assert(!/fs\.statfsSync\(/.test(sSrc), 'v7-9 serve.js 不应再自己调 fs.statfsSync');
    assert(/require\('\.\.\/drives\.js'\)/.test(tSrc), 'v7-9 tools.js 应引用 lib/drives.js');
    assert(/require\('\.\/drives\.js'\)/.test(sSrc), 'v7-9 serve.js 应引用 lib/drives.js');
    // CLI 命令真的能跑通
    const drivesOut = runCli(['drives'], home);
    assert(/盘符/.test(drivesOut) && drivesOut.includes(d0.drive), 'v7-9 `disk-clean drives` 应输出盘符表');
    n++;

    // ============ v7-4：CLI clean 支持 stale-large ============
    // 造一份含 stale-large 建议的报告
    const staleFile = path.join(tree, 'old-big.iso');
    fs.writeFileSync(staleFile, Buffer.alloc(2048, 7));
    fs.writeFileSync(path.join(home, '.disk-clean', 'report.json'), JSON.stringify({
      summary: { roots: [tree] },
      suggestions: [
        { type: 'stale-large', estBytes: 2048, items: [{ path: staleFile, bytes: 2048 }] },
      ],
      emptyDirSample: [],
      junk: [],
    }), 'utf8');
    const staleOut = runCli(['clean', 'stale-large', '--dry-run'], home);
    assert(!/未知清理类型/.test(staleOut), 'v7-4 stale-large 不应再被当成未知类型');
    assert(staleOut.includes(staleFile) || /陈旧/.test(staleOut), 'v7-4 应从报告提取到 stale-large 候选，实际输出：' + staleOut.slice(0, 200));
    // --help 必须列出它（否则用户不知道有这个类型）
    const helpOut = runCli(['--help'], home);
    assert(/stale-large/.test(helpOut), 'v7-4 --help 应列出 stale-large');
    n++;

    // ============ v7-3：dedup rollback 必须要求 --yes ============
    // 造一对真硬链接，并写入 dedup-map，然后无 --yes 回滚 —— 必须只预览、不执行
    const dedupLib = require('../lib/dedup.js');
    const a = path.join(tree, 'hl-a.bin'), b = path.join(tree, 'hl-b.bin');
    fs.writeFileSync(a, Buffer.alloc(4096, 9));
    fs.linkSync(a, b);
    assert(fs.statSync(a).nlink === 2, 'v7-3 前置：a 应有 2 个链接');
    dedupLib.writeDedupMap([{ victim: b, keep: a, size: 4096, at: new Date().toISOString() }]);
    const preview = runCli(['dedup', 'rollback'], home);
    assert(/dry-run|预览/.test(preview), 'v7-3 无 --yes 时应输出预览，实际：' + preview.slice(0, 160));
    assert(fs.statSync(b).nlink === 2, 'v7-3 无 --yes 时**不得**真的回滚（nlink 应仍为 2）');
    // 加 --yes 才真正执行
    const realOut = runCli(['dedup', 'rollback', '--yes'], home);
    assert(fs.statSync(b).nlink === 1, 'v7-3 加 --yes 后应真的还原为独立副本，输出：' + realOut.slice(0, 160));
    n++;

    // ============ v7-2：硬链接创建必须走 fs.linkSync（而非每次 spawn PowerShell） ============
    const c = path.join(tree, 'hl-c.bin'), d = path.join(tree, 'hl-d.bin');
    fs.writeFileSync(c, Buffer.alloc(8192, 3));
    fs.writeFileSync(d, Buffer.alloc(8192, 3));
    const group = { size: 8192, approx: false, files: [{ path: c }, { path: d }] };
    const res = dedupLib.hardlinkGroup(group, false);
    const done = res.find(x => x.action === 'hardlink');
    assert(done, 'v7-2 普通精确组应能合并');
    assert(done.via === 'fs.linkSync', 'v7-2 应走 fs.linkSync（不再 spawn PowerShell），实际 via=' + done.via);
    assert(fs.statSync(c).nlink === 2, 'v7-2 合并后应是同一份数据（nlink=2）');
    n++;

    // ============ v7-7：双份副本必须被识别并上报 ============
    const engSrc = fs.readFileSync(path.join(repo, 'lib', 'engine-core.js'), 'utf8');
    assert(/duplicated/.test(engSrc) && /已复制但源未删除/.test(engSrc),
      'v7-7 engine-core 应识别并描述"已复制但源未删除"状态');
    const orgSrc = fs.readFileSync(path.join(repo, 'lib', 'organize.js'), 'utf8');
    assert(/duplicatedCount/.test(orgSrc), 'v7-7 organize 应把 duplicated 透传给上层');
    const binSrc = fs.readFileSync(cli, 'utf8');
    assert(/duplicatedCount/.test(binSrc), 'v7-7 CLI 应把双份副本提示给用户看');
    n++;

    console.log('cli-and-config OK (' + n + ' 组断言：v7-5 blacklist 已删 / v7-6 auditLines 生效 / ' +
      'v7-9 drives 单源+命令 / v7-4 clean stale-large / v7-3 rollback 要求 --yes / ' +
      'v7-2 fs.linkSync / v7-7 双份副本上报 / ' +
      'T4 junkRules+organizeRules 已删且不得卷土重来 / T5 建议显示 title 而非 [type] type / ' +
      '凭据入口（env 优先、文件回退、不回显）)');
  } finally {
    process.env.USERPROFILE = prevHome;
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
    try { fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
  }
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
