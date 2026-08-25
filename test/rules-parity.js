// test/rules-parity.js - verify lib/engine.js and plugin dsk-helper.js produce identical results
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const repo = path.join(__dirname, '..');
// Default to repo copy so CI runs this for real; override with DSK_HELPER env if needed
const helperSrc = process.env.DSK_HELPER || path.join(repo, 'plugin', 'plugins', 'dsk-helper.js');

(async () => {
  if (!fs.existsSync(helperSrc)) {
    console.log('rules-parity SKIPPED (helper not found: ' + helperSrc + ')');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-parity-'));
  try {
    const docs = path.join(root, 'Users', 'T', 'Downloads');
    fs.mkdirSync(docs, { recursive: true });
    const buf = Buffer.alloc(1024 * 1024, 'p');
    fs.writeFileSync(path.join(docs, 'x1.bin'), buf);
    fs.writeFileSync(path.join(docs, 'x2.bin'), buf);
    const tmp2 = path.join(root, 'Users', 'T', 'AppData', 'Local', 'Temp');
    fs.mkdirSync(tmp2, { recursive: true });
    fs.writeFileSync(path.join(tmp2, 't.tmp'), 'junk');
    // shallow wide-zone dup
    fs.mkdirSync(path.join(root, 'Wide'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Wide', 'w1.dat'), buf);
    fs.writeFileSync(path.join(root, 'Wide', 'w2.dat'), buf);

    // Desktop engine
    const engine = require(path.join(repo, 'lib', 'engine.js'));
    const resD = await engine.run(['--roots', root, '--suggest']);
    const d = resD.data;

    // Plugin helper (direct exec, last line JSON)
    const outP = execFileSync('node', [helperSrc, '--roots', root, '--suggest'], {
      encoding: 'utf8', timeout: 120000, windowsHide: true
    });
    const idx = outP.lastIndexOf('\n');
    const p = JSON.parse(idx >= 0 ? outP.slice(idx + 1) : outP);

    assert(d.summary.totalFiles === p.summary.totalFiles, 'totalFiles parity: ' + d.summary.totalFiles + ' vs ' + p.summary.totalFiles);
    assert(d.summary.totalBytes === p.summary.totalBytes, 'totalBytes parity');
    const dd = (d.suggestions || []).find(s => s.type === 'duplicates');
    const pd = (p.suggestions || []).find(s => s.type === 'duplicates');
    assert(!!dd === !!pd, 'duplicates presence parity');
    if (dd && pd) {
      assert(dd.groups.length === pd.groups.length, 'dup groups count parity: ' + dd.groups.length + ' vs ' + pd.groups.length);
      assert(dd.estBytes === pd.estBytes, 'dup estBytes parity');
      for (let i = 0; i < Math.min(dd.groups.length, pd.groups.length); i++) {
        // Keep path may differ by tie-break order (same path length) — compare sets instead
        const keepD = dd.groups[i].keep;
        assert(dd.groups[i].scope === pd.groups[i].scope, 'group ' + i + ' scope parity');
        assert((dd.groups[i].removable || []).length === (pd.groups[i].removable || []).length, 'removable count parity');
        const allD = [keepD].concat(dd.groups[i].removable || []).map(x => x.toLowerCase()).sort();
        const allP = [pd.groups[i].keep].concat(pd.groups[i].removable || []).map(x => x.toLowerCase()).sort();
        assert(JSON.stringify(allD) === JSON.stringify(allP), 'group ' + i + ' member set parity');
      }
    }
    console.log('rules-parity OK: files=' + d.summary.totalFiles + ' dupGroups=' + (dd ? dd.groups.length : 0));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
