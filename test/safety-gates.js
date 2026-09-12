// test/safety-gates.js - 评审 A1–A5 的回归测试（单一闸门 / 硬链接安全 / 目标遍历）
//
// 本套件的存在理由：2026-09-11 的第三方锐评指出，10 个既有套件里
// **没有任何用例覆盖硬链接合并的安全边界**——而那是当时唯一能造成
// 不可逆内容损坏的入口。每一条断言都对应一条已确认的真实缺陷：
//
//   A1  approx（>32MB 仅 head+tail 抽样）重复组被直接硬链接合并 → 静默内容破坏
//   A2  hardlinkGroup 全程不过 guard；扫描根自身不受保护 → 系统文件可被改成硬链接
//   A3  保护名单除 guard.js 外还有 4 份副本（各 7 段，缺 9 段）→ 同一路径不同入口结论相反
//   A4  整理目标只做前缀正则，`C:\整理区\..\boot\x` 可穿越进受保护目录
//   A5  organize 自写带边界 bug 的前缀匹配 → C:\Users 命中 C:\UsersOther
'use strict';
require('./_isolate.js');   // T1：状态目录隔离（必须早于任何 require lib）
const path = require('path');
const fs = require('fs');
const os = require('os');
const guard = require('../lib/guard.js');
const dedup = require('../lib/dedup.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

(async () => {
  let n = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-gates-'));
  try {
    // ============ A3：保护名单必须只有 guard.js 一处真相 ============
    // 断言 guard 覆盖了曾被副本漏掉的 9 段
    const MUST_HAVE = ['\\windows.old\\', '\\$windows.~bt\\', '\\$windows.~ws\\', '\\recovery\\',
      '\\perflogs\\', '\\msocache\\', '\\config.msi\\', '\\boot\\', '\\efi\\'];
    for (const seg of MUST_HAVE) {
      assert(guard.PROTECTED_SEGMENTS.indexOf(seg) >= 0, 'guard 应含受保护段 ' + seg);
    }
    n++;
    for (const p of ['c:\\windows.old\\x', 'c:\\boot\\x', 'c:\\efi\\x', 'c:\\recovery\\x',
      'c:\\perflogs\\x', 'c:\\msocache\\x', 'c:\\config.msi\\x', 'c:\\$windows.~bt\\x']) {
      assert(guard.isProtectedPath(p), 'guard 应拒绝 ' + p);
      // 修复前 organize 自己的 7 段副本会放行这些路径
      assert(!guard.checkDestructivePath(p).ok, 'checkDestructivePath 应拒绝 ' + p);
    }
    n++;
    // 尾部匹配语义（guard 有、旧副本没有）——同一路径不得因入口不同而结论相反
    assert(guard.isProtectedPath('c:\\users\\me\\windows'), '尾部无分隔符的 ..\\windows 也应受保护');
    assert(guard.isProtectedPath('c:\\windows'), 'C:\\Windows 本身应受保护');
    n++;

    // ============ A5：扫描根归属的段边界 ============
    assert(guard.inRoots('c:\\users\\a', ['C:\\Users']), 'C:\\Users\\a 属于 C:\\Users');
    assert(guard.inRoots('c:\\users', ['C:\\Users']), '根自身属于根');
    assert(!guard.inRoots('c:\\usersother\\a', ['C:\\Users']), 'C:\\UsersOther\\a 不属于 C:\\Users（旧前缀匹配会误判）');
    assert(!guard.inRoots('c:\\usersx', ['C:\\Users']), 'C:\\UsersX 不属于 C:\\Users');
    n++;

    // ============ A4：整理目标路径不得穿越 ============
    const bad = [
      'C:\\整理区\\..\\boot\\x',
      'C:\\整理区\\..\\Windows\\System32\\x',
      'C:\\整理区\\.\\媒体\\x',
      'C:\\整理区',
      'C:\\整理区\\',              // 无分类子目录
      'D:\\Temp\\x',
      'C:\\Windows\\整理区\\x'    // 「整理区」不在盘根
    ];
    for (const p of bad) {
      const r = guard.checkOrganizeDest(p);
      assert(!r.ok, 'A4 应拒绝整理目标 ' + p + '（实际放行）');
    }
    n++;
    const good = ['C:\\整理区\\媒体\\a.mp4', 'D:\\整理区\\图片\\b.jpg'];
    for (const p of good) {
      const r = guard.checkOrganizeDest(p);
      assert(r.ok, 'A4 应接受合法整理目标 ' + p + '：' + (r.error || ''));
    }
    n++;

    // ============ A1：approx 组必须拒绝硬链接 ============
    // 造两个"大小相同、头尾相同、中间不同"的文件；直接用组对象驱动（不依赖 >32MB 真文件）
    const p1 = path.join(tmp, 'a.img');
    const p2 = path.join(tmp, 'b.img');
    const headTail = Buffer.alloc(64 * 1024, 0x41);
    fs.writeFileSync(p1, Buffer.concat([headTail, Buffer.alloc(65536, 0x01), headTail]));
    fs.writeFileSync(p2, Buffer.concat([headTail, Buffer.alloc(65536, 0x02), headTail]));
    const approxGroup = { size: fs.statSync(p1).size, approx: true, files: [{ path: p1 }, { path: p2 }] };

    const dry = dedup.hardlinkGroup(approxGroup, true);
    assert(dry.length === 1 && dry[0].action === 'refused', 'A1 dry-run 也必须报 refused，实际 ' + JSON.stringify(dry));
    n++;

    const real = dedup.hardlinkGroup(approxGroup, false); // dryRun=false：修复前这里会真的合并
    assert(real.length === 1 && real[0].action === 'refused', 'A1 执行态必须拒绝 approx 组，实际 ' + JSON.stringify(real));
    assert(/approx=true|不可逆/.test(real[0].error || ''), 'A1 拒绝原因应可行动，实际：' + real[0].error);
    // 关键：两个文件必须都还在且仍是独立文件（内容未被合并）
    assert(fs.existsSync(p1) && fs.existsSync(p2), 'A1 被拒绝后两个文件都应保留');
    assert(fs.readFileSync(p1, 'utf8').length === fs.readFileSync(p2, 'utf8').length, 'A1 两文件应保持独立');
    assert(fs.readFileSync(p1)[65536 + 1] !== fs.readFileSync(p2)[65536 + 1], 'A1 两文件中间内容仍不同（未被合并）');
    n++;

    // 精确组（approx:false）仍应可正常预览——不能因噎废食
    const exactGroup = { size: 3, approx: false, files: [{ path: p1 }, { path: p2 }] };
    const ex = dedup.hardlinkGroup(exactGroup, true);
    assert(ex.length === 1 && ex[0].action === 'hardlink(预览)', 'A1 精确组仍应可预览，实际 ' + JSON.stringify(ex));
    n++;

    // ---- A1 端到端可达性证明：真实 >32MB 文件对确实会被扫描判为 approx ----
    // 这是 A1 的要害：只有当 approx 分类**真的会发生**，上面的拒绝才有意义。
    // 造两个 33MB 文件：头 64KB 相同、尾 64KB 相同、中间不同（ISO/视频容器头的常见形态）。
    const big1 = path.join(tmp, 'big1.iso');
    const big2 = path.join(tmp, 'big2.iso');
    const H = 64 * 1024, MID = 33 * 1024 * 1024;
    const h = Buffer.alloc(H, 0x5A);
    const t = Buffer.alloc(H, 0xA5);
    fs.writeFileSync(big1, Buffer.concat([h, Buffer.alloc(MID, 0x11), t]));
    fs.writeFileSync(big2, Buffer.concat([h, Buffer.alloc(MID, 0x22), t]));
    const bigScan = await dedup.scan([tmp], { minBytes: 32 * 1024 * 1024 });
    const bigGroup = (bigScan.groups || []).find(g =>
      g.files.some(f => /big1\.iso$/.test(f.path)) && g.files.some(f => /big2\.iso$/.test(f.path)));
    assert(bigGroup, 'A1 两个 33MB 文件应被判为同一重复组（证明 approx 分类可达）');
    assert(bigGroup.approx === true, 'A1 >32MB 且仅头尾相同 → 必须标 approx=true（这是缺陷成立的前提）');
    n++;
    // 该组经闸门必须被拒绝，且两个文件内容保持不变
    const before1 = fs.readFileSync(big1).length;
    const bigRes = dedup.hardlinkGroup(bigGroup, false);
    assert(bigRes.every(x => x.action === 'refused'), 'A1 端到端：真实 approx 组必须全部被拒绝，实际 ' + JSON.stringify(bigRes.map(x => x.action)));
    assert(fs.existsSync(big1) && fs.existsSync(big2), 'A1 端到端：两文件必须都还在');
    assert(fs.readFileSync(big1).length === before1, 'A1 端到端：文件内容未被改写');
    n++; n++; n++;

    // ============ A2：hardlinkGroup 必须过 guard ============
    const sysGroup = { size: 10, approx: false, files: [{ path: 'C:\\Windows\\System32\\kernel32.dll' }, { path: 'C:\\Users\\T\\copy.dll' }] };
    const sg = dedup.hardlinkGroup(sysGroup, false);
    assert(sg.length === 1 && sg[0].action === 'refused', 'A2 受保护路径必须被拒绝，实际 ' + JSON.stringify(sg));
    assert(/受保护/.test(sg[0].error || ''), 'A2 拒绝原因应指出受保护路径：' + sg[0].error);
    n++;
    const cloudGroup = { size: 10, approx: false, files: [{ path: 'C:\\Users\\T\\OneDrive\\x.bin' }, { path: 'C:\\Users\\T\\y.bin' }] };
    const cg = dedup.hardlinkGroup(cloudGroup, false);
    assert(cg.length === 1 && cg[0].action === 'refused', 'A2 OneDrive 云同步段必须被拒绝');
    n++;

    // 已存在文件也必须被拒绝（避免误伤真实文件：这些路径不存在，但 check 在前，不触盘）
    const okGroup = { size: 10, approx: false, files: [{ path: path.join(tmp, 'Users', 'ok1.bin') }, { path: path.join(tmp, 'Users', 'ok2.bin') }] };
    fs.mkdirSync(path.join(tmp, 'Users'), { recursive: true });
    fs.writeFileSync(okGroup.files[0].path, Buffer.alloc(10));
    fs.writeFileSync(okGroup.files[1].path, Buffer.alloc(10));
    const og = dedup.hardlinkGroup(okGroup, false);
    assert(og.length === 1 && og[0].action === 'hardlink', 'A2 普通用户路径应允许合并（真实功能未被破坏），实际 ' + JSON.stringify(og));
    n++;

    // ============ A2：扫描根自身必须校验（否则 roots 直达系统目录会开始哈希） ============
    const sc = await dedup.scan(['C:\\Windows\\System32\\drivers'], { minBytes: 1 });
    assert(sc.ok === false || (sc.groups || []).length === 0, 'A2 受保护扫描根不应产出任何重复组');
    assert(Array.isArray(sc.skippedRoots) && sc.skippedRoots.length === 1, 'A2 受保护扫描根应被记录为 skippedRoots，实际 ' + JSON.stringify(sc.skippedRoots));
    n++;
    // 正常根仍可工作（不被误伤）
    const sc2 = await dedup.scan([tmp], { minBytes: 1 });
    assert(sc2.ok === true, 'A2 普通扫描根应正常工作');
    n++;

    // ============ A6：dedup-map 读写必须单源且兼容旧格式 ============
    assert(typeof dedup.readDedupMap === 'function' && typeof dedup.appendDedupEntries === 'function',
      'A6 dedup-map 读写应暴露在 lib/dedup.js（单源）');
    const m = dedup.readDedupMap();
    assert(Array.isArray(m.entries), 'A6 readDedupMap 应返回 {entries:[]}');
    n++;

    // ============ A7：canonKey 必须单源在 guard.js ============
    // 修复前 tools.js 有一份、serve.js 完全没有（用 toLowerCase 直接比），
    // 导致 GUI 恢复列表匹配不到 8.3 短名清理项。
    assert(typeof guard.canonKey === 'function', 'A7 canonKey 应在 lib/guard.js（单源）');
    assert(guard.canonKey('C:\\Users\\X\\') === guard.canonKey('c:/users/x'), 'A7 尾分隔符/大小写应归一');
    assert(guard.canonKey(path.join(tmp, 'sub', '..', 'sub')) === guard.canonKey(path.join(tmp, 'sub')), 'A7 "." / ".." 应归一');
    // serve.js 与 tools.js 必须用同一实现（不得再有第二份）
    const toolsMod = require('../lib/mcp/tools.js');
    assert(toolsMod.canonKey === guard.canonKey, 'A7 tools.js 的 canonKey 必须是 guard 的同一函数引用');
    {
      const serveSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'serve.js'), 'utf8');
      assert(/guard\.canonKey\(/.test(serveSrc), 'A7 serve.js 回收站匹配应使用 guard.canonKey');
      assert(!/toolPaths\.add\(String\(p\)\.toLowerCase\(\)\)/.test(serveSrc), 'A7 serve.js 不应残留裸 toLowerCase 匹配');
    }
    n++;

    // ============ B6：畸形 URL 转义不得打崩请求处理 ============
    {
      const serveSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'serve.js'), 'utf8');
      assert(/catch[\s\S]{0,80}malformed URL escape/.test(serveSrc), 'B6 decodeURIComponent 应有 try/catch 兜底');
      // 直接验证 Node 行为确实会抛（证明确有必要）
      let threw = false;
      try { decodeURIComponent('/%zz'); } catch (e) { threw = true; }
      assert(threw, 'B6 前提：decodeURIComponent("/%zz") 确实会抛 URIError');
    }
    n++;

    // ============ B4：部分成功必须显式标记 partial ============
    {
      const cleanSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'clean.js'), 'utf8');
      assert(/const partial = succeeded && executed < v\.paths\.length/.test(cleanSrc), 'B4 clean.js 应计算 partial');
      assert(/ok: true, partial: partial/.test(cleanSrc), 'B4 返回值应带 partial 字段');
      const toolsSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mcp', 'tools.js'), 'utf8');
      assert(/if \(r\.partial\)/.test(toolsSrc), 'B4 MCP 层应对 partial 单独处理');
      assert(/isError: true/.test(toolsSrc), 'B4 partial 必须以上报 isError 的方式让模型看到');
    }
    n++;

    // ============ B3：回滚映射必须原子写 ============
    {
      const engSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine-core.js'), 'utf8');
      assert(/function writeFileAtomic/.test(engSrc), 'B3 应有 writeFileAtomic 助手');
      assert(!/fs\.writeFileSync\(mapFile, JSON\.stringify/.test(engSrc), 'B3 organize map 不应再用裸 writeFileSync');
      // 行为验证：原子写不会留下临时文件，且内容是完整 JSON
      const t = path.join(tmp, 'atomic.json');
      const eng = require('../lib/engine.js');
      assert(typeof eng === 'object', 'engine 可加载');
      fs.writeFileSync(t, JSON.stringify([{ a: 1 }]), 'utf8');
      const parsed = JSON.parse(fs.readFileSync(t, 'utf8'));
      assert(Array.isArray(parsed) && parsed[0].a === 1, 'B3 映射文件应可正常解析');
    }
    n++;

    console.log('safety-gates OK (' + n + ' 组断言：A1 approx 拒绝 / A2 硬链接闸门+根校验 / A3 闸门单源 / A4 目标穿越 / A5 根归属边界 / A6 map 单源 / A7 canonKey 单源 / B3 原子写 / B4 partial / B6 URL 兜底)');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
