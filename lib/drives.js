// lib/drives.js — 本地固定盘的卷容量（单一事实源，v0.7.0 v7-9）
//
// 为什么要单开一个模块：在 v7.9 之前，"列出各盘容量"这件事在仓库里**已有两份实现**
// —— `lib/mcp/tools.js` 的 listDrives() 与 `lib/serve.js` 的 listDrives()，
// 各自算一遍。CLI 的 `drives` 命令若再写第三份，就是重犯 A3（保护名单被抄成 5 份）
// 的同一个错误。故先抽成这里，三处统一调用。
//
// 铁律（PLAYBOOK 第 12 条）：盘符容量**只能用 fs.statfsSync**。
// `fs.statSync(root).blocks * 512` 得到的是**根目录自身占用的块数**（几十 KB），
// 与卷容量无关 —— 这正是 v0.3.0 "盘符显示 24kb" 事故的根因。
'use strict';
const fs = require('fs');

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, k = 0;
  while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k];
}

// 返回 [{ drive, totalBytes, usedBytes, freeBytes, availBytes,
//          totalText, usedText, freeText, availText, usedPercent,
//          total, used, free, avail }]
//
// drive 形如 'C:'（带冒号，不带反斜杠）—— 与 MCP disk_drives、GUI /api/drives 一致。
//
// 关于两组字段（重要，勿删）：`*Bytes` 是规范名，短名 `total/used/free/avail` 是
// **GUI 前端的既有消费字段**（`gui/web/app.js` 的盘符卡片读 `d.total` 与 `d.used` 算占用率）。
// 本次只统一**计算**（statfsSync + 容量算术），不改字段名以免打断前端渲染；
// 命名冗余是有意保留的兼容层，不是遗留物。
function list() {
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const ch = String.fromCharCode(i);
    const root = ch + ':\\';
    try {
      // accessSync 先确认盘符存在，避免 statfsSync 在某些盘上抛错产生噪音
      fs.accessSync(root);
      const s = fs.statfsSync(root);
      const bs = s.bsize || 4096;
      const total = bs * s.blocks;
      const free = bs * (s.bfree != null ? s.bfree : 0);
      const avail = bs * (s.bavail != null ? s.bavail : (s.bfree != null ? s.bfree : 0));
      const used = Math.max(0, total - free);
      out.push({
        drive: ch + ':',
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        availBytes: avail,
        totalText: fmtBytes(total),
        usedText: fmtBytes(used),
        freeText: fmtBytes(free),
        availText: fmtBytes(avail),
        usedPercent: total > 0 ? Math.round(used / total * 1000) / 10 : 0,
        // 兼容别名：见上方说明（GUI app.js 依赖）
        total: total,
        used: used,
        free: free,
        avail: avail,
      });
    } catch (e) { /* 盘符不存在或无权限：跳过 */ }
  }
  return out;
}

module.exports = { list, fmtBytes };
