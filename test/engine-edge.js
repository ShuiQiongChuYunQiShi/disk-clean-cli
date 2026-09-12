// test/engine-edge.js - edge cases: permission, symlink, long path, OneDrive placeholder
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
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

    // 6. OneDrive-like placeholder (cloud sync zone): must be EXCLUDED from dup candidates & stale suggestions
    const od = path.join(root, 'Users', 'Test', 'OneDrive');
    fs.mkdirSync(od, { recursive: true });
    fs.writeFileSync(path.join(od, 'placeholder.docx'), buf); // real content for test env
    // Make it stale+large so it would appear in stale-large if not excluded
    const old = new Date(Date.now() - 800 * 24 * 3600 * 1000);
    try { fs.utimesSync(path.join(od, 'placeholder.docx'), old, old); } catch (e) {}

    const engine = require(path.join(__dirname, '..', 'lib', 'engine.js'));
    const res = await engine.run(['--roots', root, '--suggest']);
    const out = res && res.data;
    assert(out && out.summary, 'summary exists');

    // OneDrive file counted in stats but NOT in destructive suggestions
    const odInStats = out.topFiles.some(f => f.path.toLowerCase().indexOf('onedrive') >= 0);
    console.log('OneDrive in stats (expected true): ' + odInStats);
    const stale = (out.suggestions || []).find(s => s.type === 'stale-large');
    if (stale) {
      const leaked = (stale.items || []).some(it => String(it.path).toLowerCase().indexOf('onedrive') >= 0);
      assert(!leaked, 'OneDrive path must NOT appear in stale-large suggestions');
    }
    const dups = (out.suggestions || []).find(s => s.type === 'duplicates');
    if (dups) {
      for (const g of dups.groups) {
        const all = [g.keep].concat(g.removable || []);
        assert(!all.some(p => String(p).toLowerCase().indexOf('onedrive') >= 0), 'OneDrive path must NOT appear in dup groups');
      }
    }

    // Baseline: base.bin + inner.txt + long.txt + .hidden + zero.dat + placeholder = at least 5
    assert(out.summary.totalFiles >= 5, 'totalFiles >= 5, got ' + out.summary.totalFiles);
    // No crash = pass; skipped counters exist
    assert(out.summary.skipped, 'skipped object present');

    // Duplicates: only base.bin counted once (link.bin is a reparse point, engine skips symlinks as dirs)
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
