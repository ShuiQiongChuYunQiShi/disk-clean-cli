'use strict';
// lib/suggest.js — "你是不是想用……"（E2/E3）
//
// 为什么单独一个模块：这个能力要同时服务 CLI 与 MCP（三面同源原则）。
// 在两边各写一份编辑距离，必然漂移。
//
// 关于阈值：PRODUCT-REVIEW 写的是"编辑距离 ≤2 即可"，但它自己举的例子
// `junk` → `junk-temp` 的编辑距离其实是 **5**（插入 "-temp"）。所以只有编辑距离
// 是不够的——真实场景里用户输的往往是**前缀**（junk / empty / dup / recycle）。
// 这里组合三条判据，按优先级：
//   ① 前缀关系（`junk` → `junk-temp`）
//   ② 分词命中（按 - 或 _ 切分后某一段相等，如 `temp` → `junk-temp`）
//   ③ 编辑距离 ≤2（覆盖拼写错误，如 `junl-tmep` / `emty-dirs`）
// 全部不命中就**不给建议**——胡乱猜一个比不猜更让人困惑。

function distance(a, b) {
  const s = String(a), t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = new Array(t.length + 1);
  let cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[t.length];
}

// 返回 { match, reason } 或 null。candidates 可以是字符串数组或对象数组 + keyOf。
function nearest(input, candidates, keyOf) {
  const q = String(input == null ? '' : input).trim().toLowerCase();
  if (!q) return null;
  const key = keyOf || function (c) { return c; };
  let best = null;
  for (const c of candidates) {
    const raw = key(c);
    const t = String(raw).toLowerCase();
    if (t === q) return { match: raw, reason: 'exact', distance: 0 };
    let score = null, reason = null;
    if (t.startsWith(q) || q.startsWith(t)) { score = 1; reason = 'prefix'; }
    else if (t.split(/[-_./]/).indexOf(q) >= 0) { score = 1.5; reason = 'segment'; }
    else {
      const d = distance(q, t);
      if (d <= 2) { score = 2 + d; reason = 'distance'; }
    }
    if (score !== null && (!best || score < best.distance)) best = { match: raw, reason: reason, distance: score };
  }
  return best;
}

// 直接给出可放进错误信息的一句话；没有把握时返回 null（调用方就不提建议）
function hint(input, candidates, keyOf) {
  const n = nearest(input, candidates, keyOf);
  if (!n || n.reason === 'exact') return null;
  return '是否想用 ' + n.match + '？';
}

module.exports = { distance, nearest, hint };
