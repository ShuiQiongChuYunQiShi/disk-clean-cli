'use strict';
/* disk-clean GUI frontend — zero-dependency, two-level UI.
   Talks to engine --serve HTTP layer via Bearer token injected by the shell. */

var BASE = window.__DSK_URL__ || ('http://127.0.0.1:' + (window.location.port || '8080'));
var TOKEN = window.__DSK_TOKEN__ || new URLSearchParams(window.location.search).get('token') || '';

/* ---------- tiny helpers ---------- */
var $ = function (id) { return document.getElementById(id); };
var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

function fmtBytes(n) {
  if (n === null || n === undefined || n < 0) return '-';
  var u = ['B', 'KB', 'MB', 'GB', 'TB'];
  var v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}
function fmtDur(ms) {
  if (!ms) return '-';
  return (ms / 1000).toFixed(1) + 's';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function api(path, body) {
  var opts = { method: body === undefined ? 'GET' : 'POST', headers: {} };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(BASE + path, opts).then(function (r) {
    return r.json().catch(function () { return { ok: false, error: 'bad response' }; });
  }).then(function (j) {
    if (!j || j.ok === false) throw new Error((j && j.error) || 'API error');
    return j;
  });
}

function toast(msg, type) {
  var t = el('div', 'toast ' + (type || ''), esc(msg));
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 3200);
}

/* ---------- modal confirm ---------- */
var modalCb = null;
function confirmModal(title, bodyHtml, okLabel, cb, danger) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modalOk').textContent = okLabel || '确认';
  $('modalOk').className = 'btn ' + (danger === false ? 'primary' : 'danger');
  $('modalWrap').classList.remove('hidden');
  modalCb = cb;
}
$('modalCancel').addEventListener('click', function () { $('modalWrap').classList.add('hidden'); modalCb = null; });
$('modalOk').addEventListener('click', function () {
  $('modalWrap').classList.add('hidden');
  var cb = modalCb; modalCb = null;
  if (cb) cb();
});

/* ---------- i18n (zh default, en switch; stored in localStorage) ---------- */
var I18N = {
  zh: {
    'nav.home': '主页', 'nav.advanced': '高级',
    'nav.organize': '整理', 'nav.health': '健康', 'nav.dedup': '去重', 'nav.quota': '配额',
    'nav.mft': 'MFT 快扫', 'nav.schedule': '计划任务', 'nav.config': '配置', 'nav.audit': '审计',
    'foot.admin': '需要管理员权限',
    'home.title': '磁盘清理与分析',
    'home.sub': '扫描磁盘，获取智能建议，一键安全清理缓存与大文件。',
    'home.drives': '选择要扫描的磁盘', 'home.exclude': '排除路径（分号分隔，可选）',
    'home.scanBtn': '开始扫描', 'home.statTotal': '总大小', 'home.statFiles': '文件',
    'home.statDirs': '目录', 'home.statEmpty': '空目录', 'home.statDur': '耗时',
    'home.categories': '类别分布',
    'confirm.scanTitle': '确认扫描范围', 'confirm.scanHint': '扫描只读，不删除任何文件。',
    'drive.selectAll': '全选', 'drive.clear': '清空',
    'scan.cancel': '取消扫描', 'scan.cancelReq': '已请求取消扫描…',
    'msg.scanCancelled': '扫描已取消（显示部分结果）', 'msg.cancelledBadge': '已取消',
    'msg.staleStats': '（统计为清理前快照，可再次扫描刷新）',
    'common.cancel': '取消', 'common.confirm': '确认', 'common.run': '执行',
    'common.preview': '预览', 'common.rollback': '回滚', 'common.refresh': '刷新',
    'sugg.organize-folders': '目录整理建议', 'sugg.stale-large': '长期未用大文件',
    'sugg.duplicates': '重复文件', 'sugg.recycle-bin': '回收站', 'sugg.empty-dirs': '空文件夹',
    'sugg.junk-temp': '临时/缓存垃圾',
    'sugg.clean': '清理', 'sugg.organize': '查看计划', 'sugg.view': '查看',
    'scan.scanning': '扫描中…', 'scan.finish': '扫描完成',
    'msg.noDrives': '请至少选择一个磁盘', 'msg.noReport': '尚无报告，请先扫描',
  },
  en: {
    'nav.home': 'Home', 'nav.advanced': 'Advanced',
    'nav.organize': 'Organize', 'nav.health': 'Health', 'nav.dedup': 'Dedup', 'nav.quota': 'Quota',
    'nav.mft': 'MFT Scan', 'nav.schedule': 'Schedule', 'nav.config': 'Config', 'nav.audit': 'Audit',
    'foot.admin': 'Requires admin',
    'home.title': 'Disk Cleanup & Analysis',
    'home.sub': 'Scan your disks, get smart suggestions, clean caches and large files with one click.',
    'home.drives': 'Select drives to scan', 'home.exclude': 'Exclude paths (; separated, optional)',
    'home.scanBtn': 'Start Scan', 'home.statTotal': 'Total', 'home.statFiles': 'Files',
    'home.statDirs': 'Dirs', 'home.statEmpty': 'Empty Dirs', 'home.statDur': 'Duration',
    'home.categories': 'Categories',
    'confirm.scanTitle': 'Confirm scan scope', 'confirm.scanHint': 'Scan is read-only; no files will be deleted.',
    'drive.selectAll': 'Select all', 'drive.clear': 'Clear',
    'scan.cancel': 'Cancel scan', 'scan.cancelReq': 'Cancel requested…',
    'msg.scanCancelled': 'Scan cancelled (partial results shown)', 'msg.cancelledBadge': 'cancelled',
    'msg.staleStats': '(Stats are a pre-cleanup snapshot; re-scan to refresh)',
    'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.run': 'Run',
    'common.preview': 'Preview', 'common.rollback': 'Rollback', 'common.refresh': 'Refresh',
    'sugg.organize-folders': 'Organize folders', 'sugg.stale-large': 'Stale large files',
    'sugg.duplicates': 'Duplicates', 'sugg.recycle-bin': 'Recycle bin', 'sugg.empty-dirs': 'Empty dirs',
    'sugg.junk-temp': 'Temp/cache junk',
    'sugg.clean': 'Clean', 'sugg.organize': 'Plan', 'sugg.view': 'View',
    'scan.scanning': 'Scanning…', 'scan.finish': 'Scan finished',
    'msg.noDrives': 'Select at least one drive', 'msg.noReport': 'No report yet — scan first',
  }
};
var LANG = localStorage.getItem('dc_lang') || 'zh';
function t(key) { var d = I18N[LANG] || I18N.zh; return d[key] || key; }
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function (node) { node.textContent = t(node.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (node) { node.placeholder = t(node.getAttribute('data-i18n-ph')); });
  $('langBtn').textContent = LANG === 'zh' ? 'EN' : '中文';
  document.documentElement.lang = LANG;
}
$('langBtn').addEventListener('click', function () {
  LANG = LANG === 'zh' ? 'en' : 'zh';
  localStorage.setItem('dc_lang', LANG);
  applyI18n();
  refreshCurrentView();
});

