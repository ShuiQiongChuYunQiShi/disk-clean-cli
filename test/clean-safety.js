// test/clean-safety.js - 清理安全闸门测试（lib/clean.js validate/execute + lib/guard.js）
//
// 真实删除（真的往回收站丢文件）默认跳过，需显式 DSK_TEST_REAL_DELETE=1 才执行——
// 评审指出旧版会在任何 `npm test` 里真删用户文件，测试不应有破坏性副作用。
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const clean = require('../lib/clean.js');
const guard = require('../lib/guard.js');

const REAL_DELETE = process.env.DSK_TEST_REAL_DELETE === '1';

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function report() {
  return {
    summary: { roots: ['C:\\'] },
    suggestions: [
      { type: 'junk-temp', estBytes: 1000, items: [{ label: '用户临时目录', bytes: 1000, count: 1 }], paths: ['C:\\Users\\Test\\AppData\\Local\\Temp'] },
      { type: 'stale-large', estBytes: 500 * 1024 * 1024, items: [{ path: 'C:\\Users\\Test\\old.mkv', bytes: 500 * 1024 * 1024 }] },
      { type: 'duplicates', estBytes: 2048, groups: [{ size: 1024, keep: 'C:\\Users\\Test\\keep.txt', removable: ['C:\\Users\\Test\\dup.txt'], scope: 'user' }] }
    ],
    emptyDirSample: ['C:\\Users\\Test\\empty-dir'],
    junk: [{ label: '回收站', bytes: 4096 }]
  };
}

