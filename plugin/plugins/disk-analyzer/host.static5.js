// Windows 磁盘分析器 —— 宿主半（静态插件：agent.cordis.yml 直接引用，免 cordis_define）
// 安装：将整个 preset 目录复制到 ${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/（保持
// plugins/disk-analyzer/host.static5.js 相对结构）。DSK_DIR 自动推导为 preset 根目录
// （本文件上溯两级），必需可写，因为 .dsk-prog.json/.dsk-audit.json/.dsk-organize-plan.json
// .dsk-organize-map.json 等运行时文件都写在该目录。
let DSK_DIR
try {
  const pathMod = require('node:path')
  DSK_DIR = pathMod.resolve(__dirname, '..', '..')
} catch (e) {
  DSK_DIR = 'C:\\Users\\Administrator\\.dsh\\.agent-presets\\disk-analyzer'
}
module.exports = {
  name: 'dsk-analyzer',
  inject: ['timer', 'tools'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    const subprocess = ctx.get('subprocess')
    const decoder = new TextDecoder()

    const BS = String.fromCharCode(92)
    const HELPER = DSK_DIR + BS + "plugins\\dsk-helper.js"
    const ADV_HELPER = DSK_DIR + BS + "plugins\\dsk-adv.js"
    const PROG_FILE = DSK_DIR + BS + '.dsk-prog.json'
    const AUDIT_FILE = DSK_DIR + BS + '.dsk-audit.json'
    const PLAN_FILE = DSK_DIR + BS + '.dsk-organize-plan.json'
    const MAP_FILE = DSK_DIR + BS + '.dsk-organize-map.json'
    const REPORT_FILE = DSK_DIR + BS + '.dsk-report.json'
    const FIX_FILE = DSK_DIR + BS + '.dsk-fix-shortcuts.json'
    const RESTORE_FILE = DSK_DIR + BS + '.dsk-restore-shortcuts.json'
    const HEALTH_FILE = DSK_DIR + BS + '.dsk-health.json'
    const HEALTH_HISTORY_FILE = DSK_DIR + BS + '.dsk-health-history.json'
    const DEDUP_MAP_FILE = DSK_DIR + BS + '.dsk-dedup-map.json'
    const CWD = 'C:' + BS
    const MAX_OUT = 64 << 20
    const SYS_PREFIX = ['\\windows\\', '\\program files\\', '\\program files (x86)\\', '\\programdata\\', '\\winsxs\\', '\\system volume information\\', '\\$recycle.bin\\']
    const TEMP_SEG = ['temp', 'tmp', 'cache', 'prefetch', 'thumbcache', 'iconcache']
    const ORG_CAT = { '安装包':'安装包', '文档':'文档', '媒体':'媒体', '图片':'图片', '压缩包':'压缩包', '虚拟磁盘':'虚拟磁盘', '备份':'备份', '数据库':'数据库' }
    const USER_ROOTS = ['downloads', 'desktop', 'documents', 'pictures', 'videos', 'music']

    let cancelled = false
    let scan = null
    let NODE = null

    function low(s) { return String(s || '').toLowerCase() }
    function fmtBytes(n) {
      if (!n || n < 0) return '0 B'
      const u = ['B','KB','MB','GB','TB']
      let v = n, k = 0
      while (v >= 1024 && k < u.length - 1) { v /= 1024; k++ }
      return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k]
    }
    function escPS(p) { return String(p).replace(/'/g, "''") }
    function utf16leB64(str) {
      const bytes = []
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i)
        bytes.push(c & 0xFF, (c >> 8) & 0xFF)
      }
      let bin = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192))
      }
      return btoa(bin)
    }
    function extOf(name) {
      const i = name.lastIndexOf('.')
      return i > 0 ? name.slice(i + 1).toLowerCase() : ''
    }
    function catOfFile(name) {
      const e = extOf(name)
      if (!e) return '其他'
      const map = {
        mp4:'媒体',mkv:'媒体',mov:'媒体',avi:'媒体',wmv:'媒体',flv:'媒体',webm:'媒体',m4v:'媒体',ts:'媒体',mp3:'媒体',flac:'媒体',wav:'媒体',aac:'媒体',ogg:'媒体',m4a:'媒体',wma:'媒体',opus:'媒体',mid:'媒体',
        jpg:'图片',jpeg:'图片',png:'图片',gif:'图片',webp:'图片',bmp:'图片',svg:'图片',ico:'图片',tif:'图片',tiff:'图片',raw:'图片',heic:'图片',psd:'图片',ai:'图片',avif:'图片',
        doc:'文档',docx:'文档',xls:'文档',xlsx:'文档',ppt:'文档',pptx:'文档',pdf:'文档',txt:'文档',md:'文档',rtf:'文档',csv:'文档',epub:'文档',pages:'文档',numbers:'文档',key:'文档',
        zip:'压缩包',rar:'压缩包','7z':'压缩包',tar:'压缩包',gz:'压缩包',bz2:'压缩包',xz:'压缩包',iso:'压缩包',cab:'压缩包',zst:'压缩包',
        exe:'安装包',msi:'安装包',msix:'安装包',appx:'安装包',dmg:'安装包',
        db:'数据库',sqlite:'数据库',sqlite3:'数据库',mdf:'数据库',ldf:'数据库',accdb:'数据库',mdb:'数据库',
        vhd:'虚拟磁盘',vhdx:'虚拟磁盘',vmdk:'虚拟磁盘',vdi:'虚拟磁盘',
        bak:'备份',old:'备份',
        log:'日志',tmp:'临时',temp:'临时',dmp:'日志',
        dll:'系统',sys:'系统'
      }
      return map[e] || '其他'
    }

    async function ensureNode() {
      if (NODE) return NODE
      if (subprocess && subprocess.resolveExecutable) {
        try { NODE = await subprocess.resolveExecutable('node') } catch (e) { /* fallback */ }
      }
      if (!NODE) NODE = 'C:' + BS + 'Program Files' + BS + 'nodejs' + BS + 'node.exe'
      return NODE
    }

    async function parseHelperOut(handle) {
      const read = handle.collected.stdout.readFrom(0)
      const text = read.text
      const idx = text.lastIndexOf('\n')
      return JSON.parse((idx >= 0 ? text.slice(idx + 1) : text).trim())
    }

    async function readJsonFile(p) {
      try {
        const t = await fs.resolve(p)
        const buf = await fs.readBytes(t, undefined, 4 << 20)
        return JSON.parse(decoder.decode(buf))
      } catch (e) { return null }
    }

    async function readProgressFile() {
      return await readJsonFile(PROG_FILE)
    }

    // ---------- 扫描（subprocess 驱动辅助进程） ----------
    async function runScan(targets, exclude, withSuggest) {
      try {
        const node = await ensureNode()
        const argv = [node, HELPER, '--roots', targets.map(function(t){ return t.displayPath }).join(';'), '--progress', PROG_FILE, '--time', '--report', REPORT_FILE]
        if (withSuggest) argv.push('--suggest')
        if (exclude.length > 0) argv.push('--exclude', exclude.join(';'))
        const handle = subprocess.spawn({
          argv: argv,
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUT }, stderr: { maxBytes: 1 << 20 } },
          graceMs: 3000
        })
        scan.helper = handle
        const outcome = await handle.done.catch(function() { return null })
        if (scan === null) return
        if (cancelled) {
          scan.status = 'cancelled'
        } else if (outcome && outcome.code === 2) {
          scan.status = 'error'; scan.error = '辅助进程异常退出'
        } else {
          try {
            const parsed = await parseHelperOut(handle)
            if (parsed && parsed.summary) {
              scan.results = parsed
              scan.status = parsed.summary.status === 'cancelled' ? 'cancelled' : 'done'
              scan.error = null
            } else {
              scan.status = 'error'; scan.error = '辅助进程输出为空或格式错误'
            }
          } catch (e) {
            scan.status = 'error'; scan.error = '解析辅助进程输出失败: ' + (e && e.message ? e.message : String(e))
          }
        }
      } catch (e) {
        if (scan === null) return
        if (cancelled) { scan.status = 'cancelled' }
        else { scan.status = 'error'; scan.error = e && e.message ? e.message : String(e) }
      }
      scan.finishedAt = Date.now()
      scan.elapsedMs = scan.finishedAt - scan.startedAt
    }

    // ---------- 磁盘信息 ----------
    async function getDriveUsage() {
      if (subprocess === undefined) return null
      try {
        const handle = subprocess.spawn({
          argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            'Get-PSDrive -PSProvider FileSystem | ForEach-Object { "{0} {1} {2}" -f $_.Name,$_.Used,$_.Free }'],
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 1 << 16 } },
          graceMs: 3000
        })
        const doneP = handle.done.catch(function() { return null })
        const outcome = await Promise.race([
          doneP,
          ctx.timeout(8000).then(function() { handle.terminate(); return null })
        ])
        if (!outcome || !handle.collected.stdout) return null
        const read = handle.collected.stdout.readFrom(0)
        const usage = {}
        const lines = read.text.split(/\r?\n/).filter(Boolean)
        for (const line of lines) {
          const m = line.match(/^([A-Za-z])\s+(\d+)\s+(\d+)$/)
          if (m) usage[m[1]] = { used: Number(m[2]), free: Number(m[3]) }
        }
        return Object.keys(usage).length ? usage : null
      } catch (e) {
        return null
      }
    }

    async function listDrives() {
      const usage = await getDriveUsage()
      if (usage) return { letters: Object.keys(usage).sort(), usage: usage }
      const letters = []
      for (let c = 67; c <= 90; c++) {
        const ch = String.fromCharCode(c)
        try {
          await fs.resolve(ch + ':' + String.fromCharCode(92))
          letters.push(ch)
        } catch (e) { /* 不存在 */ }
      }
      return { letters: letters, usage: null }
    }

    // ---------- 具名处理函数（供 RPC 与动态工具共用） ----------
    async function doStart(args) {
      if (scan && scan.status === 'running') return { ok: false, error: '已有扫描在进行中' }
      const roots = (args && Array.isArray(args.roots)) ? args.roots : []
      const exclude = (args && Array.isArray(args.exclude)) ? args.exclude.map(low) : []
      const withSuggest = !(args && args.suggest === false)
      const targets = []
      for (const r of roots) {
        try { targets.push(await fs.resolve(r)) } catch (e) { /* 跳过无效目标 */ }
      }
      if (targets.length === 0) return { ok: false, error: '没有有效的扫描目标' }
      cancelled = false
      const usage = await getDriveUsage()
      scan = {
        status: 'running',
        startedAt: Date.now(),
        finishedAt: 0,
        elapsedMs: 0,
        roots: targets.map(function(t){ return t.displayPath }),
        exclude: exclude,
        driveUsage: usage,
        helper: null,
        progress: {
          files: 0, dirs: 0, bytes: 0, emptyDirs: 0, currentPath: '',
          skipped: { permission: 0, cycle: 0, protected: 0, excluded: 0, deep: 0, error: 0 }
        },
        results: null,
        error: null
      }
      runScan(targets, exclude, withSuggest)
      return { ok: true, roots: scan.roots, suggest: withSuggest }
    }

    async function doStatus() {
      if (!scan) return { status: 'idle' }
      if (scan.status === 'running') {
        const p = await readProgressFile()
        if (p) {
          scan.progress.files = p.files || 0
          scan.progress.dirs = p.dirs || 0
          scan.progress.bytes = p.bytes || 0
          scan.progress.emptyDirs = p.emptyDirs || 0
          scan.progress.currentPath = p.currentPath || ''
          if (p.skipped) scan.progress.skipped = p.skipped
        }
      }
      return {
        status: scan.status,
        progress: scan.progress,
        elapsedMs: scan.status === 'running' ? Date.now() - scan.startedAt : scan.elapsedMs,
        roots: scan.roots,
        error: scan.error || null
      }
    }

    function doCancel() {
      if (scan && scan.status === 'running') {
        cancelled = true
        if (scan.helper) { try { scan.helper.terminate() } catch (e) { /* ignore */ } }
        return { ok: true }
      }
      return { ok: false, error: '当前没有运行中的扫描' }
    }

    async function doReport() {
      if (!scan) return { ok: false, error: '尚未扫描' }
      if (scan.status === 'running') return { ok: false, error: '扫描仍在进行中' }
      if (!scan.results) return { ok: false, error: scan.error || '没有可用结果' }
      const r = scan.results
      const driveArr = scan.roots.map(function(root) {
        const m = root.match(/^([A-Za-z]):/)
        return { letter: m ? m[1] : '?', root: root }
      })
      const sm = r.summary || {}
      // 目录整理候选（A 类散落目录）只写在报告文件中
      let organize = null
      let markdown = null
      let mdFile = null
      const rep = await readJsonFile(REPORT_FILE)
      if (rep && Array.isArray(rep.organizeCandidates)) {
        let programHints = 0
        const programItems = []
        for (const s of (rep.suggestions || [])) {
          if (s.type === 'organize-folders') for (const it of (s.items || [])) {
            if (it.kind === 'program') { programHints++; programItems.push(it) }
          }
        }
        organize = { looseCandidates: rep.organizeCandidates.length, programHints: programHints, programItems: programItems, reportFile: REPORT_FILE }
      }
      // Markdown 详细报告（引擎生成，与 JSON 同目录）
      try {
        const mdPath = REPORT_FILE.replace(/\.json$/i, '') + '.md'
        const t = await fs.resolve(mdPath)
        const buf = await fs.readBytes(t, undefined, 4 << 20)
        mdFile = mdPath
        markdown = decoder.decode(buf)
      } catch (e) { mdFile = null; markdown = null }
      return {
        ok: true,
        reportFile: REPORT_FILE,
        mdFile: mdFile,
        markdown: markdown,
        note: '完整 JSON 报告已写入 ' + REPORT_FILE + '；可读 Markdown 报告已写入 ' + (mdFile || REPORT_FILE.replace(/\.json$/i, '') + '.md（未找到）') + '。此处为紧凑摘要。',
        summary: {
          roots: scan.roots,
          drives: driveArr,
          driveUsage: scan.driveUsage,
          totalFiles: sm.totalFiles || 0,
          totalDirs: sm.totalDirs || 0,
          totalBytes: sm.totalBytes || 0,
          emptyDirs: sm.emptyDirs || 0,
          skipped: sm.skipped || scan.progress.skipped,
          elapsedMs: scan.elapsedMs || (sm.elapsedMs || 0),
          scannedAt: sm.scannedAt || '',
          status: scan.status,
          error: scan.error || null,
          appZoneFiles: sm.appZoneFiles || 0,
          appZoneBytes: sm.appZoneBytes || 0,
          dupScan: sm.dupScan || null
        },
        category: r.category || [],
        extTop: r.extTop || [],
        topDirs: r.topDirs || [],
        topFiles: r.topFiles || [],
        junk: r.junk || [],
        emptyDirSample: r.emptyDirSample || [],
        timeBuckets: r.timeBuckets || null,
        suggestions: r.suggestions || [],
        organize: organize
      }
    }

    async function doDir(path) {
      if (!path) return { ok: false, error: '缺少路径' }
      try {
        const node = await ensureNode()
        const handle = subprocess.spawn({
          argv: [node, HELPER, '--dir', path],
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 8 << 20 }, stderr: { maxBytes: 1 << 16 } },
          graceMs: 3000
        })
        const outcome = await handle.done.catch(function() { return null })
        if (!outcome) return { ok: false, error: '下钻子进程异常退出' }
        const parsed = await parseHelperOut(handle)
        if (parsed && parsed.ok) return parsed
        return { ok: false, error: '无法列出目录内容' }
      } catch (e) {
        return { ok: false, error: '无法访问该路径' }
      }
    }

    async function doDrives() {
      const info = await listDrives()
      if (scan && scan.driveUsage) info.usage = scan.driveUsage
      return { letters: info.letters, usage: info.usage }
    }

    // ---------- 清理执行（安全：白名单校验 + DSH 审批 + 回收站优先 + 审计） ----------
    function inScanRoots(lp) {
      return scan.roots.some(function(r) { return lp.indexOf(low(r)) === 0 })
    }

    function isSafeZone(lp) {
      return SYS_PREFIX.every(function(pre) { return lp.indexOf(pre) < 0 })
    }

    function hasTempSegment(lp) {
      const segs = lp.split(BS)
      return segs.some(function(s) { return TEMP_SEG.some(function(t) { return s === t || s.indexOf(t) === 0 }) })
    }

    function validateCleanArgs(type, paths) {
      const err = function(msg) { return { ok: false, error: msg } }
      if (!scan || !scan.results) return err('请先完成扫描')
      if (scan.status === 'running') return err('扫描仍在进行中')
      const sugg = (scan.results.suggestions || [])
      if (type === 'recycle-bin') return { ok: true, paths: [], estBytes: 0 }
      if (!Array.isArray(paths) || paths.length === 0) return err('缺少清理路径')
      if (paths.length > 500) return err('单次清理路径过多（>500）')
      for (const p of paths) {
        const lp = low(p)
        if (!inScanRoots(lp)) return err('路径不在扫描范围内：' + p)
      }
      if (type === 'duplicates') {
        const dupGroups = sugg.filter(function(s) { return s.type === 'duplicates' }).reduce(function(a, s) { return a.concat(s.groups || []) }, [])
        const removableSet = {}
        for (const g of dupGroups) for (const p of g.removable) removableSet[low(p)] = g.size
        for (const p of paths) {
          if (!removableSet[low(p)]) return err('路径不在重复文件建议清单中：' + p)
          if (!isSafeZone(low(p))) return err('拒绝清理系统目录：' + p)
        }
        return { ok: true, paths: paths, estBytes: paths.reduce(function(a, p) { return a + (removableSet[low(p)] || 0) }, 0) }
      }
      if (type === 'empty-dirs') {
        const emptySet = {}
        for (const p of (scan.results.emptyDirSample || [])) emptySet[low(p)] = 1
        for (const p of paths) if (!emptySet[low(p)]) return err('路径不在空文件夹清单中：' + p)
        return { ok: true, paths: paths, estBytes: 0 }
      }
      if (type === 'junk-temp') {
        for (const p of paths) {
          if (!hasTempSegment(low(p))) return err('路径不在临时/缓存目录中：' + p)
        }
        const tempSugg = sugg.find(function(s) { return s.type === 'junk-temp' })
        let est = 0
        if (tempSugg) for (const it of (tempSugg.items || [])) est += it.bytes || 0
        return { ok: true, paths: paths, estBytes: est }
      }
      return err('未知清理类型：' + type)
    }

    async function runPowerShell(script) {
      const b64 = utf16leB64(script)
      const handle = subprocess.spawn({
        argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
        cwd: CWD,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 1 << 20 } },
        graceMs: 5000
      })
      const doneP = handle.done.catch(function() { return null })
      const outcome = await Promise.race([
        doneP,
        ctx.timeout(30000).then(function() { handle.terminate(); return null })
      ])
      const text = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
      const errText = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
      return { outcome: outcome, out: text, err: errText }
    }

    // 写文件（subprocess 方式，绕开 ctx.fs 沙箱对工作区外/新文件的限制）
    async function writeTextFile(p, content) {
      const node = await ensureNode()
      const handle = subprocess.spawn({
        argv: [node, '-e', 'const fs=require("fs");fs.writeFileSync(process.argv[1],process.argv[2],"utf8");', p, content],
        cwd: CWD,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 16 }, stderr: { maxBytes: 1 << 16 } },
        graceMs: 5000
      })
      const outcome = await handle.done.catch(function() { return null })
      if (!outcome) throw new Error('写文件子进程异常退出')
    }

    async function appendAudit(entry) {
      try {
        let list = []
        try {
          const t = await fs.resolve(AUDIT_FILE)
          const buf = await fs.readBytes(t, undefined, 1 << 20)
          list = JSON.parse(decoder.decode(buf))
          if (!Array.isArray(list)) list = []
        } catch (e) { /* 首次 */ }
        list.push(entry)
        await writeTextFile(AUDIT_FILE, JSON.stringify(list, null, 2))
        return true
      } catch (e) {
        console.log('[dsk] appendAudit failed: ' + (e && e.message ? e.message : String(e)))
        return false
      }
    }

    async function runOrganize(plan) {
      try {
        await writeTextFile(PLAN_FILE, JSON.stringify(plan))
        const node = await ensureNode()
        const handle = subprocess.spawn({
          argv: [node, HELPER, '--organize', '--plan', PLAN_FILE, '--map', MAP_FILE],
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 8 << 20 }, stderr: { maxBytes: 1 << 16 } },
          graceMs: 5000
        })
        const outcome = await handle.done.catch(function() { return null })
        if (!outcome) return { ok: false, error: '整理子进程异常退出' }
        const parsed = await parseHelperOut(handle)
        return parsed
      } catch (e) {
        return { ok: false, error: '整理执行失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    // 快捷方式修复：把指向已移动目录的 .lnk 重写到新路径（修改记录挂到 map 最后一批，供回滚）
    async function runFixShortcuts(pairs) {
      try {
        await writeTextFile(FIX_FILE, JSON.stringify(pairs))
        const node = await ensureNode()
        const handle = subprocess.spawn({
          argv: [node, HELPER, '--fix-shortcuts', FIX_FILE, '--map', MAP_FILE],
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 8 << 20 }, stderr: { maxBytes: 1 << 16 } },
          graceMs: 5000
        })
        const outcome = await handle.done.catch(function() { return null })
        if (!outcome) return { ok: false, error: '快捷方式修复子进程异常退出' }
        return await parseHelperOut(handle)
      } catch (e) {
        return { ok: false, error: '快捷方式修复失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    // 快捷方式恢复：把修复记录里的 .lnk 写回旧目标
    async function runRestoreShortcuts(fixes) {
      try {
        await writeTextFile(RESTORE_FILE, JSON.stringify(fixes))
        const node = await ensureNode()
        const handle = subprocess.spawn({
          argv: [node, HELPER, '--restore-shortcuts', RESTORE_FILE],
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 8 << 20 }, stderr: { maxBytes: 1 << 16 } },
          graceMs: 5000
        })
        const outcome = await handle.done.catch(function() { return null })
        if (!outcome) return { ok: false, error: '快捷方式恢复子进程异常退出' }
        return await parseHelperOut(handle)
      } catch (e) {
        return { ok: false, error: '快捷方式恢复失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    async function askApproval(reason) {
      const agents = ctx.get('agents')
      const approval = ctx.get('approval')
      if (!agents || !approval) return { err: '审批服务不可用' }
      const agent = agents.currentInitiator()
      if (!agent) return { err: '无法确定当前会话' }
      try {
        const outcome = await approval.request({ agent: agent, toolName: 'disk_organize', reason: reason })
        if (outcome !== 'allowed-once') return { err: '用户未批准（' + String(outcome) + '）' }
        return {}
      } catch (e) {
        return { err: '审批流程失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    // 递归收集用户区根目录（Downloads/Desktop/Documents 等），最多 5 层
    async function collectUserRoots(d, out, depth) {
      if (depth > 5) return
      const r = await doDir(d)
      if (!r || !r.ok) return
      const segs = low(d).split(BS).filter(Boolean)
      const isUserRoot = segs.some(function(s) { return USER_ROOTS.indexOf(s) >= 0 })
      if (isUserRoot) { out.push(d); return }
      for (const sd of (r.dirs || [])) {
        await collectUserRoots(d.replace(/[\\/]+$/, '') + BS + sd.name, out, depth + 1)
      }
    }

    // 生成整理计划（只读预览）：
    // ① 目录候选 —— 扫描报告的 organizeCandidates（A 类散落目录，判定逻辑只在引擎一处）；
    // ② 文件候选 —— 用户区根目录下的散落文件按类型归类到 <盘>:\整理区\<分类>\
    // ③ includeProgram=true 时追加 program 候选（程序/游戏目录，标注 fixShortcuts 自动重写快捷方式）
    async function doOrganizePlan(args) {
      if (!scan || !scan.results) return { ok: false, error: '请先完成扫描' }
      const includeProgram = !!(args && args.includeProgram)
      const plan = []
      const seenDst = {}
      let dirCount = 0
      const rep = await readJsonFile(REPORT_FILE)
      const cands = (rep && Array.isArray(rep.organizeCandidates)) ? rep.organizeCandidates : []
      for (const c of cands) {
        const m = low(c.path || '').match(/^([a-z]):/)
        const driveLetter = m ? m[1].toUpperCase() : 'C'
        const name = (c.path || '').split(/[\\/]+/).filter(Boolean).pop() || '未命名'
        const cat = ORG_CAT[c.cat] ? c.cat : '其他'
        const dst = driveLetter + ':' + BS + '整理区' + BS + cat + BS + name
        if (seenDst[low(dst)]) continue
        seenDst[low(dst)] = 1
        plan.push({ src: c.path, dst: dst, bytes: c.bytes || 0, cat: cat, kind: 'dir' })
        dirCount++
      }
      let programCount = 0
      if (includeProgram && rep && Array.isArray(rep.suggestions)) {
        for (const s of rep.suggestions) {
          if (s.type !== 'organize-folders') continue
          for (const it of (s.items || [])) {
            if (it.kind !== 'program') continue
            const m = low(it.path || '').match(/^([a-z]):/)
            const driveLetter = m ? m[1].toUpperCase() : 'C'
            const name = (it.path || '').split(/[\\/]+/).filter(Boolean).pop() || '未命名'
            const dst = driveLetter + ':' + BS + '整理区' + BS + '其他' + BS + name
            if (seenDst[low(dst)]) continue
            seenDst[low(dst)] = 1
            plan.push({ src: it.path, dst: dst, bytes: it.bytes || 0, cat: '其他', kind: 'program', fixShortcuts: true, warn: it.warn || '移动将导致快捷方式失效；移动后将自动重写桌面/开始菜单/任务栏快捷方式' })
            programCount++
          }
        }
      }
      const seeds = []
      for (const r of scan.roots) {
        const segs = low(r).split(BS).filter(Boolean)
        const hasUser = segs.some(function(s) { return USER_ROOTS.indexOf(s) >= 0 })
        if (hasUser) seeds.push(r)
        else if (low(r).indexOf('\\users\\') >= 0) seeds.push(r)
        else seeds.push(r.replace(/[\\/]+$/, '') + BS + 'Users')
      }
      const userRoots = []
      for (const s of seeds) {
        const t = await doDir(s)
        if (t && t.ok) {
          const segs = low(s).split(BS).filter(Boolean)
          const isUserRoot = segs.some(function(x) { return USER_ROOTS.indexOf(x) >= 0 })
          if (isUserRoot) userRoots.push(s)
          else await collectUserRoots(s, userRoots, 0)
        }
      }
      const seen = {}
      for (const d of userRoots) {
        if (seen[low(d)]) continue
        seen[low(d)] = 1
        const r = await doDir(d)
        if (!r || !r.ok) continue
        const m = low(d).match(/^([a-z]):/)
        const driveLetter = m ? m[1].toUpperCase() : 'C'
        for (const f of (r.files || [])) {
          const cat = catOfFile(f.name)
          const orgCat = ORG_CAT[cat]
          if (!orgCat) continue
          const dst = driveLetter + ':' + BS + '整理区' + BS + orgCat + BS + f.name
          if (seenDst[low(dst)]) continue
          seenDst[low(dst)] = 1
          plan.push({ src: d.replace(/[\\/]+$/, '') + BS + f.name, dst: dst, bytes: f.bytes, cat: orgCat, kind: 'file' })
        }
      }
      if (plan.length === 0) return { ok: true, items: [], totalBytes: 0, note: '未发现可整理的散落目录/文件' }
      const totalBytes = plan.reduce(function(a, p) { return a + (p.bytes || 0) }, 0)
      const fileCount = plan.length - dirCount - programCount
      let note = '整理目标：<盘>:\\整理区\\<分类>\\（不删除，移动可回滚）；含 ' + dirCount + ' 个目录、' + fileCount + ' 个文件'
      if (programCount > 0) note += '、' + programCount + ' 个程序目录（⚠ 移动将自动重写快捷方式 fixShortcuts，谨慎选择）'
      return { ok: true, items: plan.slice(0, 200), totalBytes: totalBytes, dirCount: dirCount, fileCount: fileCount, programCount: programCount, note: note }
    }

    async function doOrganizeApply(items) {
      if (!scan || !scan.results) return { ok: false, error: '请先完成扫描' }
      if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '缺少整理计划' }
      if (items.length > 200) return { ok: false, error: '单次整理项过多（>200）' }
      let fixCount = 0
      for (const it of items) {
        const lp = low(it.src || '')
        if (!inScanRoots(lp)) return { ok: false, error: '源路径不在扫描范围内：' + (it.src || '') }
        if (!isSafeZone(lp)) return { ok: false, error: '拒绝整理系统目录：' + (it.src || '') }
        const dl = low(it.dst || '')
        if (!/^[a-z]:\\整理区\\/.test(dl)) return { ok: false, error: '目标必须在盘符根下的整理区目录：' + (it.dst || '') }
        // 程序/游戏目录（kind='program'）必须显式带 fixShortcuts，否则拒绝（防止快捷方式失效）
        if (it.kind === 'program' && !it.fixShortcuts) return { ok: false, error: '程序目录 ' + (it.src || '') + ' 必须启用 fixShortcuts（自动重写快捷方式）才能移动' }
        if (it.fixShortcuts) fixCount++
      }
      const total = items.reduce(function(a, it) { return a + (it.bytes || 0) }, 0)
      const ap = await askApproval('磁盘分析器申请执行整理：' + items.length + ' 个目录/文件（约 ' + fmtBytes(total) + '），移动到 <盘>:\\整理区\\<分类>\\，不删除文件，可回滚' + (fixCount > 0 ? '；其中 ' + fixCount + ' 个为程序/游戏目录，将自动重写桌面/开始菜单/任务栏快捷方式（可回滚）' : ''))
      if (ap.err) return { ok: false, error: ap.err }
      const plan = items.map(function(it) { return { src: it.src, dst: it.dst } })
      const r = await runOrganize(plan)
      let shortcutFixed = 0, shortcutError = null
      if (r.ok && fixCount > 0) {
        const movedSrc = {}
        for (const mv of (r.moved || [])) movedSrc[low(mv.src)] = mv.dst
        const fixPairs = []
        for (const it of items) {
          if (!it.fixShortcuts) continue
          const dst = movedSrc[low(it.src)]
          if (dst) fixPairs.push({ src: it.src, dst: dst })
        }
        if (fixPairs.length > 0) {
          const fr = await runFixShortcuts(fixPairs)
          if (fr.ok) shortcutFixed = (fr.fixed || []).length
          else shortcutError = fr.error || '快捷方式修复失败'
        }
      }
      appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'organize', paths: items.map(function(it) { return it.src }), freedBytes: 0, executed: r.movedCount || 0, result: r.ok ? 'ok' : 'error', detail: JSON.stringify({ failed: r.failed || [], shortcutFixed: shortcutFixed, shortcutError: shortcutError }).slice(0, 500) })
      if (!r.ok) return r
      return { ok: true, movedCount: r.movedCount, failedCount: r.failedCount, failed: r.failed, shortcutFixed: shortcutFixed, shortcutError: shortcutError, note: '已整理 ' + r.movedCount + '/' + items.length + ' 项' + (shortcutFixed > 0 ? '，自动重写快捷方式 ' + shortcutFixed + ' 个' : '') + '，可回滚' }
    }

    async function doOrganizeRollback() {
      const map = await readJsonFile(MAP_FILE)
      if (!map || !Array.isArray(map) || map.length === 0) return { ok: false, error: '没有可回滚的整理记录' }
      const last = map[map.length - 1]
      const items = (last.items || []).map(function(m) { return { src: m.dst, dst: m.src } })
      const shortcuts = (last.shortcuts && Array.isArray(last.shortcuts)) ? last.shortcuts : []
      if (items.length === 0 && shortcuts.length === 0) return { ok: false, error: '最后一批整理记录为空' }
      const ap = await askApproval('磁盘分析器申请回滚最后一批整理（' + items.length + ' 个文件/目录移回原位置' + (shortcuts.length > 0 ? '，并恢复 ' + shortcuts.length + ' 个快捷方式' : '') + '）')
      if (ap.err) return { ok: false, error: ap.err }
      let restoredShortcuts = 0
      if (shortcuts.length > 0) {
        const sr = await runRestoreShortcuts(shortcuts)
        if (sr.ok) restoredShortcuts = sr.restored || 0
      }
      const r = await runOrganize(items)
      appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'rollback', paths: items.map(function(it) { return it.dst }), freedBytes: 0, executed: r.movedCount || 0, result: r.ok ? 'ok' : 'error', detail: JSON.stringify({ failed: r.failed || [], restoredShortcuts: restoredShortcuts }).slice(0, 500) })
      if (!r.ok) return r
      return { ok: true, movedCount: r.movedCount, failedCount: r.failedCount, failed: r.failed, restoredShortcuts: restoredShortcuts, note: '已回滚 ' + r.movedCount + '/' + items.length + ' 项' + (restoredShortcuts > 0 ? '，恢复快捷方式 ' + restoredShortcuts + ' 个' : '') }
    }

    async function doClean(args) {
      if (!scan) return { ok: false, error: '请先完成扫描' }
      const type = args && args.type
      const paths = (args && Array.isArray(args.paths)) ? args.paths : []
      const v = validateCleanArgs(type, paths)
      if (!v.ok) return v
      const agents = ctx.get('agents')
      const approval = ctx.get('approval')
      if (!agents || !approval) return { ok: false, error: '审批服务不可用' }
      const agent = agents.currentInitiator()
      if (!agent) return { ok: false, error: '无法确定当前会话' }
      const typeLabel = { 'junk-temp': '临时缓存', 'empty-dirs': '空文件夹', duplicates: '重复文件', 'recycle-bin': '清空回收站' }[type] || type
      const reason = '磁盘分析器申请执行清理：' + typeLabel + (v.estBytes > 0 ? '（可释放约 ' + fmtBytes(v.estBytes) + '）' : '') + (v.paths.length ? '，' + v.paths.length + ' 个路径' : '') + '。执行方式：移入回收站（可恢复）' + (type === 'recycle-bin' ? '（永久删除，不可恢复）' : '')
      let outcome
      try {
        outcome = await approval.request({ agent: agent, toolName: 'disk_clean', reason: reason })
      } catch (e) {
        return { ok: false, error: '审批流程失败：' + (e && e.message ? e.message : String(e)) }
      }
      if (outcome !== 'allowed-once') return { ok: false, error: '用户未批准清理操作（' + String(outcome) + '）' }
      try {
        if (type === 'recycle-bin') {
          const r = await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Output "OK"')
          const freed = (scan.results.junk || []).find(function(j) { return j.label === '回收站' })
          appendAudit({ ts: new Date().toISOString(), type: type, action: 'empty-recycle-bin', paths: ['C:' + BS + '$RECYCLE.BIN'], freedBytes: freed ? freed.bytes : 0, result: r.outcome ? 'ok' : 'error', detail: r.err || '' })
          return { ok: true, executed: 1, freedBytes: freed ? freed.bytes : 0, note: '回收站已清空' }
        }
        const arrLit = '@(' + v.paths.map(function(p) { return "'" + escPS(p) + "'" }).join(',') + ')'
        const script = '$ErrorActionPreference="Continue"; Add-Type -AssemblyName Microsoft.VisualBasic; $paths = ' + arrLit + '; $ok = 0; foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; if ($i -and $i.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } elseif ($i) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin"); $ok++ } } }; Write-Output ("OK " + $ok)'
        const r = await runPowerShell(script)
        const m = r.out.match(/OK (\d+)/)
        const executed = m ? Number(m[1]) : 0
        appendAudit({ ts: new Date().toISOString(), type: type, action: 'move-to-recycle-bin', paths: v.paths, freedBytes: v.estBytes, executed: executed, result: r.outcome ? 'ok' : 'error', detail: r.err || '' })
        return { ok: true, executed: executed, total: v.paths.length, freedBytes: v.estBytes, note: '已移入回收站 ' + executed + '/' + v.paths.length + ' 项' }
      } catch (e) {
        return { ok: false, error: '执行失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    async function doAudit() {
      const entries = await readJsonFile(AUDIT_FILE)
      return { ok: true, entries: entries || [] }
    }

    async function appendHealthHistory(disks) {
      try {
        var hist = await readJsonFile(HEALTH_HISTORY_FILE) || {};
        if (typeof hist !== 'object' || Array.isArray(hist)) hist = {};
        var now = new Date().toISOString();
        for (var i = 0; i < disks.length; i++) {
          var d = disks[i]; var key = d.serial || d.name; if (!key) continue;
          if (!hist[key]) hist[key] = [];
          hist[key].push({ ts: now, temp: d.temp, wear: d.wear, poh: d.poh, powerCycle: d.powerCycle, readErrUncorr: d.readErrUncorr, writeErrUncorr: d.writeErrUncorr, readErrCorr: d.readErrCorr, writeErrCorr: d.writeErrCorr });
          if (hist[key].length > 100) hist[key] = hist[key].slice(-100);
        }
        await writeTextFile(HEALTH_HISTORY_FILE, JSON.stringify(hist, null, 2));
        return hist;
      } catch (e) { return null; }
    }

    // ---------- 磁盘健康（SMART + 卷映射，Get-PhysicalDisk / Get-StorageReliabilityCounter / Get-Partition） ----------
    async function doHealth() {
      try {
        const script = [
          '$ErrorActionPreference = "SilentlyContinue"',
          '$disks = Get-PhysicalDisk | ForEach-Object {',
          '  $rel = Get-StorageReliabilityCounter -PhysicalDisk $_ -ErrorAction SilentlyContinue',
          '  $vols = @();',
          '  try { $vols = Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{ Letter = [string]$_.DriveLetter; Fs = [string]$_.FileSystem; Size = $_.Size; Free = $_.SizeRemaining; Health = $_.HealthStatus.ToString() } } } catch { }',
          '  [PSCustomObject]@{',
          '    Name = $_.FriendlyName',
          '    Media = $_.MediaType.ToString()',
          '    Bus = $_.BusType.ToString()',
          '    Health = $_.HealthStatus.ToString()',
          '    Op = $_.OperationalStatus.ToString()',
          '    Size = $_.Size',
          '    Serial = $_.SerialNumber',
          '    Firmware = $_.FirmwareVersion',
          '    Temp = $(if ($rel) { $rel.Temperature } else { $null })',
          '    Wear = $(if ($rel) { $rel.Wear } else { $null })',
          '    POH = $(if ($rel) { $rel.PowerOnHours } else { $null })',
          '    PowerCycle = $(if ($rel) { $rel.PowerCycleCount } else { $null })',
          '    StartStop = $(if ($rel) { $rel.StartStopCycleCount } else { $null })',
          '    LoadUnload = $(if ($rel) { $rel.LoadUnloadCycleCount } else { $null })',
          '    ReadErrCorr = $(if ($rel) { $rel.ReadErrorsCorrected } else { $null })',
          '    ReadErrUncorr = $(if ($rel) { $rel.ReadErrorsUncorrected } else { $null })',
          '    WriteErrCorr = $(if ($rel) { $rel.WriteErrorsCorrected } else { $null })',
          '    WriteErrUncorr = $(if ($rel) { $rel.WriteErrorsUncorrected } else { $null })',
          '    Volumes = $vols',
          '  }',
          '}',
          'if (-not $disks) { $disks = @() }',
          '$disks | ConvertTo-Json -Compress -Depth 4 | Out-File -Encoding UTF8 "' + HEALTH_FILE + '"'
        ].join('\n')
        const r = await runPowerShell(script)
        const raw = await readJsonFile(HEALTH_FILE)
        if (!raw) return { ok: false, error: '无法读取磁盘健康数据（需要管理员权限或系统不支持 Get-PhysicalDisk）' }
        const arr = Array.isArray(raw) ? raw : [raw]
        const disks = arr.filter(function(d) { return d && d.Name }).map(function(d) {
          const g = gradeHealth(d)
          const num = function(v) { return typeof v === 'number' ? v : null }
          const vols = Array.isArray(d.Volumes) ? d.Volumes.map(function(v) {
            const size = v && typeof v.Size === 'number' ? v.Size : null
            const free = v && typeof v.Free === 'number' ? v.Free : null
            return {
              letter: v ? String(v.Letter || '') : '', fs: v ? String(v.Fs || '') : '',
              size: size, free: free, health: v ? String(v.Health || '') : ''
            }
          }).filter(function(v) { return v.letter || v.size }) : []
          return {
            name: d.Name, media: d.Media || '未知', bus: d.Bus || '未知', health: d.Health || '未知', op: d.Op || '未知',
            size: d.Size ? Number(d.Size) : null, serial: d.Serial || '', firmware: d.Firmware || '',
            temp: num(d.Temp), wear: num(d.Wear), poh: num(d.POH),
            powerCycle: num(d.PowerCycle), startStop: num(d.StartStop), loadUnload: num(d.LoadUnload),
            readErrCorr: num(d.ReadErrCorr), readErrUncorr: num(d.ReadErrUncorr),
            writeErrCorr: num(d.WriteErrCorr), writeErrUncorr: num(d.WriteErrUncorr),
            volumes: vols,
            grade: g.level, issues: g.issues
          }
        })
        if (disks.length === 0) return { ok: false, error: '未发现物理磁盘' }
        var hist = await appendHealthHistory(disks);
        var trend = {};
        try {
          var fullHist = hist || await readJsonFile(HEALTH_HISTORY_FILE) || {};
          disks.forEach(function(d){ var key = d.serial || d.name; if (fullHist[key]) trend[key] = fullHist[key].slice(-20); });
        } catch (e) {}
        return { ok: true, disks: disks, trend: trend }
      } catch (e) {
        return { ok: false, error: '健康检查失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    function gradeHealth(d) {
      const issues = []
      const h = String(d.Health || '').toLowerCase()
      if (h === 'unhealthy') issues.push('设备状态 Unhealthy')
      else if (h === 'warning') issues.push('设备状态 Warning')
      if (typeof d.Wear === 'number' && d.Wear > 80) issues.push('SSD 寿命已用 ' + d.Wear + '%')
      if (typeof d.Temp === 'number' && d.Temp > 55) issues.push('温度 ' + d.Temp + '°C')
      if ((typeof d.ReadErrUncorr === 'number' && d.ReadErrUncorr > 0) || (typeof d.WriteErrUncorr === 'number' && d.WriteErrUncorr > 0)) issues.push('存在不可纠正读写错误')
      if (typeof d.ReadErrCorr === 'number' && d.ReadErrCorr > 1000) issues.push('读纠错次数偏高（' + d.ReadErrCorr + '）')
      if (issues.length === 0) return { level: '健康', issues: [] }
      if (h === 'unhealthy' || (typeof d.Wear === 'number' && d.Wear > 90)) return { level: '危险', issues: issues }
      if (h === 'warning' || (typeof d.Wear === 'number' && d.Wear > 80)) return { level: '警告', issues: issues }
      return { level: '注意', issues: issues }
    }

    // ---------- 高级功能辅助进程（MFT 快扫 / dedup / quota，node dsk-adv.js） ----------
    async function runAdv(argv) {
      try {
        const node = await ensureNode()
        const handle = subprocess.spawn({
          argv: [node, ADV_HELPER].concat(argv),
          cwd: CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 64 << 20 }, stderr: { maxBytes: 1 << 20 } },
          graceMs: 5000
        })
        const outcome = await handle.done.catch(function() { return null })
        if (!outcome) return { ok: false, error: '辅助进程异常退出' }
        const parsed = await parseHelperOut(handle)
        return parsed
      } catch (e) {
        return { ok: false, error: '高级功能执行失败：' + (e && e.message ? e.message : String(e)) }
      }
    }

    async function doMftScan(args) {
      const drive = args && args.drive
      if (!drive) return { ok: false, error: '缺少盘符参数（如 D:）' }
      const r = await runAdv(['mftscan', drive])
      if (!r || !r.ok) return r || { ok: false, error: '辅助进程无输出' }
      return {
        ok: true, drive: r.drive, elapsedMs: r.elapsedMs,
        summary: r.summary, category: r.category || [], extTop: r.extTop || [],
        topDirs: r.topDirs || [], topFiles: r.topFiles || [],
        note: 'MFT 直读快速扫描（NTFS，需管理员）'
      }
    }

    async function doDedup(args) {
      const cmd = args && args.cmd
      if (cmd === 'scan') {
        const roots = (args && Array.isArray(args.roots) && args.roots.length > 0) ? args.roots : null
        if (!roots) return { ok: false, error: '缺少扫描根目录（roots）' }
        const r = await runAdv(['dedup', JSON.stringify(roots), args.minBytes ? String(args.minBytes) : ''])
        if (!r || !r.ok) return r || { ok: false, error: '辅助进程无输出' }
        return {
          ok: true, groups: r.groups || [], groupCount: r.groupCount || 0,
          totalDupBytes: r.totalDupBytes || 0, totalSaveBytes: r.totalSaveBytes || 0,
          scannedFiles: r.scannedFiles || 0, elapsedMs: r.elapsedMs || 0,
          note: '全盘重复文件检测（排除系统/程序目录；≥1MB）'
        }
      }
      if (cmd === 'hardlink') {
        const groups = (args && Array.isArray(args.groups)) ? args.groups : []
        if (groups.length === 0) return { ok: false, error: '缺少重复组（groups，取自 dedup scan 输出）' }
        const ap = await askApproval('磁盘分析器申请硬链接合并 ' + groups.length + ' 组重复文件（保留每组第一个，其余转为硬链接节省空间；可回滚）')
        if (ap.err) return { ok: false, error: ap.err }
        const r = await runAdv(['dedup-hardlink', JSON.stringify(groups)])
        if (!r || !r.ok) return r || { ok: false, error: '辅助进程无输出' }
        // 记录已合并文件（供回滚）
        const merged = []
        for (const x of (r.results || [])) if (x && x.action === 'hardlink') merged.push(x.to)
        if (merged.length > 0) {
          try { await writeTextFile(DEDUP_MAP_FILE, JSON.stringify({ at: new Date().toISOString(), merged: merged })) } catch (e) { /* 记录失败不阻断 */ }
        }
        appendAudit({ ts: new Date().toISOString(), type: 'dedup', action: 'hardlink', paths: merged, freedBytes: 0, executed: r.merged || 0, result: r.ok ? 'ok' : 'error' })
        return { ok: true, merged: r.merged || 0, failed: r.failed || 0, results: r.results || [], note: '硬链接合并完成，可回滚（dedup rollback）' }
      }
      if (cmd === 'rollback') {
        const map = await readJsonFile(DEDUP_MAP_FILE)
        if (!map || !Array.isArray(map.merged) || map.merged.length === 0) return { ok: false, error: '没有可回滚的硬链接合并记录' }
        const ap = await askApproval('磁盘分析器申请回滚硬链接合并（' + map.merged.length + ' 个文件恢复为独立副本）')
        if (ap.err) return { ok: false, error: ap.err }
        const r = await runAdv(['dedup-rollback', JSON.stringify(map.merged)])
        if (!r || !r.ok) return r || { ok: false, error: '辅助进程无输出' }
        appendAudit({ ts: new Date().toISOString(), type: 'dedup', action: 'rollback', paths: map.merged, executed: r.restored || 0, result: r.ok ? 'ok' : 'error' })
        return { ok: true, restored: r.restored || 0, failed: r.failed || 0, results: r.results || [], note: '硬链接已回滚为独立文件' }
      }
      return { ok: false, error: '未知命令：' + String(cmd) + '（scan | hardlink | rollback）' }
    }

    async function doQuota(args) {
      const drive = args && args.drive
      if (!drive) return { ok: false, error: '缺少盘符参数（如 C:）' }
      const r = await runAdv(['quota', drive])
      if (!r || !r.ok) return r || { ok: false, error: '辅助进程无输出' }
      return {
        ok: true, drive: r.drive, users: r.users || [], systemBytes: r.systemBytes || 0,
        mftRecords: r.mftRecords || 0, elapsedMs: r.elapsedMs || 0,
        note: '每用户配额分析（MFT 直读，需管理员）'
      }
    }

    // ---------- RPC ----------

    // ---------- 动态工具（模型侧驱动） ----------
    const scanTool = ({
      name: 'disk_scan',
      description: 'Windows 磁盘扫描与查询（模型侧入口）。cmd=start 启动扫描（roots 省略时扫全部盘；suggest=false 可关闭建议分析）；cmd=status 查进度；cmd=report 取紧凑摘要与智能建议，同时返回 markdown 字段（可读 Markdown 详细报告：概览/类别统计/大文件/大目录/建议表格，也已落盘为 .md 文件，可直接展示给用户）；cmd=dir 下钻目录（path）；cmd=drives 列盘符与容量。游戏库目录（Steam/WeGame/Epic 等）仅统计大小不做深度分析；重复检测覆盖用户数据目录（Downloads/Documents/Desktop/Pictures/Videos/Music/OneDrive）及扫描根浅层目录（≥1MB），summary.dupScan 标注实际覆盖范围；扫描同时检测散落目录（盘根与用户区根部的第一层目录，修改 >30 天 且 ≥100MB），suggestions 含 organize-folders 建议（loose 类可整理 / program 类程序目录仅提示，标注快捷方式失效风险）。所有结果均为聚合统计，不含文件内容。',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['start', 'status', 'report', 'dir', 'drives'], description: '操作命令' },
          roots: { type: 'array', items: { type: 'string' }, description: '扫描根路径，如 ["C:\\"]；省略则扫描全部本地盘' },
          exclude: { type: 'array', items: { type: 'string' }, description: '排除的绝对路径（可选）' },
          path: { type: 'string', description: '下钻目录的绝对路径（cmd=dir 时必填）' },
          suggest: { type: 'boolean', description: '是否启用智能建议分析（默认 true，cmd=start 时有效）' }
        },
        required: ['cmd']
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        const cmd = args && args.cmd
        if (cmd === 'start') {
          if (!args.roots || args.roots.length === 0) {
            const info = await listDrives()
            args.roots = info.letters.map(function(l){ return l + ':' + String.fromCharCode(92) })
          }
          return await doStart(args)
        }
        if (cmd === 'status') return await doStatus()
        if (cmd === 'report') return await doReport()
        if (cmd === 'dir') return await doDir(args && args.path)
        if (cmd === 'drives') return await doDrives()
        return { ok: false, error: '未知命令：' + String(cmd) }
      }
    })
    const cleanTool = ({
      name: 'disk_clean',
      description: 'Windows 磁盘清理执行（模型侧入口）。type=recycle-bin 清空回收站（永久删除）；type=junk-temp/empty-dirs/duplicates 将指定路径移入回收站。路径必须来自最近一次 disk_scan 报告的智能建议明细。执行前会弹出 DSH 审批，需用户在 GUI 批准；执行写入审计日志。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['junk-temp', 'empty-dirs', 'duplicates', 'recycle-bin'], description: '清理类型' },
          paths: { type: 'array', items: { type: 'string' }, description: '要清理的路径列表（recycle-bin 不需要）；必须取自建议明细' }
        },
        required: ['type']
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        return await doClean(args)
      }
    })
    const auditTool = ({
      name: 'disk_audit',
      description: '读取磁盘清理审计日志（时间/类型/路径/结果）。',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        return await doAudit()
      }
    })
    const organizeTool = ({
      name: 'disk_organize',
      description: 'Windows 磁盘整理（模型侧入口）。cmd=plan 生成整理计划（只读预览：目录候选取自扫描报告 organizeCandidates（A 类散落目录），加上用户区根部的散落文件，按类型归入 <盘>:\\整理区\\<分类>\\；includeProgram=true 时追加 program 类程序/游戏目录候选，标注 fixShortcuts 风险提示）；cmd=apply items=[{src,dst,kind,fixShortcuts}] 执行整理（审批后移动，支持目录，可回滚；program 目录必须 fixShortcuts=true，移动后自动重写桌面/开始菜单/任务栏快捷方式）；cmd=rollback 回滚最后一批整理（含快捷方式恢复）。不删除文件，移动写入映射供回滚；默认 program 类目录不进入计划。',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['plan', 'apply', 'rollback'], description: '操作命令' },
          includeProgram: { type: 'boolean', description: 'plan 时是否包含 program 类程序/游戏目录候选（默认 false；含风险标注与 fixShortcuts 建议）' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '整理计划项（cmd=apply 必填，取自 cmd=plan 输出）' }
        },
        required: ['cmd']
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        const cmd = args && args.cmd
        if (cmd === 'plan') return await doOrganizePlan(args)
        if (cmd === 'apply') return await doOrganizeApply(args && args.items)
        if (cmd === 'rollback') return await doOrganizeRollback()
        return { ok: false, error: '未知命令：' + String(cmd) }
      }
    })
    const healthTool = ({
      name: 'disk_health',
      description: 'Windows 磁盘健康检查（模型侧入口）。读取所有物理盘 SMART 数据（Get-PhysicalDisk + Get-StorageReliabilityCounter）：温度/SSD 寿命/通电小时/读写错误，并给出健康分级（健康/注意/警告/危险 + 具体问题列表）。无参数，直接调用即可。',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        return await doHealth()
      }
    })
    const mftscanTool = ({
      name: 'disk_mftscan',
      description: 'Windows MFT 直读快速扫描（模型侧入口）。cmd=scan drive=D: 直接读取 NTFS $MFT 元数据（WizTree 思路，~8x 提速，需管理员权限；非 NTFS 卷或权限不足会返回错误）。返回概要/分类/大目录 Top/大文件 Top。',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['scan'], description: '操作命令' },
          drive: { type: 'string', description: '盘符，如 D:（cmd=scan 时必填）' }
        },
        required: ['cmd']
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        const cmd = args && args.cmd
        if (cmd === 'scan') return await doMftScan(args)
        return { ok: false, error: '未知命令：' + String(cmd) }
      }
    })
    const dedupTool = ({
      name: 'disk_dedup',
      description: 'Windows 全盘重复文件检测（模型侧入口）。cmd=scan roots=["C:\\","D:\\"] 全盘检测重复文件（排除系统/程序目录，≥1MB，head/tail 两阶段哈希）；cmd=hardlink groups=[...] 将重复组转硬链接省空间（保留每组第一个，需 DSH 审批，可回滚）；cmd=rollback 回滚硬链接合并（恢复为独立副本）。groups 必须取自 scan 输出。',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['scan', 'hardlink', 'rollback'], description: '操作命令' },
          roots: { type: 'array', items: { type: 'string' }, description: '扫描根路径（cmd=scan 必填）' },
          groups: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '重复组（cmd=hardlink 必填，取自 scan 输出）' }
        },
        required: ['cmd']
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        return await doDedup(args)
      }
    })
    const quotaTool = ({
      name: 'disk_quota',
      description: 'Windows 每用户配额分析（模型侧入口）。cmd=analyze drive=C: 基于 MFT 直读的目录占用聚合，按 C:\\Users\\* 前缀分组统计每个用户的磁盘占用与子目录明细（需管理员权限）。',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['analyze'], description: '操作命令' },
          drive: { type: 'string', description: '盘符，如 C:（cmd=analyze 时必填）' }
        },
        required: ['cmd']
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args, exec) {
        const cmd = args && args.cmd
        if (cmd === 'analyze') return await doQuota(args)
        return { ok: false, error: '未知命令：' + String(cmd) }
      }
    })
    ctx.tools.register(scanTool)
    ctx.tools.register(cleanTool)
    ctx.tools.register(auditTool)
    ctx.tools.register(organizeTool)
    ctx.tools.register(healthTool)
    ctx.tools.register(mftscanTool)
    ctx.tools.register(dedupTool)
    ctx.tools.register(quotaTool)

    ctx.effect(function() { return function() { cancelled = true } })
    console.log('[dsk] disk analyzer host ready (scan + suggestions + clean + organize + health + mftscan + dedup + quota)')
  }
};