/* ---------- navigation ---------- */
var currentView = 'home';
function switchView(name) {
  currentView = name;
  document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === name); });
  document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
  refreshCurrentView();
}
document.querySelectorAll('.nav-item').forEach(function (b) {
  b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
});
function refreshCurrentView() {
  if (currentView === 'home') loadDrives();
  else if (currentView === 'organize') renderOrganize();
  else if (currentView === 'health') renderHealth();
  else if (currentView === 'dedup') renderDedup();
  else if (currentView === 'quota') renderQuota();
  else if (currentView === 'mft') renderMft();
  else if (currentView === 'schedule') renderSchedule();
  else if (currentView === 'config') renderConfig();
  else if (currentView === 'audit') renderAudit();
}

/* =========================================================
   HOME: drives + scan + suggestions
   ========================================================= */
var selectedDrives = [];
var scanning = false;
var lastDrives = [];        // /api/drives 结果缓存（确认弹窗/合计/动态盘符用）
var currentJobId = null;    // 当前扫描任务（取消用）
var lastScanRoots = [];     // 最近一次扫描的 roots（dedup/去重复用同一范围）
var SELECT_KEY = 'dc_selected_drives';
function saveSelection() { try { localStorage.setItem(SELECT_KEY, JSON.stringify(selectedDrives)); } catch (e) {} }

function driveInfo(drive) {
  for (var i = 0; i < lastDrives.length; i++) if (lastDrives[i].drive === drive) return lastDrives[i];
  return null;
}
function syncDriveCards() {
  document.querySelectorAll('.drive-card').forEach(function (card) {
    card.classList.toggle('selected', selectedDrives.indexOf(card.dataset.drive) >= 0);
  });
  var c = $('selCount');
  if (c) c.textContent = selectedDrives.length ? '已选 ' + selectedDrives.length + ' 个' : '未选择任何磁盘';
}
function loadDrives() {
  if (currentView !== 'home') return;
  api('/api/drives').then(function (j) {
    lastDrives = j.drives || [];
    var grid = $('driveGrid');
    grid.innerHTML = '';
    // 首次启动（无记忆）默认只选 D:（用户指定）；否则沿用上次选择并过滤已失效盘符
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SELECT_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) {
      selectedDrives = lastDrives.some(function (d) { return d.drive === 'D:'; }) ? ['D:'] : (lastDrives.length ? [lastDrives[0].drive] : []);
    } else {
      var exist = {};
      lastDrives.forEach(function (d) { exist[d.drive] = true; });
      selectedDrives = saved.filter(function (d) { return exist[d]; });
    }
    saveSelection();
    lastDrives.forEach(function (d) {
      var card = el('div', 'drive-card');
      card.dataset.drive = d.drive;
      if (selectedDrives.indexOf(d.drive) >= 0) card.classList.add('selected');
      var used = d.used || 0, total = d.total || 0;
      var pct = total > 0 ? Math.round((used / total) * 100) : 0;
      var alert = total > 0 && pct >= 90 ? '<span class="drive-alert" title="剩余空间不足 10%">!</span>' : '';
      card.innerHTML = '<div class="drive-head"><span class="drive-letter">' + esc(d.drive) + '</span>' + alert + '</div>' +
        '<div class="drive-bar"><div class="drive-bar-fill' + (pct >= 90 ? ' warn' : '') + '" style="width:' + Math.min(100, pct) + '%"></div></div>' +
        '<div class="drive-size">已用 ' + fmtBytes(used) + '<br>共 ' + fmtBytes(total) + '</div>' +
        '<div class="drive-free">可用 ' + fmtBytes(d.avail) + '</div>';
      card.addEventListener('click', function () {
        card.classList.toggle('selected');
        var idx = selectedDrives.indexOf(d.drive);
        if (idx >= 0) selectedDrives.splice(idx, 1);
        else selectedDrives.push(d.drive);
        saveSelection();
      });
      grid.appendChild(card);
    });
    syncDriveCards();
  }).catch(function (e) { toast(e.message, 'err'); });
}
$('selAllBtn').addEventListener('click', function () {
  selectedDrives = lastDrives.map(function (d) { return d.drive; });
  saveSelection();
  syncDriveCards();
});
$('selNoneBtn').addEventListener('click', function () {
  selectedDrives = [];
  saveSelection();
  syncDriveCards();
});

