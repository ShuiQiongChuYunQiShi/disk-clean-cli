// test/engine-edge.js - edge cases: permission, symlink, long path, OneDrive placeholder
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-edge-'));
  try {
    const docs = path.join(root, 'Users', 'Test', 'Documents');
    fs.mkdirSync(docs, { recursive: true });
    const buf = Buffer.alloc(1024 * 1024, 'y');

    // 1. Normal file (baseline)
    fs.writeFileSync(path.join(docs, 'base.bin'), buf);

    // 2. Symlink to file (should not double count or crash)
    const target = path.join(docs, 'base.bin');
    try {
      fs.symlinkSync(target, path.join(docs, 'link.bin'), 'file');
    } catch (e) {
      // Windows symlink requires admin/dev mode; skip if unavailable
      console.log('symlink skipped: ' + e.code);
    }

    // 3. Junction (directory link) - should not cause cycle
    const subDir = path.join(docs, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'inner.txt'), 'x');
    try {
      fs.symlinkSync(subDir, path.join(docs, 'junction'), 'junction');
    } catch (e) { console.log('junction skipped: ' + e.code); }

    // 4. Long path (>260 chars) - should not crash
    const longName = ('long'.repeat(20)).slice(0, 240); // 240 chars filename
    try {
      fs.writeFileSync(path.join(docs, longName + '.txt'), 'long-path-test');
      var hasLong = true;
    } catch (e) { console.log('long path skipped: ' + e.code); hasLong = false; }

    // 5. Zero-byte and hidden files
    fs.writeFileSync(path.join(docs, '.hidden'), '');
    fs.writeFileSync(path.join(docs, 'zero.dat'), '');

    // 6. OneDrive-like placeholder (sparse/reparse point simulation via directory)
    const od = path.join(root, 'Users', 'Test', 'OneDrive');
    fs.mkdirSync(od, { recursive: true });
    fs.writeFileSync(path.join(od, 'placeholder.docx'), buf); // real content for test env

    const engine = require(path.join(__dirname, '..', 'lib', 'engine.js'));
    const res = await engine.run(['--roots', root, '--suggest']);
    const out = res && res.data;
    assert(out && out.summary, 'summary exists');

    // Baseline: base.bin + inner.txt + long.txt + .hidden + zero.dat + placeholder = at least 5
    assert(out.summary.totalFiles >= 5, 'totalFiles >= 5, got ' + out.summary.totalFiles);
    // No crash = pass; skipped counters exist
    assert(out.summary.skipped, 'skipped object present');

    // Duplicates: only base.bin counted once (link.bin is a reparse point, engine skips symlinks as dirs)
    const dups = (out.suggestions || []).find(s => s.type === 'duplicates');
    if (dups) {
      // If symlink was created, it may appear in bySize; but dedupZone filter keeps only user zone
      dups.groups.forEach(function(g){
        if ((g.removable || []).some(p => p.toLowerCase().indexOf('link.bin') >= 0)) {
          throw new Error('symlink should not be removable duplicate');
        }
      });
    }
    console.log('edge OK: totalFiles=' + out.summary.totalFiles +
      ' skipped=' + JSON.stringify(out.summary.skipped));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
