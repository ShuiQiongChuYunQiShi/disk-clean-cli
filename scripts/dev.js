#!/usr/bin/env node
// scripts/dev.js — 研发/发布流程统一入口（参考 navigator 的 `nav` 模式）
//
// 为什么单开一个入口而不是塞进 bin/disk-clean.js：
//   bin/ 是**要发布给用户的 CLI**（npm 的 files 只含 bin/lib，scripts/ 既不进 npm 包
//   也不进 SEA exe）。开发与发布工具不该污染产品入口，所以分开放，
//   但**统一成一条命令**——这是参考项目的核心教训：流程要做进工具，而不是只写进文档。
//
// 用法：
//   node scripts/dev.js doctor         环境与凭据自检（依赖/工具链/token/代理/状态目录）
//   node scripts/dev.js verify         一键验证链（语法 → 测试 → ASCII 铁律 → 版本 → 清单 → 指纹 → e2e）
//   node scripts/dev.js analyze        净变更行数与 S/M/L 分级（决定走多重的流程）
//   node scripts/dev.js changelog      从 git log 生成 CHANGELOG 分类骨架
//   node scripts/dev.js release-guide  生成本次发版指南 docs/release-guide-v<ver>.md
//
// 所有命令都以退出码表达结果：0 = 通过，1 = 有问题。
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
const OK = C.green + '\u2713' + C.reset;
const BAD = C.red + '\u2717' + C.reset;
const WARN = C.yellow + '!' + C.reset;
const SKIPTAG = C.yellow + '-' + C.reset;

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

function gitLines(args) {
  const r = run('git', args);
  if (r.code !== 0) return null;
  return r.out.split(/\r?\n/).map((s) => s.replace(/\s+$/, '')).filter(Boolean);
}

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1] !== undefined) ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.indexOf('--' + name) >= 0;

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

  // --- 审批目录（S4）---
  const apprDir = path.join(dskDir, 'approvals');
  let apprInfo = '（尚无审批记录）';
  try {
    if (fs.existsSync(apprDir)) {
      const n = fs.readdirSync(apprDir).filter((f) => /^release-.*\.json$/.test(f)).length;
      apprInfo = n + ' 份审批记录';
    }
  } catch (e) { apprInfo = '读取失败：' + (e.code || e.message); }
  rec('ok', '发布审批目录', apprDir + ' — ' + apprInfo,
    '发布前由人执行：node scripts/approval.js confirm --version <v> --by "<名字>"');

  // --- 版本一致性 ---
  const vc = run(process.execPath, [path.join('test', 'version-consistency.js')]);
  rec(vc.code === 0 ? 'ok' : 'bad', '版本一致性', vc.code === 0 ? vc.out.trim() : '不一致',
    vc.code === 0 ? null : '运行 node scripts/bump-version.js <from> <to> 收敛派生源');

  // --- 输出 ---
  console.log(C.bold + '\n\u25b6 disk-clean 环境自检\n' + C.reset);
  const bad = results.filter((r) => r.level === 'bad');
  const warn = results.filter((r) => r.level === 'warn');
  for (const r of results) {
    const mark = r.level === 'ok' ? OK : (r.level === 'bad' ? BAD : WARN);
    console.log('  ' + mark + ' ' + r.name.padEnd(22) + C.dim + r.detail + C.reset);
    if (r.fix) console.log('      ' + C.yellow + '\u2192 ' + r.fix + C.reset);
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

// ---------------------------------------------------------------- 清单一致性（S3）
// 断言：声明式清单（disk-clean.config.json）与实际仓库/产物一致。
// 这一项**不需要先构建**也能跑出结果（无产物时"未声明的 exe"集合为空），
// 因此不会退化成静默跳过；构建之后再跑则能抓到"构建了但没人发布的产物"。
function checkManifest() {
  const m = require('./manifest.js');
  const problems = [];
  const notes = [];
  const id = m.identity();

  const remote = (run('git', ['remote', 'get-url', 'origin']).out || '').trim();
  if (remote && remote.indexOf(id.repo) < 0) {
    problems.push('清单 repo=' + id.repo + ' 与 origin=' + remote + ' 不一致');
  }
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch (e) {
    problems.push('package.json 不可解析：' + ((e && e.message) || e));
  }
  if (pkg && pkg.name !== id.npmPackage) {
    problems.push('清单 npmPackage=' + id.npmPackage + ' 与 package.json name=' + pkg.name + ' 不一致');
  }

  const assets = m.assets();
  const declaredPaths = assets.map((a) => path.resolve(a.path));
  for (const a of assets) {
    const rel = path.relative(ROOT, a.path).replace(/\\/g, '/');
    if (rel.indexOf('dist/') !== 0 && rel.indexOf('gui/dist/') !== 0) {
      problems.push('清单资产 ' + a.name + ' 的路径 ' + rel + ' 不在 dist/ 或 gui/dist/ 下');
    }
  }

  // 已构建但未声明的可执行产物：发布了没人认识它，或它压根不会被发布
  const version = id.version;
  const stale = [];
  for (const dir of ['dist', path.join('gui', 'dist')]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!/\.exe$/i.test(f)) continue;
      const full = path.resolve(abs, f);
      if (declaredPaths.indexOf(full) >= 0) continue;
      if (f.indexOf(version) >= 0) problems.push('产物 ' + dir + '/' + f + ' 属于当前版本却未在清单中声明');
      else stale.push(dir + '/' + f);
    }
  }
  if (stale.length) {
    notes.push(stale.length + ' 个历史版本的 exe 仍留在构建目录（' + stale.slice(0, 3).join(', ') +
      (stale.length > 3 ? ' 等' : '') + '）——不参与发布，可清理');
  }

  return { ok: problems.length === 0, detail: problems.length ? problems.join('；') :
    (assets.length + ' 项资产已声明，身份一致' + (notes.length ? '；' + notes.join('；') : '')),
    notes: notes };
}

