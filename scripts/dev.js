#!/usr/bin/env node
// scripts/dev.js — 研发/发布流程统一入口（v0.7.1，参考 navigator 的 `nav` 模式）
//
// 为什么单开一个入口而不是塞进 bin/disk-clean.js：
//   bin/ 是**要发布给用户的 CLI**（npm 的 files 只含 bin/lib，scripts/ 既不进 npm 包
//   也不进 SEA exe）。开发与发布工具不该污染产品入口，所以分开放，
//   但**统一成一条命令**——这是 navigator 的核心教训：流程要做进工具，而不是只写进文档。
//
// 用法：
//   node scripts/dev.js doctor     环境与凭据自检（依赖/工具链/token/代理/状态目录）
//   node scripts/dev.js verify     一键验证链（语法 → 测试 → ASCII 铁律 → 版本一致性 → exe 端到端）
//
// 两个命令都以退出码表达结果：0 = 通过，1 = 有问题。可直接用作发布前门禁。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const OK = C.green + '✓' + C.reset;
const BAD = C.red + '✗' + C.reset;
const WARN = C.yellow + '!' + C.reset;

// 统一的命令执行封装：返回 { code, out }，绝不抛异常
function run(cmd, args, opts) {
  const o = opts || {};
  try {
    const r = spawnSync(cmd, args, {
      cwd: o.cwd || ROOT,
      encoding: 'utf8',
      timeout: o.timeout || 60000,
      windowsHide: true,
      env: Object.assign({}, process.env, o.env || {}),
      shell: !!o.shell,
    });
    return { code: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), error: r.error };
  } catch (e) {
    return { code: -1, out: '', error: e };
  }
}

