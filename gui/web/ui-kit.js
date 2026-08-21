'use strict';
/* ui-kit.js - Shared DOM builders for desktop GUI (home report tabs + advanced tabs) */
(function(global){
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmtBytes(n) {
    if (n === null || n === undefined || n < 0) return '-';
    var u = ['B','KB','MB','GB','TB'];
    var v = n, k = 0;
    while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
  }
  function gaugeHtml(label, value, max, text, color) {
    var ratio = max > 0 ? Math.min(1, (value || 0) / max) : 0;
    return '<div class="gauge"><div class="gauge-l"><span>' + esc(label) + '</span><span>' + esc(text) + '</span></div>' +
      '<div class="gauge-b"><div style="width:' + Math.max(2, Math.round(ratio * 100)) + '%;background:' + (color || 'var(--accent2,#4d9fff)') + '"></div></div></div>';
  }
  function fmtNum(n) { return typeof n === 'number' ? Number(n).toLocaleString() : '-'; }

  // Card with title + badge + body + optional action button
  function card(title, badgeText, bodyHtml, actionLabel, actionClass) {
    var root = el('div', 'card');
    var head = el('div', 'row gap');
    head.innerHTML = '<span class="card-title">' + esc(title) + '</span>' + (badgeText ? '<span class="sugg-badge">' + esc(badgeText) + '</span>' : '');
    if (actionLabel) {
      var btn = el('button', 'btn small ' + (actionClass || 'primary'), esc(actionLabel));
      head.appendChild(btn);
      root._actionBtn = btn;
    }
    root.appendChild(head);
    if (bodyHtml) {
      var body = el('div', 'card-body');
      body.innerHTML = bodyHtml;
      root.appendChild(body);
      root._body = body;
    }
    return root;
  }

  // Item list (collapsible)
  function itemList(paths, limit) {
    limit = limit || 8;
    var wrap = el('div', 'item-list collist');
    paths.slice(0, limit).forEach(function(p){
      wrap.appendChild(el('div', 'item-line', '<span class="item-path">' + esc(p) + '</span>'));
    });
    if (paths.length > limit) wrap.appendChild(el('div', 'muted', '... ' + paths.length + ' items'));
    return wrap;
  }

  // Health card for a single disk
  function healthCard(d, t) {
    // t is translation function, fallback to key
    var tr = t || function(k){ return k; };
    var gradeClass = d.grade === 'Healthy' || d.grade === '健康' ? 'grade-ok' : d.grade === 'Notice' || d.grade === '注意' ? 'grade-note' : d.grade === 'Warning' || d.grade === '警告' ? 'grade-warn' : 'grade-danger';
    var chips = [d.media, d.bus, d.size ? fmtBytes(d.size) : null, d.firmware ? 'FW ' + d.firmware : null].filter(Boolean)
      .map(function(c){ return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    var gauges =
      gaugeHtml(tr('health.temp'), d.temp, 80, d.temp != null ? d.temp + ' C' : '-', d.temp > 55 ? '#ef5350' : d.temp > 45 ? '#f4b740' : '#3ddc84') +
      gaugeHtml(tr('health.wear'), d.wear, 100, d.wear != null ? d.wear + ' %' : '-', d.wear > 80 ? '#ef5350' : d.wear > 60 ? '#f4b740' : '#3ddc84') +
      gaugeHtml(tr('health.poh'), d.poh, 60000, d.poh != null ? Number(d.poh).toLocaleString() + ' h' : '-') +
      gaugeHtml(tr('health.powerCycle'), d.powerCycle, 50000, d.powerCycle != null ? Number(d.powerCycle).toLocaleString() : '-') +
      gaugeHtml(tr('health.startStop'), d.startStop, 100000, d.startStop != null ? Number(d.startStop).toLocaleString() : '-') +
      gaugeHtml(tr('health.loadUnload'), d.loadUnload, 600000, d.loadUnload != null ? Number(d.loadUnload).toLocaleString() : '-');
    var errLine = 'Read corr ' + fmtNum(d.readErrCorr) + ' / uncorr ' + fmtNum(d.readErrUncorr) +
      '  Write corr ' + fmtNum(d.writeErrCorr) + ' / uncorr ' + fmtNum(d.writeErrUncorr) +
      (d.serial ? '  S/N ' + esc(String(d.serial).slice(0,10)) : '');
    var volHtml = '';
    if (d.volumes && d.volumes.length) {
      volHtml = '<div class="muted" style="margin-top:6px">' + esc(tr('rep.volTitle')) + '</div><table>';
      d.volumes.forEach(function(v){
        var pct = v.size && v.free != null && v.size > 0 ? Math.round(100 * (v.size - v.free) / v.size) : null;
        volHtml += '<tr><td>' + esc(v.letter ? v.letter + ':' : '(no letter)') + '</td><td>' + esc(v.fs || '-') + '</td><td>' + (v.size ? fmtBytes(v.size) : '-') + '</td><td>' + (pct != null ? pct + '% used / ' + fmtBytes(v.free) + ' free' : '-') + '</td></tr>';
      });
      volHtml += '</table>';
    }
    var cardEl = el('div', 'health-card');
    cardEl.innerHTML = '<div class="health-grade ' + gradeClass + '">' + esc(d.grade || '?') + '</div>' +
      '<div class="grow"><div><b>' + esc(d.name) + '</b> ' + chips + '</div>' +
      (d.op && d.op !== 'OK' ? '<div class="issue">Status: ' + esc(d.op) + '</div>' : '') +
      (d.issues && d.issues.length ? '<div class="issue">! ' + d.issues.map(esc).join('; ') + '</div>' : '') +
      '<div class="gauges">' + gauges + '</div>' +
      '<div class="muted">' + errLine + '</div>' + volHtml + '</div>';
    return cardEl;
  }

  // Overall health banner
  function healthBanner(disks, t) {
    if (!disks || !disks.length) return el('div', 'notice', 'No disk data');
    var GRADE_RANK = {'Healthy':0,'健康':0,'Notice':1,'注意':1,'Warning':2,'警告':2,'Danger':3,'危险':3};
    var worst = null;
    disks.forEach(function(d){ if (!worst || (GRADE_RANK[d.grade]||0) > (GRADE_RANK[worst.grade]||0)) worst = d; });
    var cnt = { ok: disks.filter(function(d){ return d.grade==='Healthy'||d.grade==='健康'; }).length, warn: disks.filter(function(d){ return d.grade==='Notice'||d.grade==='注意'||d.grade==='Warning'||d.grade==='警告'; }).length, danger: disks.filter(function(d){ return d.grade==='Danger'||d.grade==='危险'; }).length };
    var banner = el('div', 'card health-banner');
    banner.innerHTML = '<span class="health-grade ' + (worst.grade==='Healthy'||worst.grade==='健康' ? 'grade-ok' : worst.grade==='Notice'||worst.grade==='注意' ? 'grade-note' : worst.grade==='Warning'||worst.grade==='警告' ? 'grade-warn' : 'grade-danger') + '">' + esc(worst.grade) + '</span>' +
      '<b>' + esc((t||function(k){return k;})('rep.healthOverall')) + ': ' + esc(worst.grade) + '</b>' +
      (worst.issues && worst.issues.length ? '<span class="muted"> - ' + esc(worst.issues[0]) + '</span>' : '') +
      '<span class="chip">OK ' + cnt.ok + '</span>' +
      (cnt.warn ? '<span class="chip" style="color:var(--warn)">! ' + cnt.warn + '</span>' : '') +
      (cnt.danger ? '<span class="chip" style="color:var(--danger)">!! ' + cnt.danger + '</span>' : '');
    return banner;
  }

  global.UIKit = {
    el: el,
    esc: esc,
    fmtBytes: fmtBytes,
    fmtNum: fmtNum,
    gaugeHtml: gaugeHtml,
    card: card,
    itemList: itemList,
    healthCard: healthCard,
    healthBanner: healthBanner
  };
})(window);