// ---------------------------------------------------------------- verify
function verify() {
  const steps = [];
  // 三种状态：ok / fail / skip。skip 必须显式打印并计数，
  // 绝不允许"悄悄跳过"——静默 SKIP 会让整条链在缺失产物时假装是绿的。
  function step(name, fn) {
    process.stdout.write('  ' + name + ' ... ');
    const t0 = Date.now();
    let r;
    try { r = fn(); } catch (e) { r = { ok: false, detail: (e && e.message) || String(e) }; }
    const ms = Date.now() - t0;
    const mark = r.skip ? SKIPTAG : (r.ok ? OK : BAD);
    console.log(mark + C.dim + ' ' + (r.detail || '') + ' (' + ms + 'ms)' + C.reset);
    steps.push({ name: name, ok: !!r.ok, skip: !!r.skip, detail: r.detail });
    return !!r.ok;
  }

  console.log(C.bold + '\n\u25b6 disk-clean 验证链\n' + C.reset);

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

  // 5) 声明式清单与产物一致（S3）
  step('清单一致性（S3）', () => checkManifest());

  // 6) 制品指纹：exe 必须自证来自当前 commit 且工作树干净（S9）
  const exe = path.join(ROOT, 'dist', 'disk-clean-win-x64.exe');
  if (!fs.existsSync(exe)) {
    step('制品指纹（S9）', () => ({ skip: true, ok: true, detail: '跳过：dist/ 无 exe（先跑 scripts/build-sea.ps1）' }));
  } else {
    step('制品指纹（S9）', () => {
      const r = run(process.execPath, [path.join('scripts', 'fingerprint.js'), 'check', '--exe', exe, '--json'], { timeout: 180000 });
      let j = null;
      try { j = JSON.parse(r.out); } catch (e) { j = null; }
      if (!j) return { ok: false, detail: '断言脚本输出不可解析：' + r.out.slice(0, 120) };
      const failed = (j.checks || []).filter((c) => !c.ok).map((c) => c.name + '（' + c.detail + '）');
      return { ok: j.ok, detail: j.ok ? 'commit=' + (j.info && j.info.commit) + '，与源码一致'
        : failed.join('；') };
    });
  }

  // 7) exe 形态 MCP 端到端
  if (!fs.existsSync(exe)) {
    step('exe 形态端到端', () => ({ skip: true, ok: true, detail: '跳过：dist/ 无 exe（先跑 scripts/build-sea.ps1）' }));
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
  const skipped = steps.filter((s) => s.skip);
  console.log('');
  if (failed.length) {
    console.log('  ' + C.red + failed.length + '/' + steps.length + ' 步失败：' + failed.map((s) => s.name).join('、') + C.reset);
    if (skipped.length) console.log('  ' + C.yellow + '另有 ' + skipped.length + ' 步跳过：' + skipped.map((s) => s.name).join('、') + C.reset);
    return 1;
  }
  console.log('  ' + C.green + '验证链全部通过（' + (steps.length - skipped.length) + ' 步）' + C.reset +
    (skipped.length ? C.yellow + '，' + skipped.length + ' 步跳过（' + skipped.map((s) => s.name).join('、') + '）' + C.reset : ''));
  return 0;
}

// ---------------------------------------------------------------- analyze（S8）
// 净变更行数 → 变更级别 → 该走多重的验证流程。
// 单人项目最容易死在"流程太重所以干脆不用"，分级是让流程可持续的前提。
const LEVELS = [
  { id: 'S', max: 500, verify: 'node scripts/dev.js verify（快速链即可）' },
  { id: 'M', max: 1000, verify: 'dev verify + 全量测试 + exe 端到端 + 审批' },
  { id: 'L', max: Infinity, verify: 'dev verify + GUI 重建 + 安装器静默安装 + 人工界面验收 + 审批' },
];

function resolveRange(from, to) {
  const toRef = to || 'HEAD';
  let fromRef = from;
  let source = 'explicit';
  if (!fromRef) {
    const t = gitLines(['describe', '--tags', '--abbrev=0', toRef + '^']);
    if (t && t[0]) { fromRef = t[0]; source = 'previous tag'; }
    else {
      const first = gitLines(['rev-list', '--max-parents=0', toRef]);
      fromRef = first && first[0] ? first[0] : null;
      source = 'root commit';
    }
  }
  if (!fromRef) return null;
  // 默认分析区间（未显式给 --to）时，把**未提交改动**也算进来。
  // 理由是用途：这条命令回答的是"这次要发的东西有多大"，而发版前的改动很多还躺在
  // 工作区里。漏掉它们只会把级别算低，从而让人少做验证——方向正好是危险的那一边。
  // 显式给出 --to 时（历史区间分析）则只看已提交内容，避免把当前工作区混进历史。
  return { from: fromRef, to: toRef, source: source, includeWorktree: !to };
}

// 未提交改动：已跟踪文件的 diff + 未跟踪文件（后者不在 git diff 里，最容易漏）
function worktreeNumstat() {
  const out = [];
  for (const l of (gitLines(['diff', 'HEAD', '--numstat']) || [])) out.push(l);
  const others = gitLines(['ls-files', '--others', '--exclude-standard']) || [];
  for (const f of others) {
    let add = 0, del = 0;
    try {
      const buf = fs.readFileSync(path.join(ROOT, f));
      if (buf.includes(0)) { add = 0; del = 0; }            // 二进制：按 0 行计
      else add = buf.toString('utf8').split(/\r?\n/).length;
    } catch (e) { continue; }
    out.push(add + '\t' + del + '\t' + f);
  }
  return out;
}

function collectRange(r) {
  const lines = gitLines(['diff', '--numstat', r.from + '..' + r.to]);
  if (lines === null) return null;
  // 未提交改动与已提交区间的行是两个互不重叠的集合，但可能涉及同一个文件，
  // 所以这里要把"哪些行来自工作区"标出来，否则统计口径会说谎（曾把未提交文件
  // 一并算成"提交数"）。
  const wt = r.includeWorktree ? worktreeNumstat() : [];
  const worktreePaths = {};
  for (const l of wt) worktreePaths[l.split('\t').slice(2).join('\t')] = true;
  const numstat = r.includeWorktree
    ? lines.concat(wt.filter((x) => lines.indexOf(x) < 0))
    : lines;
  let add = 0, del = 0;
  const files = [];
  const buckets = {};
  const worktreeFiles = [];
  let worktreeAdd = 0, worktreeDel = 0;
  const bucketOf = (p) => {
    if (p.indexOf('bin/') === 0 || p.indexOf('lib/') === 0) return 'src';
    if (p.indexOf('test/') === 0) return 'test';
    if (p.indexOf('gui/') === 0) return 'gui';
    if (p.indexOf('scripts/') === 0) return 'scripts';
    if (p.indexOf('docs/') === 0) return 'docs';
    if (p.indexOf('.github/') === 0) return 'ci';
    if (p.indexOf('installer/') === 0) return 'installer';
    return 'other';
  };
  for (const line of numstat) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const a = parts[0] === '-' ? 0 : Number(parts[0]);
    const d = parts[1] === '-' ? 0 : Number(parts[1]);
    const p = parts.slice(2).join('\t');
    add += a; del += d;
    files.push({ path: p, add: a, del: d });
    const b = bucketOf(p);
    buckets[b] = buckets[b] || { add: 0, del: 0, files: 0 };
    buckets[b].add += a; buckets[b].del += d; buckets[b].files++;
    if (worktreePaths[p]) { worktreeFiles.push(p); worktreeAdd += a; worktreeDel += d; }
  }
  const commits = [];
  const log = gitLines(['log', '--format=%h%x09%s', r.from + '..' + r.to]);
  for (const line of (log || [])) {
    const i = line.indexOf('\t');
    commits.push(i < 0 ? { hash: line, subject: '' } : { hash: line.slice(0, i), subject: line.slice(i + 1) });
  }
  const net = add - del;
  const level = LEVELS.find((L) => net < L.max) || LEVELS[LEVELS.length - 1];
  // 产品代码（bin/lib + gui）的净变更单独算。
  // 纯行数分级有个明显的失真：一次"只加测试和发布脚本"的大改动会被判成 L 级、
  // 要求重建 GUI 并做界面验收，可它根本没碰产品行为。分级的目的恰恰是防止流程过重
  // 而被弃用，所以必须把"行数很多但没动产品"这种情况单独说出来。
  const netOf = (k) => (buckets[k] ? buckets[k].add - buckets[k].del : 0);
  const productNet = netOf('src') + netOf('gui');
  return { add: add, del: del, net: net, files: files, buckets: buckets, commits: commits,
    level: level, productNet: productNet,
    worktreeFiles: worktreeFiles, worktreeAdd: worktreeAdd, worktreeDel: worktreeDel };
}

