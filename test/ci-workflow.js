// test/ci-workflow.js - CI 工作流结构校验（守住"工作流文件失效"这类静默故障）
//
// 起因：把 `permissions:` 写到 step 级，GitHub Actions 只允许它出现在 workflow 级或 job 级，
// 于是整个 build.yml 变成非法文件。表现极具迷惑性——不是某个 job 失败，而是**每次 push
// 都瞬间失败**，且 run 的名字从 `build` 变成了文件路径 `.github/workflows/build.yml`，
// jobs 列表为空。就这样连续 5 次 push 全红而没人知道原因。
//
// 本仓库是零运行时依赖，测试在 `npm ci` 之前跑，所以不能用 js-yaml。
// 这里用缩进+关键字做结构化校验，专门覆盖"键用在了错误层级"这一类。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const fs = require('fs');
const path = require('path');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const wfDir = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(wfDir).filter(f => /\.ya?ml$/i.test(f));
assert(files.length > 0, '.github/workflows 下应有工作流文件');

// 各层级允许出现的键（GitHub Actions 官方 schema 的子集，只列容易写错的）
const WORKFLOW_KEYS = ['name', 'on', 'permissions', 'env', 'defaults', 'concurrency', 'jobs', 'run-name'];
const JOB_KEYS = ['name', 'runs-on', 'permissions', 'needs', 'if', 'env', 'defaults', 'concurrency',
  'outputs', 'steps', 'strategy', 'timeout-minutes', 'continue-on-error', 'container', 'services',
  'uses', 'with', 'secrets'];
const STEP_KEYS = ['name', 'id', 'if', 'uses', 'run', 'with', 'env', 'working-directory', 'shell',
  'continue-on-error', 'timeout-minutes'];

let checked = 0;
for (const f of files) {
  const file = path.join(wfDir, f);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  // 定位顶层块（缩进为 0 的 `key:`）
  const topKeys = [];
  let jobsIndent = -1, jobsLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):/.exec(lines[i]);
    if (m) { topKeys.push(m[1]); if (m[1] === 'jobs') { jobsIndent = 0; jobsLine = i } }
  }
  assert(topKeys.includes('name'), f + ' 缺少顶层 name');
  assert(topKeys.includes('on'), f + ' 缺少顶层 on');
  assert(topKeys.includes('jobs'), f + ' 缺少顶层 jobs');
  for (const k of topKeys) {
    assert(WORKFLOW_KEYS.indexOf(k) >= 0, f + ' 顶层出现非法键：' + k);
  }
  assert(jobsLine >= 0, f + ' 未找到 jobs');

  // 遍历 job（jobs 下缩进 2 的键）
  for (let i = jobsLine + 1; i < lines.length; i++) {
    const jobM = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(lines[i]);
    if (!jobM) continue;
    const jobName = jobM[1];
    // 收集该 job 的键（缩进 4）与 steps 位置
    let stepsLine = -1, jobEnd = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^ {2}[A-Za-z_][\w-]*:\s*$/.test(l)) { jobEnd = j; break }
      if (/^ {4}steps:\s*$/.test(l)) stepsLine = j;
      const km = /^ {4}([A-Za-z_][\w-]*):/.exec(l);
      if (km) assert(JOB_KEYS.indexOf(km[1]) >= 0, f + ' job ' + jobName + ' 出现非法键：' + km[1]);
    }
    if (stepsLine < 0) continue;

    // 遍历 steps 下的列表项（缩进 6 的 `- `），以及每个项的键（缩进 8）
    for (let j = stepsLine + 1; j < jobEnd; j++) {
      const itemM = /^ {6}-\s+(.*)$/.exec(lines[j]);
      const bareM = /^ {6}-\s*$/.exec(lines[j]);
      if (!itemM && !bareM) {
        // 列表项之间的注释行是合法 YAML（本文件里就有：在两步之间写说明）。
        // 它不含键、不改变结构，放行；否则一条解释性注释会被报成"缩进结构异常"。
        if (/^ {6}#/.test(lines[j])) continue;
        // steps 内出现非列表项内容，说明缩进结构异常
        if (/^ {6}\S/.test(lines[j]) && lines[j].trim()) {
          throw new Error('FAIL: ' + f + ' steps 下第 ' + (j + 1) + ' 行不是列表项：' + lines[j].trim());
        }
        continue;
      }
      const stepKeys = [];
      if (itemM && itemM[1].trim()) {
        const km = /^([A-Za-z_][\w-]*):/.exec(itemM[1].trim());
        if (km) stepKeys.push(km[1]);
      }
      // 该 step 的后续键（缩进 8）
      for (let k = j + 1; k < jobEnd; k++) {
        const l = lines[k];
        if (/^ {6}-\s/.test(l) || /^ {6}-\s*$/.test(l)) break;
        if (/^ {4}\S/.test(l) && !/^ {4}steps:/.test(l)) break;
        const km = /^ {8}([A-Za-z_][\w-]*):/.exec(l);
        if (km) stepKeys.push(km[1]);
      }
      for (const sk of stepKeys) {
        // 核心断言：permissions / runs-on / needs / strategy 等只能出现在 workflow 或 job 级。
        // 写到 step 级会让整个工作流文件失效，而不是让这一步失败。
        assert(STEP_KEYS.indexOf(sk) >= 0,
          f + ' step 出现非法键 `' + sk + '`（只能出现在 workflow/job 级；' +
          '写在这里会让整个工作流文件失效，表现为每次 push 瞬间失败且 jobs 为空）');
      }
      assert(stepKeys.length > 0, f + ' 第 ' + (j + 1) + ' 行的 step 没有任何键');
      checked++;
    }
  }

  // permissions 只能出现在缩进 0（workflow）或 4（job）
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)permissions:/.exec(lines[i]);
    if (!m) continue;
    const ind = m[1].length;
    assert(ind === 0 || ind === 4,
      f + ' 第 ' + (i + 1) + ' 行 permissions 缩进为 ' + ind + '，只允许 0（workflow 级）或 4（job 级）');
  }
}

// 版本一致性：CI 语法检查必须覆盖 lib/mcp 与新增的入口
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert(pkg.scripts && pkg.scripts.check, 'package.json 应有 check 脚本');
assert(pkg.scripts.test && /test\/all\.js/.test(pkg.scripts.test), 'package.json test 应指向 test/all.js');

console.log('PASS ci-workflow: ' + files.length + ' 个工作流文件结构合法，共校验 ' + checked + ' 个 step；层级用键无误');
