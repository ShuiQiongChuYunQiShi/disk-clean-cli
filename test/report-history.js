// test/report-history.js — 报告历史（T3）
//
// 背景：`retention.reports`（默认 30，"保留最近 N 份报告"）从很早就写在默认配置里，
// 但**从来没有任何读取点**——"报告历史"这个能力从未存在，配置里却写着它。
// 而报告是全局单例、每次扫描直接覆盖：没有历史，就无法回答"昨天那 40 GB 是哪些目录"。
// docs-consistency 的死配置闸门此前把这个键登记为 UNIMPLEMENTED；本版实现之后，
// 它必须从登记里消失（那条断言会强制这一点），所以这里也要证明"配置真的被读"。
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const audit = require('../lib/audit.js');
const report = require('../lib/report.js');

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ } }

async function main() {
  // ---------------------------------------------------------------- 1) 归档可写、可读、真的压缩了
  {
    const dir = tmpDir('dsk-hist-');
    try {
      const rep = {
        generatedAt: new Date().toISOString(),
        tool: { name: 'disk-clean', version: '0.7.1' },
        summary: { roots: ['D:\\'], totalBytes: 123, scannedAt: new Date().toISOString() },
        category: [{ label: '视频', bytes: 100 }, { label: '文档', bytes: 23 }],
      };
      const raw = JSON.stringify(rep);
      const a = report.archive(rep, { dir: dir, keep: 5 });
      assert(a.ok, '归档应成功：' + a.error);
      assert(/\.json\.gz$/.test(a.file), '归档文件应为 .json.gz，实际 ' + a.file);
      assert(fs.statSync(a.file).size < raw.length,
        'gzip 应小于原始 JSON，否则压缩没有意义（' + fs.statSync(a.file).size + ' vs ' + raw.length + '）');
      // 读取端必须透明解压：调用方不该关心文件是不是压缩的
      const back = audit.readJson(a.file);
      assert(back && back.category[0].label === '视频', 'readJson 应能透明读取 gzip 归档');
      assert(back.summary.roots[0] === 'D:\\', '归档内容应与原报告一致');
    } finally { rmrf(dir); }
  }

  // ---------------------------------------------------------------- 2) 只保留最近 N 份
  {
    const dir = tmpDir('dsk-hist-n-');
    try {
      for (let i = 0; i < 5; i++) {
        report.archive({ generatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(), summary: { roots: ['C:\\'] } },
          { dir: dir, keep: 5 });
      }
      assert(report.listArchives({ dir: dir }).length === 5, '正好 N 份时不应裁剪');

      report.archive({ generatedAt: new Date(2026, 0, 1, 0, 0, 9).toISOString(), summary: { roots: ['C:\\'] } },
        { dir: dir, keep: 5 });
      const left = report.listArchives({ dir: dir });
      assert(left.length === 5, '超过 N 份后应只剩 N 份，实际 ' + left.length);
      assert(left[0].name.indexOf('20260101-000009') === 0, '最新的应排在最前，实际 ' + left[0].name);
      // 初始是 0..4 秒这五份，再补一份 9 秒 → 被裁掉的必须是最旧的 000000，
      // 剩下的最旧一份应是 000001。
      assert(!left.some(function (it) { return it.name.indexOf('20260101-000000') === 0; }),
        '最旧的 000000 应被裁掉，实际仍在：' + left.map(function (i) { return i.name; }).join(', '));
      assert(left[left.length - 1].name.indexOf('20260101-000001') === 0,
        '剩下的最旧一份应是 000001，实际 ' + left[left.length - 1].name);
    } finally { rmrf(dir); }
  }

  // ---------------------------------------------------------------- 3) 同一秒的两次归档不得互相覆盖
  {
    const dir = tmpDir('dsk-hist-dup-');
    try {
      const at = new Date(2026, 0, 1, 1, 2, 3).toISOString();
      const a1 = report.archive({ generatedAt: at, summary: {} }, { dir: dir, keep: 10 });
      const a2 = report.archive({ generatedAt: at, summary: {} }, { dir: dir, keep: 10 });
      assert(a1.file !== a2.file, '同一秒的两次归档不能覆盖——那会直接丢历史');
      assert(report.listArchives({ dir: dir }).length === 2, '两份都应保留');
    } finally { rmrf(dir); }
  }

  // ---------------------------------------------------------------- 4) retention.reports 真的被读取
  // 这是 T3 的核心断言：配置项从"写着但没人读"变成"真的生效"。
  {
    const cfgFile = path.join(audit.dskDir(), 'config.json');
    const before = audit.maxReports();
    try {
      fs.writeFileSync(cfgFile, JSON.stringify({ retention: { reports: 3 } }), 'utf8');
      assert(audit.maxReports() === 3,
        'maxReports 应读配置里的 retention.reports，实际 ' + audit.maxReports());

      const dir = tmpDir('dsk-hist-cfg-');
      try {
        // 不显式传 keep：应当按配置（3）裁剪
        for (let i = 0; i < 5; i++) {
          report.archive({ generatedAt: new Date(2026, 0, 2, 0, 0, i).toISOString(), summary: {} }, { dir: dir });
        }
        assert(report.listArchives({ dir: dir }).length === 3,
          '未显式传 keep 时应按配置裁剪到 3，实际 ' + report.listArchives({ dir: dir }).length);
      } finally { rmrf(dir); }

      // 非法值不得让程序崩，也不得被当成 0（那会把历史全删掉）
      fs.writeFileSync(cfgFile, JSON.stringify({ retention: { reports: 'many' } }), 'utf8');
      assert(audit.maxReports() === audit.DEFAULT_MAX_REPORTS,
        '非法配置值应回落默认值，实际 ' + audit.maxReports());
      fs.writeFileSync(cfgFile, JSON.stringify({ retention: { reports: -1 } }), 'utf8');
      assert(audit.maxReports() === audit.DEFAULT_MAX_REPORTS,
        '负数应回落默认值（绝不能理解成"一份都不留"）');
    } finally {
      try { fs.unlinkSync(cfgFile); } catch (e) { /* ignore */ }
    }
    assert(audit.maxReports() === before, '移除配置后应回落到默认值');
  }

  // ---------------------------------------------------------------- 5) 真实扫描恰好产生一份归档，且 CLI 能列出
  {
    const tree = tmpDir('dsk-hist-e2e-');
    try {
      const scanRoot = path.join(tree, 'scanme');
      fs.mkdirSync(scanRoot, { recursive: true });
      fs.writeFileSync(path.join(scanRoot, 'a.txt'), 'x');
      fs.writeFileSync(path.join(scanRoot, 'junk.tmp'), Buffer.alloc(2048, 0x41));

      const before = report.listArchives().length;
      execFileSync(process.execPath,
        [path.join(ROOT, 'bin', 'disk-clean.js'), 'scan', scanRoot, '--report', path.join(tree, 'r.json')],
        { encoding: 'utf8', windowsHide: true, timeout: 180000 });

      const after = report.listArchives();
      assert(after.length === before + 1,
        '一次扫描应恰好产生一份归档（多一份就是重复归档），实际新增 ' + (after.length - before));

      // 归档存在但没有入口等于没做 —— CLI 必须能列出来
      const out = execFileSync(process.execPath,
        [path.join(ROOT, 'bin', 'disk-clean.js'), 'report', '--history'],
        { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      assert(/报告历史/.test(out), 'report --history 应有标题，实际输出：\n' + out);
      assert(out.indexOf(after[0].name) >= 0,
        'report --history 应列出刚归档的文件 ' + after[0].name + '，实际输出：\n' + out);

      // 归档能被直接当报告打开（透明解压）
      const one = execFileSync(process.execPath,
        [path.join(ROOT, 'bin', 'disk-clean.js'), 'report', after[0].file],
        { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      assert(/生成时间/.test(one), '归档应能被当作普通报告打开并显示生成时间');
    } finally { rmrf(tree); }
  }

  // ---------------------------------------------------------------- 6) 定时扫描不再制造第二份归档
  // 旧实现让 schedule.run 自己把报告写进 reports/，那会与引擎的统一归档重复一份
  // （同一时刻两份：一份明文一份 gz），历史列表里就出现成对重复。
  {
    const sched = require('../lib/schedule.js');
    const name = 'histtest';
    fs.mkdirSync(sched.schedDir(), { recursive: true });
    fs.writeFileSync(sched.taskFile(name),
      JSON.stringify({ name: name, roots: ['C:\\'], when: 'daily', time: '03:00' }), 'utf8');

    let argvSeen = null;
    const res = await sched.run(name, async function (argv) {
      argvSeen = argv;
      return { exitCode: 0, data: { reportFile: 'R', mdFile: 'M', archiveFile: 'A', summary: { roots: ['C:\\'] } } };
    });
    assert(res.ok, 'schedule.run 应成功：' + res.error);
    assert(argvSeen.indexOf('--report') < 0,
      'schedule.run 不应再自作主张指定 --report（那会造成重复归档），实际参数：' + argvSeen.join(' '));
    assert(res.archiveFile === 'A', 'schedule.run 应把引擎的归档位置回传出来');
    assert(!res.reportFile || res.reportFile === 'R', 'schedule.run 的 reportFile 应来自引擎返回');
  }

  console.log('PASS report-history: gzip 归档可透明读回、保留最近 N 份（含边界与同秒撞名）、' +
    'retention.reports 真的生效、真实扫描恰好一份归档、report --history 可列出、定时扫描不重复归档');
}

main().then(function () {
  process.exit(0);
}).catch(function (e) {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