$('scanBtn').addEventListener('click', function () {
  if (scanning) return;
  if (selectedDrives.length === 0) { toast(t('msg.noDrives'), 'err'); return; }
  var exclude = $('excludeInput').value.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  // 扫描前确认：明确列出将扫描的磁盘与合计容量（防止"以为扫 A 实际扫 B"）
  var rows = selectedDrives.map(function (dr) {
    var info = driveInfo(dr);
    return info
      ? esc(dr) + ' <span class="muted">已用 ' + fmtBytes(info.used) + ' / ' + fmtBytes(info.total) + '（可用 ' + fmtBytes(info.avail) + '）</span>'
      : esc(dr);
  }).join('<br>');
  var sumTotal = 0, sumAvail = 0;
  selectedDrives.forEach(function (dr) {
    var info = driveInfo(dr);
    if (info) { sumTotal += info.total; sumAvail += info.avail; }
  });
  var extra = exclude.length ? '<p class="muted">排除路径：' + esc(exclude.join('; ')) + '</p>' : '';
  confirmModal(t('confirm.scanTitle'),
    '<p>将扫描以下磁盘：</p><p class="mono-list">' + rows + '</p>' +
    '<p class="muted">合计 ' + fmtBytes(sumTotal) + '，可用 ' + fmtBytes(sumAvail) + '。' + t('confirm.scanHint') + '</p>' + extra,
    t('home.scanBtn'), function () { startScan(selectedDrives.slice(), exclude); }, false);
});
$('cancelScanBtn').addEventListener('click', function () {
  if (!currentJobId) return;
  api('/api/scan/cancel', { job: currentJobId }).then(function () {
    toast(t('scan.cancelReq'), '');
  }).catch(function (e) { toast(e.message, 'err'); });
});

function startScan(roots, exclude) {
  scanning = true;
  lastScanRoots = roots.slice();
  currentJobId = null;
  $('scanBtn').disabled = true;
  $('scanBtn').textContent = t('scan.scanning');
  $('scanProgress').classList.remove('hidden');
  $('cancelScanBtn').classList.remove('hidden');
  $('homeReport').classList.add('hidden');
  setProgress(0, '…');
  api('/api/scan', { roots: roots, exclude: exclude, lang: LANG === 'en' ? 'en' : 'zh' }).then(function (j) {
    currentJobId = j.jobId;
    return pollScan(j.jobId);
  }).catch(function (e) {
    toast(e.message, 'err');
    scanning = false;
    $('scanBtn').disabled = false;
    $('scanBtn').textContent = t('home.scanBtn');
    $('cancelScanBtn').classList.add('hidden');
  });
}

function setProgress(pct, text) {
  $('scanFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
  $('scanProgressText').textContent = text || '';
}

function pollScan(jobId) {
  return api('/api/scan/status?job=' + encodeURIComponent(jobId)).then(function (j) {
    if (!j.done) {
      var p = j.progress || {};
      var total = p.totalBytes || 0;
      var pct = total > 0 ? Math.min(90, ((p.bytes || 0) / total) * 90) : (p.files ? 20 : 2);
      setProgress(pct, '文件 ' + (p.files || 0) + ' | 目录 ' + (p.dirs || 0) + ' | ' + fmtBytes(p.bytes || 0) + (p.currentPath ? ' | ' + esc(p.currentPath) : ''));
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(pollScan(jobId)); }, 900);
      });
    }
    if (j.error) throw new Error(j.error);
    scanning = false;
    $('scanBtn').disabled = false;
    $('scanBtn').textContent = t('home.scanBtn');
    $('cancelScanBtn').classList.add('hidden');
    currentJobId = null;
    setProgress(100, t('scan.finish'));
    if (j.report && j.report.summary && j.report.summary.status === 'cancelled') toast(t('msg.scanCancelled'), '');
    renderReport(j.report);
  });
}

function renderReport(rep) {
  $('homeReport').classList.remove('hidden');
  var s = rep.summary || {};
  var rangeTxt = (s.roots || []).join('、') || '—';
  $('scanRange').innerHTML = '<span class="muted">扫描范围：</span>' + esc(rangeTxt) +
    (s.status === 'cancelled' ? ' <span class="badge-warn">' + esc(t('msg.cancelledBadge')) + '</span>' : '');
  $('statTotal').textContent = fmtBytes(s.totalBytes);
  $('statFiles').textContent = s.totalFiles || 0;
  $('statDirs').textContent = s.totalDirs || 0;
  $('statEmpty').textContent = s.emptyDirs || 0;
  $('statDur').textContent = fmtDur(rep.elapsedMs);

  // category chart
  var chart = $('categoryChart');
  chart.innerHTML = '';
  var max = 1;
  (rep.category || []).slice(0, 12).forEach(function (c) { if ((c.bytes || 0) > max) max = c.bytes; });
  var palette = ['#3ddc84', '#4d9fff', '#f4b740', '#ef5350', '#ab7bff', '#4dd0e1', '#ff8a65', '#9ccc65', '#f06292', '#7986cb', '#aed581', '#4db6ac'];
  (rep.category || []).slice(0, 12).forEach(function (c, i) {
    var row = el('div', 'chart-row');
    row.innerHTML = '<div class="chart-label">' + esc(c.label || '?') + '</div>' +
      '<div class="chart-track"><div class="chart-fill" style="width:' + (Math.round(((c.bytes || 0) / max) * 100)) + '%;background:' + palette[i % palette.length] + '"></div></div>' +
      '<div class="chart-val">' + fmtBytes(c.bytes) + '</div>';
    chart.appendChild(row);
  });

  renderSuggestions(rep);
}

