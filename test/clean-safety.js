// test/clean-safety.js - safety tests for lib/clean.js validate/execute
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const clean = require('../lib/clean.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function report() {
  return {
    summary: { roots: ['C:\\'] },
    suggestions: [
      { type: 'junk-temp', estBytes: 1000, items: [{ label: '用户临时目录', bytes: 1000, count: 1 }], paths: [] },
      { type: 'stale-large', estBytes: 500 * 1024 * 1024, items: [{ path: 'C:\\Users\\Test\\old.mkv', bytes: 500 * 1024 * 1024 }] },
      { type: 'duplicates', estBytes: 2048, groups: [{ size: 1024, keep: 'C:\\Users\\Test\\keep.txt', removable: ['C:\\Users\\Test\\dup.txt'], scope: 'user' }] }
    ],
    emptyDirSample: ['C:\\Users\\Test\\empty-dir'],
    junk: [{ label: '回收站', bytes: 4096 }]
  };
}

function main() {
  const rep = report();

  // 1. System directory hard-reject
  const r1 = clean.validate('duplicates', ['C:\\Windows\\System32\\evil.dll'], rep);
  assert(!r1.ok && r1.error.indexOf('系统目录') >= 0, 'system dir rejected');

  // 2. Out-of-whitelist duplicates rejected
  const r2 = clean.validate('duplicates', ['C:\\not-in-list.txt'], rep);
  assert(!r2.ok, 'non-whitelisted dup rejected');

  // 3. Whitelisted duplicate accepted
  const r3 = clean.validate('duplicates', ['C:\\Users\\Test\\dup.txt'], rep);
  assert(r3.ok && r3.paths.length === 1 && r3.estBytes === 1024, 'whitelisted dup accepted');

  // 4. Empty-dirs whitelist
  const r4 = clean.validate('empty-dirs', ['C:\\Users\\Test\\empty-dir'], rep);
  assert(r4.ok, 'whitelisted empty-dir accepted');
  const r5 = clean.validate('empty-dirs', ['C:\\not-empty'], rep);
  assert(!r5.ok, 'non-whitelisted empty-dir rejected');

  // 5. stale-large whitelist
  const r6 = clean.validate('stale-large', ['C:\\Users\\Test\\old.mkv'], rep);
  assert(r6.ok && r6.estBytes === 500 * 1024 * 1024, 'stale-large accepted');
  const r7 = clean.validate('stale-large', ['C:\\other.mkv'], rep);
  assert(!r7.ok, 'non-whitelisted stale rejected');

  // 6. recycle-bin always ok (no paths needed)
  const r8 = clean.validate('recycle-bin', [], rep);
  assert(r8.ok, 'recycle-bin always accepted');

  // 7. Too many paths
  const many = [];
  for (let i = 0; i < 501; i++) many.push('C:\\p' + i + '.txt');
  const r9 = clean.validate('duplicates', many, rep);
  assert(!r9.ok && r9.error.indexOf('过多') >= 0, '>500 paths rejected');

  // 8. No report -> reject all except nothing
  const r10 = clean.validate('duplicates', ['x'], null);
  assert(!r10.ok, 'no report rejected');

  // 9. dry-run execute returns preview without deleting anything
  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-clean-'));
    try {
      // Create a real empty dir in a temp "user zone"
      const docs = path.join(tmp, 'Users', 'T', 'Documents');
      fs.mkdirSync(docs, { recursive: true });
      fs.mkdirSync(path.join(docs, 'emptydir'));
      const rep2 = { summary: { roots: [tmp] }, suggestions: [], emptyDirSample: [path.join(docs, 'emptydir')], junk: [] };
      const v = clean.validate('empty-dirs', [path.join(docs, 'emptydir')], rep2);
      assert(v.ok, 'temp empty-dir validated');
      const ex = await clean.execute('empty-dirs', v.paths, rep2, true);
      assert(ex.dryRun === true, 'dry-run flag returned');
      assert(fs.existsSync(path.join(docs, 'emptydir')), 'dry-run did NOT delete');

      // Real execute moves to recycle bin; verify dir is gone after
      const ex2 = await clean.execute('empty-dirs', v.paths, rep2, false);
      assert(ex2.ok && ex2.executed === 1, 'real execute removed dir, got ' + JSON.stringify(ex2));
      assert(!fs.existsSync(path.join(docs, 'emptydir')), 'dir gone after real clean');
      console.log('clean-safety OK (dry-run no-delete + real execute moved to bin)');
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
    }
  })().catch(e => { console.error(e.message || e); process.exit(1); });
}
main();
