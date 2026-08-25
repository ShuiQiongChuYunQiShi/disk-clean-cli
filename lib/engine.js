'use strict';
// lib/engine.js — thin wrapper around engine-core.js (single source)
// This file exists for backward compatibility: bin/disk-clean.js still does require('./engine.js')
// and SEA bundled code may reference it. All logic lives in engine-core.js.
const core = require('./engine-core.js');
module.exports = core;

// When executed directly as `node lib/engine.js --roots ...`, forward to core
if (require.main === module) {
  const args = process.argv.slice(2);
  core.run(args).then(function(res) {
    if (res && res.error) process.stdout.write('\n' + JSON.stringify({ ok: false, error: res.error }));
    else if (res && res.data) process.stdout.write('\n' + JSON.stringify(res.data));
    else process.stdout.write('\n' + JSON.stringify(res));
    process.exit(res && res.exitCode ? res.exitCode : 0);
  }).catch(function(e) {
    process.stderr.write('HELPER_ERROR: ' + (e && e.stack ? e.stack : String(e)));
    process.exit(2);
  });
}
