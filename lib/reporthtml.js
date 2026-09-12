'use strict';
// lib/reporthtml.js — 单文件 HTML 报告（E16）
//
// 目标：**可分享、可存档**。所有样式内联、不引用任何外部资源（没有 CDN、没有图片文件），
// 因此双击能打开、发给别人也能打开、十年后大概率还能打开。
// 数据全部来自已有的 report.json，不重新扫描——报告渲染是纯函数，不该有副作用。
//
// 为什么不直接复用 Markdown：Markdown 适合在编辑器/对话里读，但发给人看时依赖对方
// 用什么渲染器；HTML 单文件是"发过去就是它本来的样子"。
//
// 安全：报告里的路径、扩展名、建议文本全部来自被扫描的磁盘（用户可写），
// 所以**每一处插值都必须转义**——否则一个叫 `<script>...` 的目录名就能在别人的浏览器里执行。
const VERSION = require('./version.js').VERSION;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtBytes(n) {
  const b = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}

function bar(pct, color) {
  const w = Math.max(0, Math.min(100, pct * 100));
  return '<div class="bar"><span style="width:' + w.toFixed(1) + '%;background:' + color + '"></span></div>';
}

const PALETTE = ['#3ddc84', '#4d9fff', '#f4b740', '#ef5350', '#ab7bff',
  '#4dd0e1', '#ff8a65', '#9ccc65', '#f06292', '#7986cb'];