function suggestionBadge(type) {
  switch (type) {
    case 'organize-folders': return t('sugg.organize-folders');
    case 'stale-large': return t('sugg.stale-large');
    case 'duplicates': return t('sugg.duplicates');
    case 'recycle-bin': return t('sugg.recycle-bin');
    case 'empty-dirs': return t('sugg.empty-dirs');
    case 'junk-temp': return t('sugg.junk-temp');
    default: return type;
  }
}

function renderSuggestions(rep) {
  var box = $('suggestions');
  box.innerHTML = '';
  var sugg = rep.suggestions || [];
  if (sugg.length === 0) { box.appendChild(el('div', 'notice', t('msg.noReport'))); return; }
  var map = {};
  sugg.forEach(function (s) { map[s.type] = s; });

  // --- organize-folders ---
  var oc = rep.organizeCandidates || [];
  if (oc.length > 0) {
    var card = suggestionCard('organize-folders', oc.length + ' 项 (' + fmtBytes(oc.reduce(function (a, c) { return a + (c.bytes || 0); }, 0)) + ')');
    addItemList(card.body, oc.slice(0, 30).map(function (c) {
      return { path: c.path, bytes: c.bytes, extra: c.cat };
    }));
    card.action.onclick = function () { switchView('organize'); };
    box.appendChild(card.root);
  }

  // --- stale-large ---
  if (map['stale-large']) {
    var sl = map['stale-large'];
    var card2 = suggestionCard('stale-large', (sl.items || []).length + ' 项');
    card2.action.textContent = t('sugg.view');
    addItemList(card2.body, (sl.items || []).slice(0, 30).map(function (it) { return { path: it.path, bytes: it.bytes }; }));
    card2.action.onclick = function () { confirmModal('Stale large files', buildItemListHtml((sl.items || []).slice(0, 100).map(function (it) { return { path: it.path, bytes: it.bytes }; })), 'OK', null, false); };
    box.appendChild(card2.root);
  }

  // --- duplicates ---
  if (map['duplicates']) {
    var dup = map['duplicates'];
    var groups = dup.groups || [];
    var save = groups.reduce(function (a, g) { return a + (g.size || 0) * Math.max(0, (g.files || []).length - 1); }, 0);
    var card3 = suggestionCard('duplicates', groups.length + ' 组（可释放约 ' + fmtBytes(save) + '）');
    card3.action.textContent = t('sugg.view');
    var rowHtml = groups.slice(0, 20).map(function (g) {
      return '<div class="item-line"><span class="item-path">' + esc((g.files || [])[0] || '') + '</span><span class="item-bytes">' + fmtBytes(g.size) + ' ×' + (g.files || []).length + '</span></div>';
    }).join('');
    card3.body.innerHTML = '<div class="item-list">' + rowHtml + '</div>';
    card3.action.onclick = function () { switchView('dedup'); };
    box.appendChild(card3.root);
  }

  // --- recycle-bin / empty-dirs / junk-temp: actionable one-click clean ---
  var cleanables = [
    { type: 'recycle-bin', label: '回收站', bytes: binBytes(rep) },
    { type: 'empty-dirs', label: '空文件夹', count: rep.emptyDirSample ? rep.emptyDirSample.length : 0 },
    { type: 'junk-temp', label: '临时/缓存垃圾' }
  ];
  cleanables.forEach(function (c) {
    if (c.type === 'recycle-bin' && !map['recycle-bin']) return;
    if (c.type === 'empty-dirs' && !(rep.emptyDirSample || []).length) return;
    if (c.type === 'junk-temp' && !map['junk-temp'] && !(rep.emptyDirSample || []).length) return;
    var card4 = suggestionCard(c.type, c.label + (c.bytes ? ' ' + fmtBytes(c.bytes) : c.count ? ' ' + c.count + ' 项' : ''));
    card4.action.textContent = t('sugg.clean');
    card4.action.onclick = function () {
      cleanByType(c.type, c.label);
    };
    box.appendChild(card4.root);
  });
}

function binBytes(rep) {
  var j = (rep.junk || []).find(function (x) { return x.label === '回收站'; });
  return j ? j.bytes : 0;
}

function suggestionCard(type, label) {
  var root = el('div', 'card sugg-card');
  var title = el('div', 'sugg-title');
  title.innerHTML = '<span class="sugg-badge">' + esc(suggestionBadge(type)) + '</span><span>' + esc(label) + '</span>';
  var action = el('button', 'btn small sugg-action', t('sugg.view'));
  title.appendChild(action);
  var body = el('div', 'sugg-body');
  root.appendChild(title);
  root.appendChild(body);
  return { root: root, body: body, action: action };
}