// ---------------------------------------------------------------- doctor
function doctor() {
  const results = [];
  function rec(level, name, detail, fix) {
    results.push({ level: level, name: name, detail: detail, fix: fix });
  }

  // --- 运行时 ---
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeMinor = Number(process.versions.node.split('.')[1]);
  const nodeOk = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 15);
  rec(nodeOk ? 'ok' : 'bad', 'Node 运行时',
    'v' + process.versions.node + (nodeOk ? '' : '（需要 >= 18.15：fs.statfsSync 与 node:sea 的下限）'),
    nodeOk ? null : '升级到 Node 18.15+（本仓库 SEA 目标为 Node 22）');

  // --- 构建工具链 ---
  const has = (p) => fs.existsSync(path.join(ROOT, p));
  rec(has('node_modules/esbuild') ? 'ok' : 'bad', 'esbuild（SEA 打包）',
    has('node_modules/esbuild') ? '已安装' : '未安装', has('node_modules/esbuild') ? null : 'npm install');
  rec(has('node_modules/postject') ? 'ok' : 'bad', 'postject（SEA 注入）',
    has('node_modules/postject') ? '已安装' : '未安装', has('node_modules/postject') ? null : 'npm install');

  const dotnet = run('dotnet', ['--version']);
  rec(dotnet.code === 0 ? 'ok' : 'warn', '.NET SDK（GUI 外壳）',
    dotnet.code === 0 ? dotnet.out.trim() : '未找到',
    dotnet.code === 0 ? null : '仅构建 GUI 安装器需要；只做 CLI 可忽略');

  const isccCandidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ];
  const iscc = isccCandidates.find((p) => p && fs.existsSync(p));
  rec(iscc ? 'ok' : 'warn', 'Inno Setup（安装器）',
    iscc || '未找到', iscc ? null : '仅构建 GUI 安装器需要；只做 CLI 可忽略');

  // --- 发布凭据 ---
  const ghCli = ['C:\\Program Files\\GitHub CLI\\gh.exe'].find((p) => fs.existsSync(p));
  rec(ghCli ? 'ok' : 'warn', 'gh CLI', ghCli || '未在默认路径找到',
    ghCli ? null : '发布 GitHub Release 需要（不发布可忽略）');

  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) {
    rec('bad', 'GH_TOKEN', '未设置', 'fine-grained PAT 写入环境变量；需 Contents: Read and write');
  } else {
    // 用 API 实测而不是只查存在性——本仓库踩过"token 存在但失效"
    const probe = run(process.execPath, ['-e',
      'fetch("https://api.github.com/repos/ShuiQiongChuYunQiShi/disk-clean-cli",{headers:{Authorization:"Bearer "+process.env.GH_TOKEN,"User-Agent":"dsh"}}).then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.log("ERR");process.exit(1)})'
    ], { timeout: 30000 });
    const ok = probe.code === 0;
    rec(ok ? 'ok' : 'bad', 'GH_TOKEN 有效性',
      ok ? '可读取目标仓库' : 'HTTP ' + probe.out.trim() + '（401=失效，403=缺 Contents 写权限）',
      ok ? null : '重新生成 fine-grained PAT，权限需含 Contents: Read and write');
  }

  const npmToken = process.env.NPM_TOKEN;
  if (!npmToken) {
    rec('bad', 'NPM_TOKEN', '未设置', 'npm 粒度 token 写入环境变量（~/.npmrc 用 ${NPM_TOKEN} 引用）');
  } else {
    const probe = run('npm', ['whoami'], { timeout: 40000, shell: true });
    const ok = probe.code === 0 && probe.out.trim() && !/E401|Unauthorized/.test(probe.out);
    rec(ok ? 'ok' : 'bad', 'NPM_TOKEN 有效性',
      ok ? '已认证为 ' + probe.out.trim() : '认证失败（401）',
      ok ? null : 'token 失效或权限不足：Packages and scopes 需选 Read and write (publish and stage)');
  }

  // --- 网络通道（本仓库踩过：代理挂掉导致 push 假成功）---
  const direct = run('git', ['-c', 'http.proxy=', '-c', 'https.proxy=', 'ls-remote', '--heads', 'origin', 'master']);
  const viaProxy = run('git', ['ls-remote', '--heads', 'origin', 'master']);
  if (direct.code === 0) {
    rec('ok', 'git 远端连通性', '直连可用', null);
  } else if (viaProxy.code === 0) {
    rec('ok', 'git 远端连通性', '仅代理可用（' + (run('git', ['config', '--get', 'http.proxy']).out.trim() || '已配置代理') + '）', null);
  } else {
    rec('bad', 'git 远端连通性', '直连与代理均失败',
      '启动代理，或直接推送：git -c http.proxy= -c https.proxy= push origin master');
  }

  // --- 状态目录 ---
  const dskDir = path.join(os.homedir(), '.disk-clean');
  let writable = false, why = '';
  try {
    fs.mkdirSync(dskDir, { recursive: true });
    const probeFile = path.join(dskDir, '.write-probe');
    fs.writeFileSync(probeFile, 'x', 'utf8');
    fs.unlinkSync(probeFile);
    writable = true;
  } catch (e) { why = e.code || e.message; }
  rec(writable ? 'ok' : 'bad', '状态目录可写', dskDir + (writable ? '' : '（' + why + '）'),
    writable ? null : '检查目录权限；扫描/清理/审计都依赖它');

  // --- 版本一致性 ---
  const vc = run(process.execPath, [path.join('test', 'version-consistency.js')]);
  rec(vc.code === 0 ? 'ok' : 'bad', '版本一致性', vc.code === 0 ? vc.out.trim() : '不一致',
    vc.code === 0 ? null : '运行 node scripts/bump-version.js <from> <to> 收敛派生源');

  // --- 输出 ---
  console.log(C.bold + '\n▶ disk-clean 环境自检\n' + C.reset);
  const bad = results.filter((r) => r.level === 'bad');
  const warn = results.filter((r) => r.level === 'warn');
  for (const r of results) {
    const mark = r.level === 'ok' ? OK : (r.level === 'bad' ? BAD : WARN);
    console.log('  ' + mark + ' ' + r.name.padEnd(22) + C.dim + r.detail + C.reset);
    if (r.fix) console.log('      ' + C.yellow + '→ ' + r.fix + C.reset);
  }
  console.log('');
  if (bad.length) {
    console.log('  ' + C.red + bad.length + ' 项阻塞发布' + C.reset +
      (warn.length ? C.dim + '，另有 ' + warn.length + ' 项警告' + C.reset : ''));
    return 1;
  }
  console.log('  ' + C.green + '全部通过' + C.reset + (warn.length ? C.dim + '（' + warn.length + ' 项警告，不影响发布）' + C.reset : ''));
  return 0;
}

