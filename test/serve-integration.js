// test/serve-integration.js - HTTP layer integration: auth, traversal, cancel, host check
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const repo = path.join(__dirname, '..');
const PORT_BASE = 21000 + (process.pid % 20000);

function req(port, pathname, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    const headers = Object.assign({ 'User-Agent': 'dsh-test' }, opts.headers || {});
    const rq = http.request({
      host: '127.0.0.1', port: port, path: pathname,
      method: opts.method || 'GET', headers: headers
    }, function(res) {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    rq.on('error', reject);
    if (opts.body) rq.write(opts.body);
    rq.end();
  });
}

function waitForServer(port, token, deadlineMs) {
  const deadline = Date.now() + (deadlineMs || 15000);
  return new Promise(function(resolve, reject) {
    (function poll() {
      req(port, '/api/health').then(function(r) {
        if (r.status === 200) resolve(); else retry();
      }).catch(retry);
      function retry() {
        if (Date.now() > deadline) reject(new Error('serve not ready')); else setTimeout(poll, 300);
      }
    })();
  });
}

(async () => {
  const port = PORT_BASE;
  const token = 'testtoken123';
  const webDir = path.join(repo, 'gui', 'web');
  const proc = spawn(process.execPath, [
    path.join(repo, 'bin', 'disk-clean.js'),
    'serve', '--port', String(port), '--token', token, '--web', webDir
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  try {
    await waitForServer(port, token);

    // 1. Health without auth OK
    let r = await req(port, '/api/health');
    assert(r.status === 200, 'health without token must be 200');

    // 2. API without token -> 401
    r = await req(port, '/api/drives');
    assert(r.status === 401, 'drives without token must be 401, got ' + r.status);

    // 3. API with Bearer token -> 200
    r = await req(port, '/api/drives', { headers: { Authorization: 'Bearer ' + token } });
    assert(r.status === 200 && JSON.parse(r.body).drives.length >= 0, 'drives with token 200');

    // 4. Static index served
    r = await req(port, '/?token=' + token);
    assert(r.status === 200 && r.body.indexOf('disk-clean') >= 0, 'index served');

    // 5. Static traversal rejected (../ beyond web root)
    r = await req(port, '/..%2f..%2fpackage.json');
    assert(r.status === 403 || r.status === 404, 'traversal rejected, got ' + r.status);

    // 6. cancel unknown job -> 404
    r = await req(port, '/api/scan/cancel?token=' + encodeURIComponent(token), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'no-such-job' })
    });
    assert(r.status === 404, 'cancel unknown job must be 404, got ' + r.status);

    // 7. Forged Host -> 403
    r = await new Promise(function(resolve, reject) {
      const rq = http.request({
        host: '127.0.0.1', port: port, path: '/api/health',
        headers: { Host: 'evil.example.com' }
      }, function(res) {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode }));
      });
      rq.on('error', reject); rq.end();
    });
    assert(r.status === 403, 'forged Host must be 403, got ' + r.status);

    console.log('serve-integration OK (auth/traversal/cancel/host)');
  } finally {
    try { proc.kill(); } catch (e) {}
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