function addItemList(body, items) {
  var list = el('div', 'item-list');
  items.forEach(function (it) {
    var line = el('div', 'item-line');
    line.innerHTML = '<span class="item-path">' + esc(it.path) + (it.extra ? ' <span class="muted">(' + esc(it.extra) + ')</span>' : '') + '</span>' +
      '<span class="item-bytes">' + fmtBytes(it.bytes) + '</span>';
    list.appendChild(line);
  });
  body.appendChild(list);
}
function buildItemListHtml(items) {
  return '<div class="item-list mono-list">' + items.map(function (it) {
    return '<div class="item-line"><span class="item-path">' + esc(it.path) + '</span><span class="item-bytes">' + fmtBytes(it.bytes) + '</span></div>';
  }).join('') + '</div>';
}

/* clean with two-step confirm (preview → execute) */
function cleanByType(type, label) {
  var payload = { type: type, paths: [], dryRun: true };
  confirmModal('清理 ' + (label || type) + ' — 预览', '预览将执行（移入回收站，可恢复）。点击确认生成预览。', t('common.preview'), function () {
    api('/api/clean', payload).then(function (j) {
      var note = (j.note || '') + ('（dry-run，' + (j.estBytes != null ? fmtBytes(j.estBytes) : '') + '）');
      confirmModal('确认执行 ' + (label || type), '<p>' + esc(note) + '</p><p class="muted">再次确认后才会真正执行。全部操作写入审计日志。</p>', t('common.run'), function () {
        api('/api/clean', { type: type, paths: [], dryRun: false }).then(function () {
          toast('✔ 清理完成', 'ok');
          toast(t('msg.staleStats'), '');
        }).catch(function (e) { toast('✗ ' + e.message, 'err'); });
      }, false);
    }).catch(function (e) { toast(e.message, 'err'); });
  }, false);
}

/* =========================================================
   ADVANCED TABS
   ========================================================= */

/* ---------- organize ---------- */
var lastPlan = null;
function renderOrganize() {
  var box = $('tab-organize');
  box.innerHTML = '';
  var row = el('div', 'row gap');
  var planBtn = el('button', 'btn', t('sugg.organize'));
  var incProg = el('button', 'btn', '--include-program');
  row.appendChild(planBtn); row.appendChild(incProg);
  box.appendChild(row);

  planBtn.onclick = function () { runOrganizePlan(false); };
  incProg.onclick = function () { runOrganizePlan(true); };

  if (lastPlan) renderPlanTable(box, lastPlan);
  else box.appendChild(el('div', 'notice', '运行 plan 生成整理计划（只读预览）。'));
}

function runOrganizePlan(includeProgram) {
  api('/api/organize', { cmd: 'plan', includeProgram: includeProgram }).then(function (j) {
    lastPlan = j.items || [];
    toast((j.note || '') + ' — ' + lastPlan.length + ' 项', 'ok');
    renderPlanTable($('tab-organize'), lastPlan, j.note);
  }).catch(function (e) { toast(e.message, 'err'); });
}

