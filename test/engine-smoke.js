// test/engine-smoke.js - minimal smoke test for lib/engine.js (CI portable)
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-smoke-'));
  try {
    // Build test tree: user zone with duplicate files + junk temp dir
    const docs = path.join(root, 'Users', 'Test', 'Documents');
    fs.mkdirSync(docs, { recursive: true });
    const buf = Buffer.alloc(1024 * 1024, 'x'); // 1MB
    fs.writeFileSync(path.join(docs, 'a.docx'), buf);
    fs.writeFileSync(path.join(docs, 'b.docx'), buf);
    const tmp = path.join(root, 'Users', 'Test', 'AppData', 'Local', 'Temp');
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'junk.tmp'), 'junk');

    const engine = require(path.join(__dirname, '..', 'lib', 'engine.js'));
    const res = await engine.run(['--roots', root, '--suggest', '--report', path.join(root, 'r.json')]);
    const out = res && res.data;
    if (!out || !out.summary) throw new Error('no summary');
    if (out.summary.totalFiles !== 3) throw new Error('totalFiles expected 3, got ' + out.summary.totalFiles);
    const dups = (out.suggestions || []).find(s => s.type === 'duplicates');
    if (!dups || !dups.groups.length) throw new Error('duplicates not found');
    if (dups.groups[0].scope !== 'user') throw new Error('dup scope expected user');
    console.log('smoke OK: totalFiles=3 dupGroups=1 scope=user');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
