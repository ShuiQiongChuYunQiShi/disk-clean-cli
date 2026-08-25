// test/organize-safety.js - safety tests for organize plan/rollback mapping
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

// Use the CLI directly to exercise organize via engine (same code path as serve)
const repo = path.join(__dirname, '..');

function runCli(args) {
  const out = execFileSync('node', [path.join(repo, 'bin', 'disk-clean.js')].concat(args), {
    encoding: 'utf8', timeout: 120000, windowsHide: true
  });
  return out;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-org-'));
  try {
    // Build user zone with loose file
    const docs = path.join(tmp, 'Users', 'T', 'Documents');
    fs.mkdirSync(docs, { recursive: true });
    const srcFile = path.join(docs, 'loose-report.pdf');
    fs.writeFileSync(srcFile, Buffer.alloc(1024 * 1024, 'z'));
    // Make it old enough (>30 days mtime)
    const old = new Date(Date.now() - 45 * 24 * 3600 * 1000);
    fs.utimesSync(srcFile, old, old);

    // Scan first (organize needs a report)
    runCli(['scan', tmp, '--suggest']);

    // Direct helper mode: write plan manually and invoke --organize (tests move+map+rollback chain)
    const mapFile = path.join(tmp, '.org-map.json');
    {
      const dst = path.join(tmp, '整理区', '文档', 'loose-report.pdf');
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify([{ src: srcFile, dst: dst }]));
      const helper = path.join(repo, 'lib', 'engine.js');
      const out2 = execFileSync('node', [helper, '--organize', '--plan', path.join(tmp, 'plan.json'), '--map', mapFile], { encoding: 'utf8', windowsHide: true });
      const idx = out2.lastIndexOf('\n');
      const res = JSON.parse(idx >= 0 ? out2.slice(idx + 1) : out2);
      assert(res.ok && res.movedCount === 1, 'moved 1 file, got ' + JSON.stringify(res));
      assert(!fs.existsSync(srcFile), 'src gone after move');
      assert(fs.existsSync(dst), 'dst exists after move');

      // Rollback: reverse the plan and re-run through the same engine (simulates rollback)
      fs.writeFileSync(path.join(tmp, 'plan-rb.json'), JSON.stringify([{ src: dst, dst: srcFile }]));
      const out3 = execFileSync('node', [helper, '--organize', '--plan', path.join(tmp, 'plan-rb.json'), '--map', mapFile], { encoding: 'utf8', windowsHide: true });
      const idx3 = out3.lastIndexOf('\n');
      const res3 = JSON.parse(idx3 >= 0 ? out3.slice(idx3 + 1) : out3);
      assert(res3.ok && res3.movedCount === 1, 'rollback moved 1 back');
      assert(fs.existsSync(srcFile), 'src restored');
      assert(!fs.existsSync(dst), 'dst gone after rollback');

      // Danger rejection: moving into Windows dir must fail in engine's DANGER check
      fs.writeFileSync(path.join(tmp, 'plan-danger.json'), JSON.stringify([{ src: srcFile, dst: 'C:\\Windows\\evil.pdf' }]));
      const out4 = execFileSync('node', [helper, '--organize', '--plan', path.join(tmp, 'plan-danger.json'), '--map', mapFile], { encoding: 'utf8', windowsHide: true });
      const idx4 = out4.lastIndexOf('\n');
      const res4 = JSON.parse(idx4 >= 0 ? out4.slice(idx4 + 1) : out4);
      assert(res4.failed && res4.failed.length === 1 && String(res4.failed[0].reason).indexOf('系统目录') >= 0, 'system dir rejected by engine');
      assert(!fs.existsSync('C:\\Windows\\evil.pdf'), 'nothing written to Windows');

      console.log('organize-safety OK (move+map / rollback / danger-reject)');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