async function main() {
  const rep = report();

  // 1. 系统目录硬拒绝（guard.js 统一措辞）
  const r1 = clean.validate('duplicates', ['C:\\Windows\\System32\\evil.dll'], rep);
  assert(!r1.ok && /受保护的系统路径/.test(r1.error), 'system dir rejected, got ' + JSON.stringify(r1));

  // 1b. 评审 P1-3 新增的受保护段也必须拒绝
  for (const p of ['C:\\Windows.old\\x', 'C:\\$Windows.~BT\\x', 'C:\\Recovery\\x', 'C:\\PerfLogs\\x', 'C:\\Config.Msi\\x', 'D:\\EFI\\x']) {
    const rr = clean.validate('duplicates', [p], rep);
    assert(!rr.ok && /受保护的系统路径/.test(rr.error), 'protected segment rejected: ' + p);
  }

  // 2. 白名单外的重复文件拒绝
  const r2 = clean.validate('duplicates', ['C:\\not-in-list.txt'], rep);
  assert(!r2.ok && /不在重复文件建议清单/.test(r2.error), 'non-whitelisted dup rejected');

  // 3. 白名单内的重复文件接受
  const r3 = clean.validate('duplicates', ['C:\\Users\\Test\\dup.txt'], rep);
  assert(r3.ok && r3.paths.length === 1 && r3.estBytes === 1024, 'whitelisted dup accepted');

  // 4. 空目录白名单
  const r4 = clean.validate('empty-dirs', ['C:\\Users\\Test\\empty-dir'], rep);
  assert(r4.ok, 'whitelisted empty-dir accepted');
  const r5 = clean.validate('empty-dirs', ['C:\\not-empty'], rep);
  assert(!r5.ok && /不在空文件夹清单/.test(r5.error), 'non-whitelisted empty-dir rejected');

  // 5. 陈旧大文件白名单
  const r6 = clean.validate('stale-large', ['C:\\Users\\Test\\old.mkv'], rep);
  assert(r6.ok && r6.estBytes === 500 * 1024 * 1024, 'stale-large accepted');
  const r7 = clean.validate('stale-large', ['C:\\other.mkv'], rep);
  assert(!r7.ok, 'non-whitelisted stale rejected');

  // 6. 回收站：无须白名单，但必须给出真实条目数与不可恢复标注（评审 P1-1）
  const r8 = clean.validate('recycle-bin', [], rep);
  assert(r8.ok && r8.irreversible === true, 'recycle-bin accepted and flagged irreversible');
  assert('itemCount' in r8 && typeof r8.note === 'string' && /不可恢复/.test(r8.note), 'recycle-bin reports real scale');

  // 7. 路径数量上限
  const many = [];
  for (let i = 0; i < 501; i++) many.push('C:\\p' + i + '.txt');
  const r9 = clean.validate('duplicates', many, rep);
  assert(!r9.ok && /过多/.test(r9.error), '>500 paths rejected');

  // 8. 无报告 -> 全部拒绝
  const r10 = clean.validate('duplicates', ['x'], null);
  assert(!r10.ok && /未找到扫描报告/.test(r10.error), 'no report rejected');

  // 9. OneDrive 云同步路径一律拒绝（避免删除同步影响云端 / 哈希触发云端下载）
  const r11 = clean.validate('empty-dirs', ['C:\\Users\\Test\\OneDrive\\empty-dir'], rep);
  assert(!r11.ok && /OneDrive 云同步/.test(r11.error), 'OneDrive path rejected');

  // 10. 出扫描范围拒绝（分隔符边界：C:\Users\ 不覆盖 C:\UsersX\）
  const r12 = guard.checkDestructivePath('C:\\UsersX\\a.txt', { roots: ['C:\\Users\\'] });
  assert(!r12.ok && /不在扫描范围内/.test(r12.error), 'separator-boundary root check');
  const r13 = guard.checkDestructivePath('C:\\Users\\a.txt', { roots: ['C:\\Users\\'] });
  assert(r13.ok, 'path inside root accepted');

  // 11. 临时目录逃生通道：不在建议清单但确为 temp 段 -> 接受并记入审计字段
  const r14 = clean.validate('junk-temp', ['C:\\Users\\Test\\AppData\\Local\\Temp\\x'], rep);
  assert(r14.ok && Array.isArray(r14.escapedWhitelist) && r14.escapedWhitelist.length === 1, 'temp-segment escape hatch accepted + recorded');

  // 12. 段精确匹配回归（评审 P1-2：`temporary-report` 不是临时目录）
  const r15 = clean.validate('junk-temp', ['C:\\Users\\Test\\temporary-report'], rep);
  assert(!r15.ok, 'substring "temporary-report" must NOT count as temp dir');
  assert(guard.hasTempSegment('c:\\x\\TEMP\\y') === true, 'hasTempSegment 大小写不敏感');
  assert(guard.hasTempSegment('c:\\x\\temporary-report') === false, 'hasTempSegment 段精确');

  // 13. dry-run 绝不落盘/删除
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-clean-'));
  try {
    const docs = path.join(tmp, 'Users', 'T', 'Documents');
    fs.mkdirSync(docs, { recursive: true });
    fs.mkdirSync(path.join(docs, 'emptydir'));
    const rep2 = { summary: { roots: [tmp] }, suggestions: [], emptyDirSample: [path.join(docs, 'emptydir')], junk: [] };
    const v = clean.validate('empty-dirs', [path.join(docs, 'emptydir')], rep2);
    assert(v.ok, 'temp empty-dir validated');
    const ex = await clean.execute('empty-dirs', v.paths, rep2, true);
    assert(ex.dryRun === true, 'dry-run flag returned');
    assert(fs.existsSync(path.join(docs, 'emptydir')), 'dry-run did NOT delete');

    // 13b. 真实执行：0 项成功必须报 ok:false（评审 P0-4）——用不存在的路径安全触发
    const ghost = path.join(docs, 'ghost-dir');
    const rep3 = { summary: { roots: [tmp] }, suggestions: [], emptyDirSample: [ghost], junk: [] };
    const ex3 = await clean.execute('empty-dirs', [ghost], rep3, false);
    assert(ex3.ok === false && /没有文件被移入回收站/.test(ex3.error), '0 executed must NOT report ok:true');

    if (REAL_DELETE) {
      const ex2 = await clean.execute('empty-dirs', v.paths, rep2, false);
      assert(ex2.ok && ex2.executed === 1, 'real execute removed dir, got ' + JSON.stringify(ex2));
      assert(!fs.existsSync(path.join(docs, 'emptydir')), 'dir gone after real clean');
      console.log('clean-safety OK (含真实回收站删除)');
    } else {
      console.log('clean-safety OK (安全闸门 + dry-run + 0 项不误报；真实删除已跳过，设 DSK_TEST_REAL_DELETE=1 启用)');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }
}

main().catch(function (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1) });