function analyze(from, to, asJson) {
  const r = resolveRange(from, to);
  if (!r) { console.error('无法确定分析区间（仓库没有提交？）'); return 1; }
  const data = collectRange(r);
  if (!data) { console.error('git diff 失败：' + r.from + '..' + r.to); return 1; }

  if (asJson) {
    console.log(JSON.stringify({
      range: r, additions: data.add, deletions: data.del, net: data.net,
      level: data.level.id, requiredVerification: data.level.verify,
      buckets: data.buckets, commits: data.commits, files: data.files.length,
    }, null, 2));
    return 0;
  }

  console.log(C.bold + '\n\u25b6 变更分析 ' + r.from + '..' + r.to + C.reset +
    C.dim + '  (区间来源：' + r.source +
    (r.includeWorktree ? '，含未提交改动' : '，仅已提交内容') + ')' + C.reset + '\n');
  console.log('  提交 ' + data.commits.length + ' 个，变更文件 ' + data.files.length + ' 个' +
    (data.worktreeFiles.length ? '（其中 ' + data.worktreeFiles.length + ' 个尚未提交）' : ''));
  console.log('  新增 ' + data.add + ' 行，删除 ' + data.del + ' 行，净变更 ' +
    C.bold + data.net + C.reset + ' 行');
  console.log('');
  const order = ['src', 'gui', 'test', 'scripts', 'docs', 'ci', 'installer', 'other'];
  for (const k of order) {
    const b = data.buckets[k];
    if (!b) continue;
    console.log('    ' + k.padEnd(10) + (b.files + ' 文件').padEnd(10) +
      '+' + b.add + ' -' + b.del + '  (净 ' + (b.add - b.del) + ')');
  }
  console.log('');
  if (data.worktreeFiles.length) {
    console.log('    ' + C.dim + '未提交部分：' + data.worktreeFiles.length + ' 文件 +' +
      data.worktreeAdd + ' -' + data.worktreeDel + C.reset);
  }
  const lv = data.level;
  const color = lv.id === 'L' ? C.red : (lv.id === 'M' ? C.yellow : C.green);
  console.log('  变更级别: ' + color + C.bold + lv.id + C.reset +
    '  （S < 500 ≤ M ≤ 1000 < L）');
  console.log('  要求验证: ' + lv.verify);
  if (data.productNet === 0) {
    console.log('  ' + C.cyan + '产品代码（bin/lib/gui）净变更 0 行' + C.reset +
      '：本次不触及产品行为，GUI 重建与界面验收可跳过；测试链仍须全量。');
  } else {
    console.log('  产品代码净变更: ' + data.productNet + ' 行（bin/lib/gui）');
  }
  console.log('');
  return 0;
}