function render(rep, opts) {
  const o = opts || {};
  const sm = (rep && rep.summary) || {};
  const prov = require('./report.js').describe(rep);
  const total = sm.totalBytes || 1;
  const L = [];

  L.push('<!DOCTYPE html>');
  L.push('<html lang="zh-CN"><head><meta charset="utf-8">');
  L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  L.push('<title>disk-clean 报告 · ' + esc((sm.roots || []).join(', ') || '未指定范围') + '</title>');
  L.push('<style>');
  L.push('body{font:14px/1.6 -apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;margin:0;padding:28px;background:#12161c;color:#e6edf3}');
  L.push('h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;color:#9fb4cc}');
  L.push('.muted{color:#8b98a8}.card{background:#1a2129;border:1px solid #26313d;border-radius:10px;padding:14px 16px;margin:10px 0}');
  L.push('table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #26313d}');
  L.push('th{color:#9fb4cc;font-weight:600}td.num{text-align:right;font-variant-numeric:tabular-nums}');
  L.push('.bar{background:#26313d;border-radius:4px;height:8px;overflow:hidden;min-width:60px}.bar>span{display:block;height:100%}');
  L.push('.warn{color:#f4b740}.tag{display:inline-block;background:#26313d;border-radius:4px;padding:1px 6px;font-size:12px;color:#9fb4cc}');
  L.push('code{background:#26313d;border-radius:3px;padding:1px 5px;font-size:12px}');
  L.push('footer{margin-top:28px;color:#6b7a8c;font-size:12px}');
  L.push('</style></head><body>');

  L.push('<h1>disk-clean 报告</h1>');
  L.push('<div class="muted">扫描范围：' + esc(prov.rootsText) + '</div>');
  L.push('<div class="muted">生成时间：' + esc(prov.generatedLocal || '未知') +
    '（' + esc(prov.ageText) + '）' + (prov.version ? ' · 工具版本 v' + esc(prov.version) : '') +
    (prov.stale ? ' <span class="warn">⚠ 已超过 ' + esc(prov.staleHours) + ' 小时</span>' : '') + '</div>');
  if (o.generatedAt) L.push('<div class="muted">导出时间：' + esc(o.generatedAt) + '</div>');

  // 概览
  L.push('<div class="card"><table>');
  L.push('<tr><th>总大小</th><td class="num">' + esc(fmtBytes(sm.totalBytes)) + '</td>'
    + '<th>文件</th><td class="num">' + esc((sm.totalFiles || 0).toLocaleString()) + '</td>'
    + '<th>目录</th><td class="num">' + esc((sm.totalDirs || 0).toLocaleString()) + '</td>'
    + '<th>空目录</th><td class="num">' + esc((sm.emptyDirs || 0).toLocaleString()) + '</td></tr>');
  if (rep.elapsedMs) L.push('<tr><th>耗时</th><td class="num" colspan="7">' + esc((rep.elapsedMs / 1000).toFixed(1)) + ' 秒</td></tr>');
  L.push('</table></div>');

  // 类别分布
  const cats = (rep.category || []).slice();
  if (cats.length) {
    L.push('<h2>类别分布</h2><div class="card"><table>');
    L.push('<tr><th>类别</th><th>文件数</th><th>大小</th><th style="width:28%">占比</th></tr>');
    cats.slice(0, 15).forEach(function (c, i) {
      const pct = (c.bytes || 0) / total;
      L.push('<tr><td>' + esc(c.label) + '</td><td class="num">' + esc((c.count || 0).toLocaleString()) +
        '</td><td class="num">' + esc(fmtBytes(c.bytes)) + '</td><td>' + bar(pct, PALETTE[i % PALETTE.length]) +
        ' <span class="muted">' + (pct * 100).toFixed(1) + '%</span></td></tr>');
    });
    const rest = cats.slice(15).reduce(function (a, c) { return a + (c.bytes || 0); }, 0);
    if (rest > 0) L.push('<tr><td class="muted">其他类别</td><td class="num">—</td><td class="num">' + esc(fmtBytes(rest)) + '</td><td>—</td></tr>');
    L.push('</table></div>');
  }

  // 未分类 Top（T6）：让规则缺口直接可见
  const uncat = (rep.uncategorizedTop || []).filter(function (u) { return u.bytes > 0; });
  if (uncat.length) {
    L.push('<h2>未分类占用 Top</h2><div class="card"><div class="muted" style="margin-bottom:8px">' +
      '这些扩展名没有任何分类规则覆盖，都计入上面的「其他」。列出来是为了让规则缺口自己暴露。</div><table>');
    uncat.forEach(function (u) {
      L.push('<tr><td><code>' + esc(u.ext) + '</code></td><td class="num">' + esc(fmtBytes(u.bytes)) + '</td></tr>');
    });
    L.push('</table></div>');
  }

  // 智能建议
  const sugg = rep.suggestions || [];
  if (sugg.length) {
    L.push('<h2>智能建议</h2><div class="card"><table>');
    L.push('<tr><th>类型</th><th>建议</th><th>风险</th><th>预计释放</th></tr>');
    sugg.forEach(function (s) {
      L.push('<tr><td><span class="tag">' + esc(s.type || '?') + '</span></td><td>' + esc(s.title || '') + '</td>' +
        '<td>' + esc(s.risk || '—') + '</td><td class="num">' + esc(s.estBytes ? fmtBytes(s.estBytes) : '—') + '</td></tr>');
    });
    L.push('</table></div>');
  }

  // 大目录 / 大文件
  function topTable(title, list, nameKey) {
    const arr = (list || []).slice(0, 20);
    if (!arr.length) return;
    L.push('<h2>' + esc(title) + '</h2><div class="card"><table>');
    arr.forEach(function (it) {
      L.push('<tr><td>' + esc(it[nameKey] || '') + '</td><td class="num">' + esc(fmtBytes(it.bytes || it.size || 0)) + '</td></tr>');
    });
    L.push('</table></div>');
  }
  topTable('占用最大的目录', rep.topDirs, 'path');
  topTable('占用最大的文件', rep.topFiles, 'path');

  L.push('<footer>由 disk-clean v' + esc(VERSION) + ' 生成 · 单文件、离线可读 · 数据来自 ' +
    esc(o.source || 'report.json') + '</footer>');
  L.push('</body></html>');
  return L.join('\n');
}

module.exports = { render, esc, fmtBytes };