function renderPlanTable(box, items, note) {
  var old = box.querySelector('.plan-table');
  if (old) old.remove();
  var wrap = el('div', 'plan-table');
  if (note) wrap.appendChild(el('p', 'muted', esc(note)));
  if (items.length === 0) { wrap.appendChild(el('div', 'notice', '（无整理计划）')); box.appendChild(wrap); return; }
  var tbl = el('table');
  tbl.innerHTML = '<tr><th></th><th>路径</th><th>分类</th><th>大小</th></tr>';
  items.forEach(function (it, i) {
    var tr = el('tr');
    tr.innerHTML = '<td><input type="checkbox" class="plan-check" checked></td>' +
      '<td>' + esc(it.src) + ' <span class="muted">→</span> ' + esc(it.dst) + '</td>' +
      '<td>' + esc(it.kind || 'file') + (it.warn ? ' <span class="muted" style="color:var(--warn)">⚠</span>' : '') + '</td>' +
      '<td>' + fmtBytes(it.bytes) + '</td>';
    tbl.appendChild(tr);
  });
  wrap.appendChild(tbl);
  var btnRow = el('div', 'row right gap');
  var previewBtn = el('button', 'btn', t('common.preview'));
  var applyBtn = el('button', 'btn danger', t('common.run'));
  var rbBtn = el('button', 'btn', t('common.rollback'));
  btnRow.appendChild(previewBtn); btnRow.appendChild(applyBtn); btnRow.appendChild(rbBtn);
  wrap.appendChild(btnRow);

  previewBtn.onclick = function () {
    var sel = selectedPlanItems();
    api('/api/organize', { cmd: 'apply', items: sel, dryRun: true }).then(function (j) {
      confirmModal('预览整理', '<p>' + esc(j.note || '') + '</p>', 'OK', null, false);
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  applyBtn.onclick = function () {
    var sel = selectedPlanItems();
    confirmModal('确认执行整理（移动目录，可回滚）', '<p class="mono">' + sel.length + ' 项将被移动。程序目录移动后快捷方式会被重写。</p>', t('common.run'), function () {
      api('/api/organize', { cmd: 'apply', items: sel, dryRun: false }).then(function (j) {
        toast('✔ ' + (j.note || '') + (j.failed && j.failed.length ? '（失败 ' + j.failed.length + ' 项）' : ''), 'ok');
      }).catch(function (e) { toast('✗ ' + e.message, 'err'); });
    });
  };
  rbBtn.onclick = function () {
    confirmModal('回滚上一批整理', '<p>将恢复最近一次整理（含快捷方式还原）。</p>', t('common.rollback'), function () {
      api('/api/organize', { cmd: 'rollback', dryRun: false }).then(function (j) {
        toast('✔ ' + (j.note || ''), 'ok');
      }).catch(function (e) { toast('✗ ' + e.message, 'err'); });
    });
  };
  box.appendChild(wrap);
}
function selectedPlanItems() {
  var checks = document.querySelectorAll('.plan-check:checked');
  if (!lastPlan || checks.length === 0) return lastPlan || [];
  var idx = [];
  document.querySelectorAll('.plan-table tr').forEach(function (tr, i) {
    if (i === 0) return;
    var ck = tr.querySelector('.plan-check');
    if (ck && ck.checked) idx.push(i - 1);
  });
  return idx.map(function (i) { return lastPlan[i]; }).filter(Boolean);
}

/* ---------- health ---------- */
function renderHealth() {
  var box = $('tab-health');
  box.innerHTML = '<div class="notice">读取磁盘健康数据…</div>';
  api('/api/health-check').then(function (j) {
    box.innerHTML = '';
    (j.disks || []).forEach(function (d) {
      var gradeClass = d.grade === '健康' ? 'grade-ok' : d.grade === '注意' ? 'grade-note' : d.grade === '警告' ? 'grade-warn' : 'grade-danger';
      var card = el('div', 'health-card');
      card.innerHTML = '<div class="health-grade ' + gradeClass + '">' + esc(d.grade || '?') + '</div>' +
        '<div class="grow"><div>' + esc(d.name) + '</div>' +
        '<div class="health-meta">' + esc(d.media || '') + (d.size ? ' · ' + fmtBytes(d.size) : '') +
        (d.temp != null ? ' · 温度 ' + esc(d.temp) + '°C' : '') +
        (d.wear != null ? ' · 寿命已用 ' + esc(d.wear) + '%' : '') +
        (d.poh != null ? ' · 通电 ' + esc(d.poh) + 'h' : '') +
        (d.readErr != null || d.writeErr != null ? ' · 读错误 ' + (d.readErr == null ? 'N/A' : d.readErr) + ' / 写错误 ' + (d.writeErr == null ? 'N/A' : d.writeErr) : '') +
        '</div>' +
        (d.issues && d.issues.length ? '<div class="issue">⚠ ' + d.issues.map(esc).join('；') + '</div>' : '') +
        '</div>';
      box.appendChild(card);
    });
    if (!(j.disks || []).length) box.appendChild(el('div', 'notice', '（无磁盘健康数据）'));
  }).catch(function (e) { box.innerHTML = ''; toast(e.message, 'err'); });
}

/* ---------- dedup ---------- */
var dedupGroups = null;
function renderDedup() {
  var box = $('tab-dedup');
  box.innerHTML = '';
  var row = el('div', 'row gap');
  var scanBtn = el('button', 'btn', '扫描重复文件');
  var hardBtn = el('button', 'btn warn', '硬链接合并（--yes）');
  var rbBtn = el('button', 'btn', t('common.rollback'));
  row.appendChild(scanBtn); row.appendChild(hardBtn); row.appendChild(rbBtn);
  box.appendChild(row);

  scanBtn.onclick = function () {
    box.appendChild(el('div', 'notice', '全盘哈希扫描（排除系统/程序目录，可能耗时）…'));
    // 复用最近一次主页扫描的范围；未扫过则交给服务端明确报错提示
    var roots = lastScanRoots.length ? lastScanRoots.slice() : undefined;
    api('/api/dedup', { roots: roots, hardlink: false }).then(function (j) {
      dedupGroups = j.groups || [];
      box.innerHTML = '';
      box.appendChild(row);
      if (dedupGroups.length === 0) { box.appendChild(el('div', 'notice', '（未发现重复文件）')); return; }
      var save = dedupGroups.reduce(function (a, g) { return a + (g.size || 0) * Math.max(0, (g.files || []).length - 1); }, 0);
      box.appendChild(el('div', 'stat-card', '<div class="stat-num">' + fmtBytes(save) + '</div><div class="stat-label">可释放</div>'));
      var tbl = el('table');
      tbl.innerHTML = '<tr><th>大小</th><th>文件数</th><th>文件（前3）</th></tr>';
      dedupGroups.slice(0, 50).forEach(function (g) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + fmtBytes(g.size) + '</td><td>' + (g.files || []).length + '</td><td>' +
          (g.files || []).slice(0, 3).map(esc).join('<br>') +
          ((g.files || []).length > 3 ? '<br><span class="muted">… 共 ' + (g.files || []).length + '</span>' : '') + '</td>';
        tbl.appendChild(tr);
      });
      box.appendChild(tbl);
    }).catch(function (e) { toast(e.message, 'err'); });
  };

  hardBtn.onclick = function () {
    if (!dedupGroups) { toast('先运行扫描', 'err'); return; }
    var saveBytes = dedupGroups.reduce(function (a, g) { return a + (g.size || 0) * Math.max(0, (g.files || []).length - 1); }, 0);
    var rangeTxt = lastScanRoots.length ? lastScanRoots.join('、') : '（未知，请先回主页扫描）';
    confirmModal('硬链接合并（真实执行，非预览）', '<p>范围：<b>' + esc(rangeTxt) + '</b></p>' +
      '<p>保留每组 1 个原件，其余转为硬链接（同卷内），可回滚。释放约 ' + fmtBytes(saveBytes) + '。</p>' +
      '<p class="muted">范围为最近一次主页扫描的磁盘；如需限定范围请先回主页选择后再扫描。</p>', t('common.run'), function () {
      api('/api/dedup', { roots: lastScanRoots.slice(), hardlink: true, dryRun: false }).then(function (j) {
        toast('✔ 合并 ' + j.hardlinked + ' 个，失败 ' + (j.failed || 0) + (j.dryRun ? '（预览）' : ''), 'ok');
      }).catch(function (e) { toast('✗ ' + e.message, 'err'); });
    });
  };

  rbBtn.onclick = function () {
    confirmModal('回滚硬链接', '<p>将已合并的硬链接恢复为独立副本。</p>', t('common.rollback'), function () {
      api('/api/dedup', { rollback: true }).then(function (j) {
        toast('✔ 已还原 ' + (j.restored || 0) + ' 个', 'ok');
      }).catch(function (e) { toast('✗ ' + e.message, 'err'); });
    });
  };
}

/* ---------- quota ---------- */
function renderQuota() {
  var box = $('tab-quota');
  box.innerHTML = '<div class="notice">读取配额数据（MFT 直读，需管理员）…</div>';
  var drive = selectedDrives.length ? selectedDrives[0] : (lastDrives.length ? lastDrives[0].drive : 'C:');
  api('/api/quota', { drive: drive }).then(function (j) {
    box.innerHTML = '';
    var total = j.users.reduce(function (s, u) { return s + u.bytes; }, 0) + (j.systemBytes || 0);
    box.appendChild(el('div', 'muted', '卷总量 ' + fmtBytes(total) + ' · 系统/其他 ' + fmtBytes(j.systemBytes) + ' · MFT 记录 ' + (j.mftRecords || 0)));
    (j.users || []).forEach(function (u) {
      var card = el('div', 'card');
      var pct = total > 0 ? ((u.bytes / total) * 100).toFixed(1) : '0.0';
      card.innerHTML = '<div class="card-title">' + esc(u.name) + ' <span class="muted">' + fmtBytes(u.bytes) + ' (' + pct + '%)</span></div>';
      var tbl = el('table');
      (u.subdirs || []).forEach(function (sd) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + esc(sd.name) + '</td><td class="bar-cell"><div class="bar"><div style="width:' + Math.min(100, total > 0 ? (sd.bytes / total) * 100 : 0) + '%"></div></div></td><td>' + fmtBytes(sd.bytes) + '</td>';
        tbl.appendChild(tr);
      });
      card.appendChild(tbl);
      box.appendChild(card);
    });
  }).catch(function (e) { box.innerHTML = ''; toast(e.message, 'err'); });
}

/* ---------- mft ---------- */
function renderMft() {
  var box = $('tab-mft');
  box.innerHTML = '';
  var row = el('div', 'row gap');
  var driveSel = el('select', 'input');
  var goBtn = el('button', 'btn primary', 'MFT 快速扫描');
  row.appendChild(driveSel); row.appendChild(goBtn);
  box.appendChild(row);
  var fillDrives = function (list) {
    driveSel.innerHTML = '';
    (list.length ? list : ['C:']).forEach(function (d) {
      var drive = typeof d === 'string' ? d : d.drive;
      var o = el('option', null, drive);
      o.value = drive;
      driveSel.appendChild(o);
    });
  };
  if (lastDrives.length) fillDrives(lastDrives);
  else api('/api/drives').then(function (j) { lastDrives = j.drives || []; fillDrives(lastDrives); }).catch(function () { fillDrives(['C:']); });

  goBtn.onclick = function () {
    box.appendChild(el('div', 'notice', 'MFT 直读扫描中（约 8 倍速，秒级）…'));
    api('/api/mftscan', { drive: driveSel.value }).then(function (j) {
      box.innerHTML = '';
      box.appendChild(row);
      var s = j.summary || {};
      box.appendChild(el('div', 'stat-card', '<div class="stat-num">' + fmtBytes(s.totalBytes) + '</div><div class="stat-label">' + driveSel.value + ' 总大小 · ' + (s.totalFiles || 0) + ' 文件</div>'));
      var tbl = el('table');
      tbl.innerHTML = '<tr><th>分类</th><th>大小</th><th>文件数</th></tr>';
      (j.category || []).slice(0, 12).forEach(function (c) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + esc(c.label) + '</td><td>' + fmtBytes(c.bytes) + '</td><td>' + (c.count || 0) + '</td>';
        tbl.appendChild(tr);
      });
      box.appendChild(tbl);
      var top = el('table');
      top.innerHTML = '<tr><th>最大目录</th><th>大小</th><th>文件</th></tr>';
      (j.topDirs || []).slice(0, 15).forEach(function (d2) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + esc(d2.path) + '</td><td>' + fmtBytes(d2.bytes) + '</td><td>' + (d2.files || 0) + '</td>';
        top.appendChild(tr);
      });
      box.appendChild(top);
    }).catch(function (e) { toast(e.message, 'err'); });
  };
}

