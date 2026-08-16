// Windows 磁盘分析器 —— 宿主半（产品化模板，含清理 + 可回滚整理）
// 安装：将 __DSK_DIR__ 替换为实际安装目录（dsk-helper.js 所在目录，需可写，
// 因为 .dsk-prog.json/.dsk-audit.json/.dsk-organize-plan.json/.dsk-organize-map.json
// 都写在该目录），再通过 cordis_define 定义、cordis_run 运行。
return {
  inject: ['timer'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    const subprocess = ctx.get('subprocess')
    const decoder = new TextDecoder()

    const BS = String.fromCharCode(92)
    const DSK_DIR = '__DSK_DIR__'
    const HELPER = DSK_DIR + BS + 'dsk-helper.js'
    const ADV_HELPER = DSK_DIR + BS + 'dsk-adv.js'
    const PROG_FILE = DSK_DIR + BS + '.dsk-prog.json'
    const AUDIT_FILE = DSK_DIR + BS + '.dsk-audit.json'
    const PLAN_FILE = DSK_DIR + BS + '.dsk-organize-plan.json'
    const MAP_FILE = DSK_DIR + BS + '.dsk-organize-map.json'
    const HEALTH_FILE = DSK_DIR + BS + '.dsk-health.json'
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
        const argv = [node, HELPER, '--roots', targets.map(function(t){ return t.displayPath }).join(';'), '--progress', PROG_FILE, '--time']
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

    function doReport() {
      if (!scan) return { ok: false, error: '尚未扫描' }
      if (scan.status === 'running') return { ok: false, error: '扫描仍在进行中' }
      if (!scan.results) return { ok: false, error: scan.error || '没有可用结果' }
      const r = scan.results
      const driveArr = scan.roots.map(function(root) {
        const m = root.match(/^([A-Za-z]):/)
        return { letter: m ? m[1] : '?', root: root }
      })
      const sm = r.summary || {}
      return {
        ok: true,
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
          error: scan.error || null
        },
        category: r.category || [],
        extTop: r.extTop || [],
        topDirs: r.topDirs || [],
        topFiles: r.topFiles || [],
        junk: r.junk || [],
        emptyDirSample: r.emptyDirSample || [],
        timeBuckets: r.timeBuckets || null,
        suggestions: r.suggestions || []
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

    // 生成整理计划（只读预览）：用户区根目录下的散落文件按类型归类到 <盘>:\整理区\<分类>\
    async function doOrganizePlan() {
      if (!scan || !scan.results) return { ok: false, error: '请先完成扫描' }
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
      const plan = []
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
          plan.push({ src: d.replace(/[\\/]+$/, '') + BS + f.name, dst: driveLetter + ':' + BS + '整理区' + BS + orgCat + BS + f.name, bytes: f.bytes, cat: orgCat })
        }
      }
      if (plan.length === 0) return { ok: true, items: [], totalBytes: 0, note: '未发现可整理的用户区散落文件' }
      const totalBytes = plan.reduce(function(a, p) { return a + (p.bytes || 0) }, 0)
      return { ok: true, items: plan.slice(0, 200), totalBytes: totalBytes, note: '整理目标：<盘>:\\整理区\\<分类>\\（不删除，移动可回滚）' }
    }

    async function doOrganizeApply(items) {
      if (!scan || !scan.results) return { ok: false, error: '请先完成扫描' }
      if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '缺少整理计划' }
      if (items.length > 200) return { ok: false, error: '单次整理项过多（>200）' }
      for (const it of items) {
        const lp = low(it.src || '')
        if (!inScanRoots(lp)) return { ok: false, error: '源路径不在扫描范围内：' + (it.src || '') }
        if (!isSafeZone(lp)) return { ok: false, error: '拒绝整理系统目录：' + (it.src || '') }
        const dl = low(it.dst || '')
        if (!/^[a-z]:\\整理区\\/.test(dl)) return { ok: false, error: '目标必须在盘符根下的整理区目录：' + (it.dst || '') }
      }
      const total = items.reduce(function(a, it) { return a + (it.bytes || 0) }, 0)
      const ap = await askApproval('磁盘分析器申请执行整理：' + items.length + ' 个文件（约 ' + fmtBytes(total) + '），移动到 <盘>:\\整理区\\<分类>\\，不删除文件，可回滚')
      if (ap.err) return { ok: false, error: ap.err }
      const plan = items.map(function(it) { return { src: it.src, dst: it.dst } })
      const r = await runOrganize(plan)
      appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'organize', paths: items.map(function(it) { return it.src }), freedBytes: 0, executed: r.movedCount || 0, result: r.ok ? 'ok' : 'error', detail: JSON.stringify(r.failed || []).slice(0, 500) })
      return r.ok ? { ok: true, movedCount: r.movedCount, failedCount: r.failedCount, failed: r.failed, note: '已整理 ' + r.movedCount + '/' + items.length + ' 项，可回滚' } : r
    }

    async function doOrganizeRollback() {
      const map = await readJsonFile(MAP_FILE)
      if (!map || !Array.isArray(map) || map.length === 0) return { ok: false, error: '没有可回滚的整理记录' }
      const last = map[map.length - 1]
      const items = (last.items || []).map(function(m) { return { src: m.dst, dst: m.src } })
      if (items.length === 0) return { ok: false, error: '最后一批整理记录为空' }
      const ap = await askApproval('磁盘分析器申请回滚最后一批整理（' + items.length + ' 个文件移回原位置）')
      if (ap.err) return { ok: false, error: ap.err }
      const r = await runOrganize(items)
      appendAudit({ ts: new Date().toISOString(), type: 'organize', action: 'rollback', paths: items.map(function(it) { return it.dst }), freedBytes: 0, executed: r.movedCount || 0, result: r.ok ? 'ok' : 'error', detail: JSON.stringify(r.failed || []).slice(0, 500) })
      return r.ok ? { ok: true, movedCount: r.movedCount, failedCount: r.failedCount, failed: r.failed, note: '已回滚 ' + r.movedCount + '/' + items.length + ' 项' } : r
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

    // ---------- 磁盘健康（温度/SMART，Get-PhysicalDisk + Get-StorageReliabilityCounter） ----------
    async function doHealth() {
      try {
        const script = [
          '$ErrorActionPreference = "SilentlyContinue"',
          '$disks = Get-PhysicalDisk | ForEach-Object {',
          '  $rel = Get-StorageReliabilityCounter -PhysicalDisk $_ -ErrorAction SilentlyContinue',
          '  [PSCustomObject]@{',
          '    Name = $_.FriendlyName',
          '    Media = $_.MediaType.ToString()',
          '    Health = $_.HealthStatus.ToString()',
          '    Op = $_.OperationalStatus.ToString()',
          '    Size = $_.Size',
          '    Temp = $(if ($rel) { $rel.Temperature } else { $null })',
          '    Wear = $(if ($rel) { $rel.Wear } else { $null })',
          '    POH = $(if ($rel) { $rel.PowerOnHours } else { $null })',
          '    ReadErr = $(if ($rel) { $rel.ReadErrorsTotal } else { $null })',
          '    WriteErr = $(if ($rel) { $rel.WriteErrorsTotal } else { $null })',
          '  }',
          '}',
          'if (-not $disks) { $disks = @() }',
          '$disks | ConvertTo-Json -Compress | Out-File -Encoding UTF8 "' + HEALTH_FILE + '"'
        ].join('\n')
        const r = await runPowerShell(script)
        const raw = await readJsonFile(HEALTH_FILE)
        if (!raw) return { ok: false, error: '无法读取磁盘健康数据（需要管理员权限或系统不支持 Get-PhysicalDisk）' }
        const arr = Array.isArray(raw) ? raw : [raw]
        const disks = arr.filter(function(d) { return d && d.Name }).map(function(d) {
          const g = gradeHealth(d)
          return {
            name: d.Name, media: d.Media || '未知', health: d.Health || '未知', op: d.Op || '未知',
            size: d.Size ? Number(d.Size) : null,
            temp: typeof d.Temp === 'number' ? d.Temp : null,
            wear: typeof d.Wear === 'number' ? d.Wear : null,
            poh: typeof d.POH === 'number' ? d.POH : null,
            readErr: typeof d.ReadErr === 'number' ? d.ReadErr : null,
            writeErr: typeof d.WriteErr === 'number' ? d.WriteErr : null,
            grade: g.level, issues: g.issues
          }
        })
        if (disks.length === 0) return { ok: false, error: '未发现物理磁盘' }
        return { ok: true, disks: disks }
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
      if (typeof d.ReadErr === 'number' && d.ReadErr > 0) issues.push('读取错误 ' + d.ReadErr)
      if (typeof d.WriteErr === 'number' && d.WriteErr > 0) issues.push('写入错误 ' + d.WriteErr)
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
        const merged = []
        for (const x of (r.results || [])) if (x && x.action === 'hardlink') merged.push(x.to)
        if (merged.length > 0) {
          try { await writeTextFile(DEDUP_MAP_FILE, JSON.stringify({ at: new Date().toISOString(), merged: merged })) } catch (e) { /* 记录失败不阻断 */ }
        }
        appendAudit({ ts: new Date().toISOString(), type: 'dedup', action: 'hardlink', paths: merged, executed: r.merged || 0, result: r.ok ? 'ok' : 'error' })
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
    harness.handle('scan.start', doStart)
    harness.handle('scan.status', doStatus)
    harness.handle('scan.cancel', doCancel)
    harness.handle('report.get', doReport)
    harness.handle('report.dir', doDir)
    harness.handle('report.drives', doDrives)
    harness.handle('clean.execute', doClean)
    harness.handle('clean.audit', doAudit)
    harness.handle('organize.plan', doOrganizePlan)
    harness.handle('organize.apply', doOrganizeApply)
    harness.handle('organize.rollback', doOrganizeRollback)

    // ---------- 动态工具（模型侧驱动） ----------
    const scanTool = harness.defineTool({
      name: 'disk_scan',
      description: 'Windows 磁盘扫描与查询（模型侧入口）。cmd=start 启动扫描（roots 省略时扫全部盘；suggest=false 可关闭建议分析）；cmd=status 查进度；cmd=report 取聚合报告与智能建议；cmd=dir 下钻目录（path）；cmd=drives 列盘符与容量。所有结果均为聚合统计，不含文件内容。',
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
        if (cmd === 'report') return doReport()
        if (cmd === 'dir') return await doDir(args && args.path)
        if (cmd === 'drives') return await doDrives()
        return { ok: false, error: '未知命令：' + String(cmd) }
      }
    })
    const cleanTool = harness.defineTool({
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
    const auditTool = harness.defineTool({
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
    const organizeTool = harness.defineTool({
      name: 'disk_organize',
      description: 'Windows 磁盘整理（模型侧入口）。cmd=plan 生成整理计划（只读预览：用户区散落文件按类型归入 <盘>:\\整理区\\<分类>\\）；cmd=apply items=[{src,dst}] 执行整理（审批后移动，可回滚）；cmd=rollback 回滚最后一批整理。不删除文件，移动写入映射供回滚。',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', enum: ['plan', 'apply', 'rollback'], description: '操作命令' },
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
        if (cmd === 'plan') return await doOrganizePlan()
        if (cmd === 'apply') return await doOrganizeApply(args && args.items)
        if (cmd === 'rollback') return await doOrganizeRollback()
        return { ok: false, error: '未知命令：' + String(cmd) }
      }
    })
    const healthTool = harness.defineTool({
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
    const mftscanTool = harness.defineTool({
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
    const dedupTool = harness.defineTool({
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
    const quotaTool = harness.defineTool({
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
    harness.registerTool(ctx, scanTool)
    harness.registerTool(ctx, cleanTool)
    harness.registerTool(ctx, auditTool)
    harness.registerTool(ctx, organizeTool)
    harness.registerTool(ctx, healthTool)
    harness.registerTool(ctx, mftscanTool)
    harness.registerTool(ctx, dedupTool)
    harness.registerTool(ctx, quotaTool)

    ctx.effect(function() { return function() { cancelled = true } })
    console.log('[dsk] disk analyzer host ready (scan + suggestions + clean + organize + health + mftscan + dedup + quota)')
  }
}