// ---------------------------------------------------------------- changelog（S6）
// 把 git log 归类成 CHANGELOG 骨架。只做分类与排序，**不编造内容**——
// 条目直接取提交主题，人再按本仓库风格改写（参见 CHANGELOG.md 顶部补记说明）。
const GROUP_OF = [
  { keys: ['feat', 'feature'], title: 'Added' },
  { keys: ['fix'], title: 'Fixed' },
  { keys: ['perf'], title: 'Performance' },
  { keys: ['refactor', 'change'], title: 'Changed' },
  { keys: ['remove', 'revert'], title: 'Removed' },
  { keys: ['docs'], title: 'Docs' },
  { keys: ['test'], title: 'Tests' },
  { keys: ['ci'], title: 'CI' },
  { keys: ['chore', 'build', 'style'], title: 'Chore' },
];

function changelog(from, to) {
  const r = resolveRange(from, to);
  if (!r) { console.error('无法确定区间'); return 1; }
  const commits = gitLines(['log', '--format=%h%x09%s', r.from + '..' + r.to]) || [];
  const groups = {};
  const breaking = [];
  let unknown = 0;
  for (const line of commits) {
    const i = line.indexOf('\t');
    const hash = i < 0 ? line : line.slice(0, i);
    const subject = i < 0 ? '' : line.slice(i + 1);
    const m = /^(\w+)(\([^)]*\))?(!)?:\s*(.*)$/.exec(subject);
    if (!m) { unknown++; continue; }
    if (m[3]) breaking.push(hash + '  ' + subject);
    const type = m[1].toLowerCase();
    const g = GROUP_OF.find((G) => G.keys.indexOf(type) >= 0);
    const title = g ? g.title : 'Other';
    groups[title] = groups[title] || [];
    groups[title].push({ hash: hash, scope: m[2] || '', text: m[4], breaking: !!m[3] });
  }

  const order = ['Added', 'Changed', 'Fixed', 'Removed', 'Performance', 'Docs', 'Tests', 'CI', 'Chore', 'Other'];
  console.log('<!-- 由 node scripts/dev.js changelog 生成，请按本仓库风格改写后再入库 -->');
  console.log('');
  console.log('## [' + require('../lib/version.js').VERSION + '] - ' + new Date().toISOString().slice(0, 10));
  console.log('');
  console.log('> 区间：`' + r.from + '..' + r.to + '`（' + commits.length + ' 个提交）');
  console.log('');
  if (breaking.length) {
    console.log('### BREAKING');
    for (const b of breaking) console.log('- ' + b);
    console.log('');
  }
  for (const title of order) {
    const items = groups[title];
    if (!items || !items.length) continue;
    console.log('### ' + title);
    for (const it of items) {
      console.log('- ' + (it.scope ? '**' + it.scope.replace(/[()]/g, '') + '**: ' : '') + it.text + '  (' + it.hash + ')');
    }
    console.log('');
  }
  if (unknown) {
    console.log('<!-- 另有 ' + unknown + ' 个提交不符合 conventional commits 前缀，未归类；' +
      '请人工确认是否漏项 -->');
  }
  return 0;
}