/* ---------- schedule ---------- */
function renderSchedule() {
  var box = $('tab-schedule');
  box.innerHTML = '<div class="notice">加载计划任务…</div>';
  api('/api/schedule', { action: 'list' }).then(function (j) {
    box.innerHTML = '';
    var addCard = el('div', 'card');
    addCard.innerHTML = '<div class="card-title">新增定时扫描</div>';
    var row = el('div', 'row gap wrap');
    var nameInput = mkInput('任务名', 'my-scan');
    var whenSel = el('select', 'input');
    [['daily', '每日'], ['weekly', '每周'], ['once', '一次']].forEach(function (o) { var opt = el('option', null, o[1]); opt.value = o[0]; whenSel.appendChild(opt); });
    var daySel = el('select', 'input');
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach(function (d) { var opt = el('option', null, d); opt.value = d; daySel.appendChild(opt); });
    daySel.style.display = 'none';
    whenSel.addEventListener('change', function () { daySel.style.display = whenSel.value === 'weekly' ? '' : 'none'; });
    var timeInput = mkInput('时间 HH:MM', '03:00');
    var rootsInput = mkInput('扫描根（; 分隔）', 'C:\\;D:\\');
    var addBtn = el('button', 'btn primary', '添加');
    [nameInput, whenSel, daySel, timeInput, rootsInput, addBtn].forEach(function (n) { row.appendChild(n); });
    addCard.appendChild(row);
    addBtn.onclick = function () {
      api('/api/schedule', { action: 'add', name: nameInput.value.trim(), when: whenSel.value, day: whenSel.value === 'weekly' ? daySel.value : '', time: timeInput.value, roots: rootsInput.value.split(';').map(function (s) { return s.trim(); }).filter(Boolean) }).then(function (r) {
        toast('✔ ' + (r.note || '已添加'), 'ok');
        renderSchedule();
      }).catch(function (e) { toast(e.message, 'err'); });
    };
    box.appendChild(addCard);

    if ((j.items || []).length === 0) { box.appendChild(el('div', 'notice', '（暂无定时任务）')); return; }
    var tbl = el('table');
    tbl.innerHTML = '<tr><th>名称</th><th>频率</th><th>时间</th><th>扫描根</th><th>操作</th></tr>';
    j.items.forEach(function (it) {
      var tr = el('tr');
      var runB = el('button', 'btn small', '运行');
      var rmB = el('button', 'btn small danger', '删除');
      var td = el('td');
      td.appendChild(runB); td.appendChild(rmB);
      runB.onclick = function () {
        api('/api/schedule', { action: 'run', name: it.name }).then(function () { toast('✔ 定时扫描完成', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
      };
      rmB.onclick = function () {
        api('/api/schedule', { action: 'remove', name: it.name }).then(function () { toast('✔ 已删除', 'ok'); renderSchedule(); }).catch(function (e) { toast(e.message, 'err'); });
      };
      tr.innerHTML = '<td>' + esc(it.name) + '</td><td>' + esc(it.when + (it.day ? ' ' + it.day : '')) + '</td><td>' + esc(it.time) + '</td><td>' + esc((it.roots || []).join(', ')) + '</td>';
      tr.appendChild(td);
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);
  }).catch(function (e) { box.innerHTML = ''; toast(e.message, 'err'); });
}
function mkInput(ph, val) {
  var i = el('input', 'input');
  i.placeholder = ph;
  if (val) i.value = val;
  return i;
}

/* ---------- config ---------- */
function renderConfig() {
  var box = $('tab-config');
  box.innerHTML = '<div class="notice">读取配置…</div>';
  api('/api/config').then(function (j) {
    box.innerHTML = '';
    box.appendChild(el('div', 'muted', '配置文件: ' + esc(j.file)));
    box.appendChild(el('pre', 'json', esc(JSON.stringify(j.config, null, 2))));
    var row = el('div', 'row gap');
    var keyInput = mkInput('键路径（如 thresholds.looseMinBytes）');
    var valInput = mkInput('值');
    var setBtn = el('button', 'btn', '设置');
    var resetBtn = el('button', 'btn danger', '重置为默认');
    row.appendChild(keyInput); row.appendChild(valInput); row.appendChild(setBtn); row.appendChild(resetBtn);
    setBtn.onclick = function () {
      if (!keyInput.value) { toast('请输入键路径', 'err'); return; }
      api('/api/config', { action: 'set', key: keyInput.value.trim(), value: valInput.value }).then(function () { toast('✔ 已设置', 'ok'); renderConfig(); }).catch(function (e) { toast(e.message, 'err'); });
    };
    resetBtn.onclick = function () {
      confirmModal('重置配置', '<p>将配置恢复为默认值。</p>', '重置', function () {
        api('/api/config', { action: 'reset' }).then(function () { toast('✔ 已重置', 'ok'); renderConfig(); }).catch(function (e) { toast(e.message, 'err'); });
      });
    };
    box.appendChild(row);
  }).catch(function (e) { box.innerHTML = ''; toast(e.message, 'err'); });
}

/* ---------- audit ---------- */
function renderAudit() {
  var box = $('tab-audit');
  box.innerHTML = '<div class="notice">读取审计日志…</div>';
  api('/api/audit').then(function (j) {
    box.innerHTML = '';
    var entries = j.entries || [];
    if (entries.length === 0) { box.appendChild(el('div', 'notice', '（暂无审计记录）')); return; }
    var tbl = el('table');
    tbl.innerHTML = '<tr><th>时间</th><th>类型</th><th>动作</th><th>结果</th><th>路径</th></tr>';
    entries.slice().reverse().slice(0, 100).forEach(function (e) {
      var tr = el('tr');
      var t = (e.ts || '').replace('T', ' ').slice(0, 19);
      var result = e.result === 'ok' ? '<span style="color:var(--ok)">ok</span>' : '<span style="color:var(--danger)">' + esc(e.result || '') + '</span>';
      tr.innerHTML = '<td>' + esc(t) + '</td><td>' + esc(e.type || '') + '</td><td>' + esc(e.action || '') + '</td><td>' + result + '</td><td>' + esc((e.paths || []).slice(0, 3).join('<br>')) + (e.freedBytes ? ' <span class="muted">+ ' + fmtBytes(e.freedBytes) + '</span>' : '') + '</td>';
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);
  }).catch(function (e) { box.innerHTML = ''; toast(e.message, 'err'); });
}

/* ---------- boot ---------- */
applyI18n();
loadDrives();