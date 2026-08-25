// THIS FILE IS A THIN WRAPPER - DO NOT EDIT (logic lives in lib/engine-core.js)
// Shim: delegates to engine-core (repo) or bundled dsk-engine-core.js (distributed preset)
'use strict';
const path = require('path');
let impl;
const candidates = [
  path.join(__dirname, '../../../lib/engine-core.js'),
  path.join(__dirname, '../../lib/engine-core.js'),
  path.join(__dirname, './dsk-engine-core.js'),
  path.join(__dirname, '../dsk-engine-core.js')
];
for (const p of candidates) { try { impl = require(p); break; } catch (e) {} }
if (!impl || !impl.run) { console.error('engine core not found'); process.exit(2); }
const argv = process.argv.slice(2);
impl.run(argv).then(function(res) {
  if (res && res.error) process.stdout.write('\n' + JSON.stringify({ ok: false, error: res.error }));
  else if (res && res.data) process.stdout.write('\n' + JSON.stringify(res.data));
  else process.stdout.write('\n' + JSON.stringify(res));
  process.exit(res && res.exitCode ? res.exitCode : 0);
}).catch(function(e) {
  process.stderr.write('HELPER_ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(2);
});