// ---------------------------------------------------------------- release-guide（S5）
// 每次发版都要有一份**本次**的操作指南：准备清单 / 上线步骤 / 上线后验证 / 回滚预案。
// 通用 PLAYBOOK 讲"怎么做这类事"，本文件讲"这一次具体做什么"，两者不能互相替代。
function releaseGuide(version, from, to, force) {
  const versionLib = require('../lib/version.js');
  const ver = version || versionLib.VERSION;
  const r = resolveRange(from, to);
  if (!r) { console.error('无法确定区间'); return 1; }
  const data = collectRange(r);
  if (!data) { console.error('git diff 失败'); return 1; }
  const manifest = require('./manifest.js');
  const docs = manifest.docs(ver);
  const outFile = path.join(ROOT, docs.releaseGuide);
  if (fs.existsSync(outFile) && !force) {
    console.error('已存在 ' + path.relative(ROOT, outFile) + '（要覆盖请加 --force）');
    return 1;
  }

  const feats = data.commits.filter((c) => /^feat(\(|!|:)/.test(c.subject));
  const fixes = data.commits.filter((c) => /^fix(\(|!|:)/.test(c.subject));
  const others = data.commits.filter((c) => !/^(feat|fix)(\(|!|:)/.test(c.subject));

  const L = [];
  L.push('# 发版指南 v' + ver);
  L.push('');
  L.push('> 由 `node scripts/dev.js release-guide` 生成，**发布前必须人工补齐并勾选**。');
  L.push('> 通用流程见 `docs/RELEASE-PLAYBOOK.md`；本文件只讲"这一次"。');
  L.push('> 生成时间：' + new Date().toISOString());
  L.push('');
  L.push('## 一、本次上线内容');
  L.push('');
  L.push('- 区间：`' + r.from + '..' + r.to + '`（' + r.source + '），共 ' + data.commits.length + ' 个提交');
  L.push('- 净变更：' + data.net + ' 行（+' + data.add + ' / -' + data.del + '），变更级别 **' + data.level.id + '**');
  L.push('- 产品代码（bin/lib/gui）净变更：' + data.productNet + ' 行' +
    (data.productNet === 0 ? ' —— **本次不触及产品行为**，GUI 重建与界面验收可跳过；测试链仍须全量' : ''));
  if (data.worktreeFiles.length) {
    L.push('- 其中**尚未提交**的部分：' + data.worktreeFiles.length + ' 个文件，+' +
      data.worktreeAdd + ' / -' + data.worktreeDel + ' 行（自动化生成时工作区仍是脏的）');
  }
  L.push('- 变更级别要求的验证深度：' + data.level.verify);
  L.push('');
  L.push('| 类别 | 数量 | 说明 |');
  L.push('|---|---|---|');
  L.push('| feat | ' + feats.length + ' | 新能力 |');
  L.push('| fix | ' + fixes.length + ' | 缺陷修复 |');
  L.push('| 其他 | ' + others.length + ' | 文档/测试/构建等 |');
  L.push('');
  L.push('### 提交明细');
  L.push('');
  for (const c of data.commits) L.push('- `' + c.hash + '` ' + c.subject);
  L.push('');
  L.push('## 二、测试状态');
  L.push('');
  L.push('| 项 | 结果 | 证据 |');
  L.push('|---|---|---|');
  L.push('| `node scripts/dev.js verify` | ☐ | 输出粘贴处 |');
  L.push('| `docs/RELEASE_NOTES-v' + ver + '.md` 已写 | ☐ | |');
  L.push('| `CHANGELOG.md` 已补本版条目 | ☐ | |');
  L.push('| CI 最新 run 绿 | ☐ | run 链接 |');
  L.push('');
  L.push('## 三、上线前准备清单');
  L.push('');
  L.push('- [ ] `git status` 干净，本地与远端一致（脏树会被指纹断言拒绝）');
  L.push('- [ ] 版本号已在 `lib/version.js` bump，`test/version-consistency.js` 通过');
  L.push('- [ ] 已提交并打 tag：`git tag v' + ver + '` 且已推送');
  L.push('- [ ] 引擎已构建：`powershell -File scripts\\build-sea.ps1`');
  L.push('- [ ] GUI 安装器已构建：`powershell -File scripts\\build-installer.ps1`');
  L.push('- [ ] 指纹断言通过：`node scripts\\fingerprint.js check`');
  L.push('- [ ] **人已批准**：`node scripts\\approval.js confirm --version ' + ver + ' --by "<名字>"`');
  L.push('- [ ] 环境自检通过：`node scripts/dev.js doctor`（GH_TOKEN / NPM_TOKEN / 代理）');
  L.push('- [ ] 回滚预案已知悉（见第六节）');
  L.push('');
  L.push('## 四、上线步骤');
  L.push('');
  L.push('```powershell');
  L.push('# 0) 自检与验证（任一失败即停止）');
  L.push('node scripts/dev.js doctor');
  L.push('node scripts/dev.js verify');
  L.push('');
  L.push('# 1) 构建两侧产物（顺序不可颠倒：安装器内嵌引擎 exe）');
  L.push('powershell -ExecutionPolicy Bypass -File scripts\\build-sea.ps1');
  L.push('powershell -ExecutionPolicy Bypass -File scripts\\build-installer.ps1');
  L.push('');
  L.push('# 2) 断言制品 == 源码');
  L.push('node scripts/fingerprint.js check');
  L.push('');
  L.push('# 3) 人批准（脚本不能代劳）');
  L.push('node scripts/approval.js request --version ' + ver);
  L.push('node scripts/approval.js confirm --version ' + ver + ' --by "你的名字"');
  L.push('');
  L.push('# 4) 发布（内部再次校验审批 + 指纹 + 哈希；发布后回下载校验）');
  L.push('powershell -ExecutionPolicy Bypass -File scripts\\publish-release.ps1 ' + ver + ' -PublishNpm');
  L.push('```');
  L.push('');
  L.push('## 五、上线后验证清单');
  L.push('');
  L.push('- [ ] GitHub Release 非 draft，6 个资产齐全（引擎 / 安装器 / 两个 .sha256 / SHA256SUMS.txt / checksums.txt）');
  L.push('- [ ] `checksums.txt` 里的 sha256 与下载下来的 exe 实测一致');
  L.push('- [ ] 下载 exe 后 `disk-clean.exe build-info` 的 commit 等于本次 tag 指向的 commit');
  L.push('- [ ] `npm view ' + manifest.identity(ver).npmPackage + ' version` 等于 ' + ver);
  L.push('- [ ] 静默安装安装器成功，GUI 能启动并扫描出结果');
  L.push('- [ ] CI 在 tag 上的 run 绿（CI 只构建与上传 artifact，不创建 Release）');
  L.push('');
  L.push('## 六、风险与回滚');
  L.push('');
  L.push('| 风险 | 影响 | 处置 |');
  L.push('|---|---|---|');
  L.push('| 产物与源码不一致 | 用户拿到不含本次修复的 exe | 已被 `fingerprint.js check` 拦下（发布前） |');
  L.push('| 发布后才发现严重缺陷 | 用户已下载 | GitHub Release 改为 draft 或删除该 Release；npm 用 `npm deprecate`（版本号不可回收） |');
  L.push('| 审批被绕过 | 未经确认的发布 | 本机文件门禁无法阻止有写权限的代理；发布凭据不应出现在代理可达环境（见 PLAYBOOK） |');
  L.push('| 只推了 tag、忘了跑发布脚本 | 有 tag 没有 Release，用户拿不到产物 | CI 不再自动创建 Release（那是绕过审批的口子）；`gh release view v' + ver + '` 为空即为此情况 |');
  L.push('');
  L.push('回滚命令：');
  L.push('');
  L.push('```powershell');
  L.push('# 撤回 GitHub Release（保留 tag，供追溯）');
  L.push('gh release delete v' + ver + ' --yes');
  L.push('');
  L.push('# 撤回 npm 版本（已发布的版本号不能重用，只能标记弃用）');
  L.push('npm deprecate ' + manifest.identity(ver).npmPackage + '@' + ver + ' "本次发布有问题，请使用 <正确版本>"');
  L.push('```');
  L.push('');

  fs.writeFileSync(outFile, L.join('\n'), 'utf8');
  console.log('\u2713 已生成 ' + path.relative(ROOT, outFile) + '（' + L.length + ' 行）');
  console.log('  请人工补齐测试证据与勾选项，再开始发布。');
  return 0;
}

// ---------------------------------------------------------------- main
const cmd = process.argv[2];
if (cmd === 'doctor') process.exit(doctor());
else if (cmd === 'verify') process.exit(verify());
else if (cmd === 'analyze') process.exit(analyze(argOf('from', null), argOf('to', null), hasFlag('json')));
else if (cmd === 'changelog') process.exit(changelog(argOf('from', null), argOf('to', null)));
else if (cmd === 'release-guide') process.exit(releaseGuide(argOf('version', null), argOf('from', null), argOf('to', null), hasFlag('force')));
else {
  console.log([
    'disk-clean 研发/发布入口（不随 npm 包与 exe 发布）',
    '',
    '用法: node scripts/dev.js <command> [options]',
    '',
    '命令:',
    '  doctor         环境与凭据自检（依赖/工具链/token/代理/状态目录/审批目录/版本一致性）',
    '  verify         一键验证链（语法 → 测试 → .ps1 ASCII → 版本 → 清单 → 指纹 → exe 端到端）',
    '  analyze        净变更行数与 S/M/L 分级（--from <ref> --to <ref> --json）',
    '  changelog      从 git log 生成 CHANGELOG 分类骨架（--from <ref> --to <ref>）',
    '  release-guide  生成本次发版指南（--version <v> --from <ref> --force）',
    '',
    '配套脚本:',
    '  scripts/approval.js     发布审批门禁（人批准，脚本校验）',
    '  scripts/fingerprint.js  断言制品指纹 == 当前源码',
    '  scripts/manifest.js     读取 disk-clean.config.json（发布身份与产物清单）',
    '',
    '所有命令都以退出码表达结果：0=通过，1=有问题，可直接作为发布前门禁。',
    '完整的制作与发布 SOP 见 docs/RELEASE-PLAYBOOK.md。',
  ].join('\n'));
  process.exit(cmd ? 1 : 0);
}