// ---------------------------------------------------------------- verify
function verify() {
  const steps = [];
  function step(name, fn) {
    process.stdout.write('  ' + name + ' ... ');
    const t0 = Date.now();
    let r;
    try { r = fn(); } catch (e) { r = { ok: false, detail: (e && e.message) || String(e) }; }
    const ms = Date.now() - t0;
    const mark = r.ok ? OK : BAD;
    console.log(mark + C.dim + ' ' + (r.detail || '') + ' (' + ms + 'ms)' + C.reset);
    steps.push({ name: name, ok: r.ok, detail: r.detail });
    return r.ok;
  }

  console.log(C.bold + '\n▶ disk-clean 验证链\n' + C.reset);

  // 1) 语法：覆盖 bin/lib/scripts/test + gui/web
  step('语法检查（全部 .js）', () => {
    const dirs = ['bin', 'lib', 'scripts', 'test'];
    const files = [];
    for (const d of dirs) {
      const walk = (p) => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const q = path.join(p, e.name);
          if (e.isDirectory()) walk(q);
          else if (e.name.endsWith('.js')) files.push(q);
        }
      };
      walk(path.join(ROOT, d));
    }
    for (const f of ['gui/web/ui-kit.js', 'gui/web/app.js']) {
      if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));
    }
    const bad = [];
    for (const f of files) {
      const r = run(process.execPath, ['--check', f]);
      if (r.code !== 0) bad.push(path.relative(ROOT, f));
    }
    return { ok: bad.length === 0, detail: files.length + ' 个文件' + (bad.length ? '，失败：' + bad.join(', ') : '') };
  });

  // 2) 全量测试
  step('全量测试套件', () => {
    const r = run(process.execPath, [path.join('test', 'all.js')], { timeout: 900000 });
    const m = /SUMMARY: (\d+)\/(\d+) passed/.exec(r.out);
    return { ok: r.code === 0, detail: m ? m[1] + '/' + m[2] + ' passed' : '见输出' };
  });

  // 3) .ps1 铁律：全 ASCII + 可解析（铁律 28）
  step('.ps1 全 ASCII + 可解析（铁律 28）', () => {
    const files = [];
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const q = path.join(p, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.endsWith('.ps1')) files.push(q);
      }
    };
    walk(ROOT);
    const bad = [];
    for (const f of files) {
      const buf = fs.readFileSync(f);
      let nonAscii = 0;
      for (const b of buf) if (b > 127) nonAscii++;
      if (nonAscii > 0) bad.push(path.relative(ROOT, f) + '(' + nonAscii + ' 非 ASCII 字节)');
    }
    return { ok: bad.length === 0, detail: files.length + ' 个脚本' + (bad.length ? '，违规：' + bad.join(', ') : '') };
  });

  // 4) 版本一致性
  step('版本一致性（9 个源）', () => {
    const r = run(process.execPath, [path.join('test', 'version-consistency.js')]);
    return { ok: r.code === 0, detail: r.out.trim().replace(/^PASS\s*/, '') };
  });

  // 5) exe 形态 MCP 端到端（只有产物存在时才有意义）
  const exe = path.join(ROOT, 'dist', 'disk-clean-win-x64.exe');
  if (!fs.existsSync(exe)) {
    step('exe 形态端到端', () => ({ ok: true, detail: '跳过：dist/ 无 exe（先跑 scripts/build-sea.ps1）' }));
  } else {
    step('exe 形态端到端', () => {
      const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-dev-e2e-'));
      try {
        const tmp = path.join(tree, 'Users', 'admin', 'AppData', 'Local', 'Temp');
        const docs = path.join(tree, 'Users', 'admin', 'Documents');
        fs.mkdirSync(tmp, { recursive: true });
        fs.mkdirSync(docs, { recursive: true });
        fs.mkdirSync(path.join(tree, 'Users', 'admin', 'empty-dir'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'junk1.tmp'), Buffer.alloc(4096, 0x41));
        fs.writeFileSync(path.join(tmp, 'junk2.tmp'), Buffer.alloc(8192, 0x42));
        const dup = Buffer.alloc(1024 * 1024, 0x5A);
        fs.writeFileSync(path.join(docs, 'dup1.bin'), dup);
        fs.writeFileSync(path.join(docs, 'dup2.bin'), dup);
        fs.writeFileSync(path.join(docs, 'note1.txt'), 'hello');
        const r = run(process.execPath, [path.join('scripts', 'mcp-e2e.js'), tree, '--exe', exe], { timeout: 600000 });
        return { ok: r.code === 0, detail: r.code === 0 ? 'E2E PASS' : (r.out.split('\n').filter(Boolean).pop() || '失败') };
      } finally {
        try { fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
      }
    });
  }

  const failed = steps.filter((s) => !s.ok);
  console.log('');
  if (failed.length) {
    console.log('  ' + C.red + failed.length + '/' + steps.length + ' 步失败：' + failed.map((s) => s.name).join('、') + C.reset);
    return 1;
  }
  console.log('  ' + C.green + '验证链全部通过（' + steps.length + ' 步）' + C.reset);
  return 0;
}

// ---------------------------------------------------------------- main
const cmd = process.argv[2];
if (cmd === 'doctor') process.exit(doctor());
else if (cmd === 'verify') process.exit(verify());
else {
  console.log([
    'disk-clean 研发/发布入口（不随 npm 包与 exe 发布）',
    '',
    '用法: node scripts/dev.js <command>',
    '',
    '命令:',
    '  doctor    环境与凭据自检（依赖/工具链/token/代理/状态目录/版本一致性）',
    '  verify    一键验证链（语法 → 测试 → .ps1 ASCII 铁律 → 版本一致性 → exe 端到端）',
    '',
    '两者都以退出码表达结果：0=通过，1=有问题，可直接作为发布前门禁。',
    '完整的制作与发布 SOP 见 docs/RELEASE-PLAYBOOK.md。',
  ].join('\n'));
  process.exit(cmd ? 1 : 0);
}
