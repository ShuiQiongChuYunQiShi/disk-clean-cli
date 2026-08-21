// Windows 磁盘分析器 —— 客户端半（Tab 导航版：概览 / 清理中心 / 重复文件 / 一键整理 / 磁盘健康）
// 通过 cordis_define 定义时作为 code.client 传入。
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const dis = styles.insert(
      '.dsk-panel{font-size:13px;line-height:1.5;color:var(--text-1,#e8e8e8);max-width:760px}' +
      '.dsk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}' +
      '.dsk-btn{background:var(--button-bg,#2a2f3a);border:1px solid var(--border,#3a3f4b);color:var(--text-1,#e8e8e8);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:13px}' +
      '.dsk-btn:hover{filter:brightness(1.15)}' +
      '.dsk-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.dsk-btn.primary{background:#4f8cff;border-color:#4f8cff;color:#fff}' +
      '.dsk-btn.danger{background:#e85d75;border-color:#e85d75;color:#fff}' +
      '.dsk-btn.good{background:#2f9e63;border-color:#2f9e63;color:#fff}' +
      '.dsk-progress{background:var(--border,#333);border-radius:6px;height:8px;overflow:hidden;flex:1;min-width:120px}' +
      '.dsk-progress>div{background:#4f8cff;height:100%;transition:width .3s}' +
      '.dsk-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:8px 0}' +
      '.dsk-card{background:var(--bg-2,#22262e);border:1px solid var(--border,#333);border-radius:8px;padding:8px 10px}' +
      '.dsk-card .k{font-size:11px;color:var(--text-2,#9aa)}' +
      '.dsk-card .v{font-size:15px;font-weight:600;margin-top:2px}' +
      '.dsk-sec{margin:12px 0 4px;font-weight:600;font-size:13px;color:var(--text-1,#e8e8e8)}' +
      '.dsk-flex{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}' +
      '.dsk-legend{font-size:12px;color:var(--text-2,#9aa);margin-top:6px}' +
      '.dsk-legend span{display:inline-block;margin-right:10px}' +
      '.dsk-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}' +
      '.dsk-bars{display:flex;flex-direction:column;gap:3px;min-width:260px;flex:1}' +
      '.dsk-bar-row{display:flex;align-items:center;gap:8px}' +
      '.dsk-bar-label{width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text-2,#9aa)}' +
      '.dsk-bar-track{flex:1;background:var(--border,#333);border-radius:4px;height:14px;overflow:hidden}' +
      '.dsk-bar-fill{height:100%;border-radius:4px;min-width:2px}' +
      '.dsk-bar-val{width:72px;text-align:right;font-size:12px;color:var(--text-1,#e8e8e8)}' +
      '.dsk-click{cursor:pointer}' +
      '.dsk-click:hover .dsk-bar-label{color:#4f8cff}' +
      '.dsk-crumb{display:flex;gap:4px;flex-wrap:wrap;align-items:center;font-size:12px;margin:6px 0}' +
      '.dsk-crumb a{color:#4f8cff;cursor:pointer}' +
      '.dsk-crumb .sep{color:var(--text-2,#9aa)}' +
      '.dsk-files{width:100%;border-collapse:collapse;font-size:12px}' +
      '.dsk-files td{padding:2px 6px;border-bottom:1px solid var(--border,#2a2e36);white-space:nowrap}' +
      '.dsk-files td:first-child{overflow:hidden;text-overflow:ellipsis;max-width:420px}' +
      '.dsk-files td:last-child{text-align:right;color:var(--text-2,#9aa)}' +
      '.dsk-muted{color:var(--text-2,#9aa);font-size:12px}' +
      '.dsk-tip{font-size:12px;color:var(--text-2,#9aa);margin-top:6px}' +
      // —— Tab 导航 ——
      '.dsk-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border,#333);margin:10px 0 10px;flex-wrap:wrap}' +
      '.dsk-tab{padding:6px 14px;cursor:pointer;font-size:13px;color:var(--text-2,#9aa);background:transparent;border:none;border-bottom:2px solid transparent}' +
      '.dsk-tab.on{color:#4f8cff;border-bottom-color:#4f8cff;font-weight:600}' +
      // —— 清理中心卡片 ——
      '.dsk-clean{border:1px solid var(--border,#333);border-radius:8px;padding:10px 12px;margin:8px 0;background:var(--bg-2,#22262e)}' +
      '.dsk-clean .head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.dsk-clean .head .t{font-weight:600}' +
      '.dsk-clean .est{color:#37c28a;font-weight:600}' +
      '.dsk-badge{color:#fff;border-radius:4px;padding:1px 8px;font-size:11px}' +
      '.dsk-detail{margin-top:6px;max-height:150px;overflow:auto;font-size:12px;color:var(--text-2,#9aa)}' +
      '.dsk-detail div{padding:1px 0;border-bottom:1px dashed rgba(128,128,128,.15);word-break:break-all}' +
      '.dsk-result{border-left:3px solid #37c28a;padding:4px 10px;margin:6px 0;font-size:12px;background:rgba(55,194,138,.08)}' +
      '.dsk-warnbox{background:rgba(242,193,78,.08);border:1px solid rgba(242,193,78,.35);border-radius:6px;padding:6px 10px;margin:6px 0;font-size:12px}' +
      '.dsk-infobox{background:rgba(79,140,255,.07);border:1px solid rgba(79,140,255,.3);border-radius:6px;padding:6px 10px;margin:6px 0;font-size:12px}' +
      // —— 健康仪表 ——
      '.dsk-gauge{margin:4px 0}' +
      '.dsk-gauge .gl{display:flex;justify-content:space-between;font-size:12px;color:var(--text-2,#9aa)}' +
      '.dsk-gauge .gb{height:6px;background:rgba(128,128,128,.18);border-radius:3px;overflow:hidden;margin-top:2px}' +
      '.dsk-gauge .gb>div{height:100%;border-radius:3px}' +
      '.dsk-grade{color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:600}' +
      '.dsk-chip{display:inline-block;border:1px solid var(--border,#3a3f4b);border-radius:10px;padding:1px 9px;font-size:11px;color:var(--text-2,#9aa);margin:2px 4px 2px 0}' +
      '.dsk-sugg-chip{display:flex;gap:8px;align-items:center;border:1px solid var(--border,#333);border-radius:6px;padding:5px 10px;margin:4px 0;cursor:pointer;font-size:12px}' +
      '.dsk-sugg-chip:hover{border-color:#4f8cff}'
    )
    ctx.effect(function() { return dis })

    function fmtBytes(n) {
      if (!n || n < 0) return '0 B'
      const u = ['B','KB','MB','GB','TB']
      let v = n, k = 0
      while (v >= 1024 && k < u.length - 1) { v /= 1024; k++ }
      return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k]
    }
    const PALETTE = ['#4f8cff','#37c28a','#ff9f43','#e85d75','#8e7cf3','#3fc1c9','#f2c14e','#7b8cde','#5abf6f','#d97bc4','#a8b8c8','#c9a86a']
    const RISK_COLOR = { low: '#37c28a', medium: '#f2c14e', high: '#ff9f43', 'high-irreversible': '#e85d75' }
    const RISK_LABEL = { low: '低风险', medium: '中风险', high: '高风险', 'high-irreversible': '不可逆' }
    const GRADE_COLOR = { '健康': '#37c28a', '注意': '#f2c14e', '警告': '#ff9f43', '危险': '#e85d75' }

    function RiskBadge(risk) {
      return React.createElement('span', { className: 'dsk-badge', style: { background: RISK_COLOR[risk] || '#999' } }, RISK_LABEL[risk] || risk)
    }
    function GradeBadge(level) {
      return React.createElement('span', { className: 'dsk-grade', style: { background: GRADE_COLOR[level] || '#999' } }, level)
    }

    function Donut(props) {
      const items = props.items || []
      const total = items.reduce(function(a, x){ return a + x.value }, 0)
      const C = 2 * Math.PI * 40
      let acc = 0
      const segs = items.map(function(it, i) {
        const frac = total > 0 ? it.value / total : 0
        const el = React.createElement('circle', {
          key: i, cx: 60, cy: 60, r: 40, fill: 'none', stroke: it.color,
          'stroke-width': 20, 'stroke-dasharray': (frac * C) + ' ' + C,
          'stroke-dashoffset': String(-acc * C), transform: 'rotate(-90 60 60)'
        })
        acc += frac
        return el
      })
      return React.createElement('div', null,
        React.createElement('svg', { viewBox: '0 0 120 120', width: 150, height: 150 },
          segs,
          React.createElement('text', { x: 60, y: 62, 'text-anchor': 'middle', fill: 'var(--text-1,#e8e8e8)', 'font-size': 12, 'font-weight': 600 }, fmtBytes(total)),
          React.createElement('text', { x: 60, y: 78, 'text-anchor': 'middle', fill: 'var(--text-2,#9aa)', 'font-size': 9 }, '总计')
        ),
        React.createElement('div', { className: 'dsk-legend' },
          items.slice(0, 8).map(function(it, i) {
            return React.createElement('span', { key: i },
              React.createElement('span', { className: 'dsk-dot', style: { background: it.color } }), it.label
            )
          })
        )
      )
    }

    function BarList(props) {
      const items = props.items || []
      const max = items.length ? items[0].value : 1
      return React.createElement('div', { className: 'dsk-bars' },
        items.map(function(it, i) {
          return React.createElement('div', {
            key: i, className: 'dsk-bar-row' + (props.onSelect ? ' dsk-click' : ''),
            onClick: props.onSelect ? function() { props.onSelect(it) } : undefined,
            title: it.label
          },
            React.createElement('div', { className: 'dsk-bar-label' }, it.label),
            React.createElement('div', { className: 'dsk-bar-track' },
              React.createElement('div', { className: 'dsk-bar-fill', style: { width: Math.max(2, 100 * it.value / max) + '%', background: it.color } })
            ),
            React.createElement('div', { className: 'dsk-bar-val' }, fmtBytes(it.value))
          )
        })
      )
    }

    function Gauge(props) {
      const ratio = props.max > 0 ? Math.min(1, props.value / props.max) : 0
      return React.createElement('div', { className: 'dsk-gauge' },
        React.createElement('div', { className: 'gl' },
          React.createElement('span', null, props.label),
          React.createElement('span', null, props.text != null ? props.text : (props.value == null ? '—' : String(props.value)))
        ),
        React.createElement('div', { className: 'gb' },
          React.createElement('div', { style: { width: Math.max(2, ratio * 100) + '%', background: props.color || '#4f8cff' } })
        )
      )
    }

    function SuggestChip(props) {
      const s = props.s
      return React.createElement('div', { className: 'dsk-sugg-chip', onClick: props.onGo },
        RiskBadge(s.risk),
        React.createElement('span', { style: { flex: 1 } }, s.title),
        s.estBytes ? React.createElement('span', { className: 'dsk-est' }, '≈' + fmtBytes(s.estBytes)) : null,
        React.createElement('span', { className: 'dsk-muted' }, props.goLabel + ' →')
      )
    }

    // ================= Tab：概览 =================
    function OverviewTab(props) {
      const rp = props.report
      const sm = rp.summary
      const setTab = props.setTab
      const drill = props.drill
      const st = props.st

      const catItems = rp.category.map(function(c, i) { return { label: c.label, value: c.bytes, color: PALETTE[i % PALETTE.length] } })
      const topDirItems = rp.topDirs.map(function(d, i) { return { label: d.path, value: d.bytes, color: PALETTE[(i + 2) % PALETTE.length], path: d.path } })

      const driveCards = (sm.drives || []).map(function(d) {
        const u = sm.driveUsage ? sm.driveUsage[d.letter] : null
        const usedPct = u && (u.used + u.free) > 0 ? Math.round(100 * u.used / (u.used + u.free)) : null
        return React.createElement('div', { key: d.letter, className: 'dsk-card' },
          React.createElement('div', { className: 'k' }, d.letter + ' 盘'),
          React.createElement('div', { className: 'v' }, usedPct !== null ? usedPct + '% 已用' : fmtBytes(u ? u.used : 0)),
          React.createElement('div', { className: 'dsk-muted' }, u ? '剩余 ' + fmtBytes(u.free) : '容量信息不可用')
        )
      })
      const statCards = [
        { k: '文件数', v: String(sm.totalFiles) },
        { k: '目录数', v: String(sm.totalDirs) },
        { k: '总大小', v: fmtBytes(sm.totalBytes) },
        { k: '空文件夹', v: String(sm.emptyDirs) },
        { k: '耗时', v: (sm.elapsedMs / 1000).toFixed(1) + 's' }
      ].map(function(c, i) {
        return React.createElement('div', { key: i, className: 'dsk-card' },
          React.createElement('div', { className: 'k' }, c.k),
          React.createElement('div', { className: 'v' }, c.v)
        )
      })

      // 建议速览（点击跳对应 Tab）
      const suggChips = []
      for (const s of (rp.suggestions || [])) {
        let go = null
        if (s.type === 'junk-temp' || s.type === 'empty-dirs' || s.type === 'stale-large') go = ['clean', '去清理']
        else if (s.type === 'recycle-bin') go = ['clean', '去清理']
        else if (s.type === 'duplicates') go = ['dupes', '去处理']
        else if (s.type === 'organize-folders') go = ['organize', '去整理']
        if (!go) continue
        suggChips.push(React.createElement(SuggestChip, { key: s.type, s: s, goLabel: go[1], onGo: function() { setTab(go[0]) } }))
      }

      const drillView = st.drill && st.drill.ok ? (function() {
        const d = st.drill
        const parts = d.path.split(/[\\/]/).filter(Boolean)
        const crumb = React.createElement('div', { className: 'dsk-crumb' },
          React.createElement('a', { onClick: function() { props.clearDrill() } }, '← 返回总览'),
          React.createElement('span', { className: 'sep' }, ' / '),
          parts.map(function(p, i) {
            const up = parts.slice(0, i + 1).join('\\')
            return React.createElement('span', { key: i },
              React.createElement('a', { onClick: function() { drill(up) } }, p),
              i < parts.length - 1 ? React.createElement('span', { className: 'sep' }, ' / ') : null
            )
          })
        )
        const dirItems = d.dirs.map(function(x, i) { return { label: x.name + (x.cat !== '其他' ? ' · ' + x.cat : ''), value: x.bytes, color: PALETTE[(i + 2) % PALETTE.length], path: d.path + '\\' + x.name } })
        return React.createElement('div', null,
          crumb,
          React.createElement('div', { className: 'dsk-sec' }, '子目录（' + d.dirs.length + '）'),
          React.createElement(BarList, { items: dirItems, onSelect: function(it) { drill(it.path) } }),
          React.createElement('div', { className: 'dsk-sec' }, '文件（Top ' + d.files.length + '）'),
          React.createElement('table', { className: 'dsk-files' },
            React.createElement('tbody', null,
              d.files.slice(0, 10).map(function(f, i) {
                return React.createElement('tr', { key: i },
                  React.createElement('td', null, f.name),
                  React.createElement('td', null, fmtBytes(f.bytes))
                )
              })
            )
          )
        )
      })() : null

      return React.createElement('div', null,
        suggChips.length > 0 ? React.createElement('div', null,
          React.createElement('div', { className: 'dsk-sec' }, '建议速览（可释放约 ' + fmtBytes((rp.suggestions || []).reduce(function(a, s) { return a + (s.estBytes || 0) }, 0)) + '）'),
          suggChips
        ) : null,
        React.createElement('div', { className: 'dsk-cards' }, driveCards, statCards),
        React.createElement('div', { className: 'dsk-flex' },
          React.createElement('div', null,
            React.createElement('div', { className: 'dsk-sec' }, '空间分类'),
            React.createElement(Donut, { items: catItems })
          ),
          React.createElement('div', { style: { flex: 1, minWidth: 280 } },
            React.createElement('div', { className: 'dsk-sec' }, '占用最大的目录（点击下钻）'),
            React.createElement(BarList, { items: topDirItems, onSelect: function(it) { drill(it.path) } })
          )
        ),
        React.createElement('div', { className: 'dsk-sec' }, '最大文件 Top 10'),
        React.createElement('table', { className: 'dsk-files' },
          React.createElement('tbody', null,
            rp.topFiles.slice(0, 10).map(function(f, i) {
              return React.createElement('tr', { key: i },
                React.createElement('td', null, f.path),
                React.createElement('td', null, fmtBytes(f.bytes))
              )
            })
          )
        ),
        React.createElement('div', { className: 'dsk-tip' }, '扫描范围 ' + (sm.roots || []).join('、') + ' · 扫描时间 ' + (sm.scannedAt || '') + ' · 跳过：权限 ' + sm.skipped.permission + ' · 循环 ' + sm.skipped.cycle + ' · 保护 ' + sm.skipped.protected + ' · 排除 ' + sm.skipped.excluded),
        drillView
      )
    }

    // ================= Tab：清理中心 =================
    function CleanCenterTab(props) {
      const rp = props.report
      const [busy, setBusy] = React.useState(null)
      const [lastResult, setLastResult] = React.useState(null)

      const defs = [
        { type: 'junk-temp', title: '临时与缓存文件', pathsOf: function(s) { return s.paths || [] }, countOf: function(s) { return (s.paths || []).length } },
        { type: 'empty-dirs', title: '空文件夹', pathsOf: function(s) { return (s.items || []).map(function(x) { return x.path }) }, countOf: function(s) { return s.count || (s.items || []).length } },
        { type: 'stale-large', title: '长期未使用的大文件（>2年 · ≥500MB）', pathsOf: function(s) { return (s.items || []).map(function(x) { return x.path }) }, countOf: function(s) { return (s.items || []).length } }
      ]
      const rbSugg = (rp.suggestions || []).find(function(s) { return s.type === 'recycle-bin' })

      function doClean(type, paths, label) {
        setBusy(label)
        setLastResult(null)
        host.call('clean.execute', { type: type, paths: paths }).then(function(r) {
          setBusy(null)
          setLastResult({ label: label, r: r })
        }).catch(function(e) {
          setBusy(null)
          setLastResult({ label: label, r: { ok: false, error: (e && e.message) || String(e) } })
        })
      }

      const cards = []
      for (const def of defs) {
        const s = (rp.suggestions || []).find(function(x) { return x.type === def.type })
        const paths = s ? def.pathsOf(s) : []
        const has = s && paths.length > 0
        cards.push(React.createElement('div', { key: def.type, className: 'dsk-clean' },
          React.createElement('div', { className: 'head' },
            React.createElement('span', { className: 't' }, def.title),
            s ? RiskBadge(s.risk) : null,
            s && s.estBytes ? React.createElement('span', { className: 'est' }, '可释放 ≈' + fmtBytes(s.estBytes)) : null,
            React.createElement('span', { style: { flex: 1 } }),
            React.createElement('button', {
              className: 'dsk-btn primary',
              disabled: !has || busy !== null,
              onClick: function() { doClean(def.type, paths, def.title) }
            }, busy === def.title ? '清理中…' : '一键清理' + (has ? '（' + def.countOf(s) + ' 项）' : ''))
          ),
          s ? React.createElement('div', { className: 'dsk-muted' }, s.note || '') : React.createElement('div', { className: 'dsk-muted' }, '本次扫描未发现此类项目'),
          has ? DetailsOpen(paths, def.title) : null
        ))
      }

      // 回收站（不可逆，单独卡）
      cards.push(React.createElement('div', { key: 'rb', className: 'dsk-clean', style: { borderColor: 'rgba(232,93,117,.4)' } },
        React.createElement('div', { className: 'head' },
          React.createElement('span', { className: 't' }, '清空回收站'),
          rbSugg ? RiskBadge(rbSugg.risk) : null,
          rbSugg && rbSugg.estBytes ? React.createElement('span', { style: { color: '#e85d75', fontWeight: 600 } }, '约 ' + fmtBytes(rbSugg.estBytes)) : null,
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', {
            className: 'dsk-btn danger',
            disabled: busy !== null,
            onClick: function() { doClean('recycle-bin', [], '清空回收站') }
          }, busy === '清空回收站' ? '执行中…' : '清空（永久删除）')
        ),
        React.createElement('div', { className: 'dsk-warnbox' }, '⚠ 回收站清空后不可恢复。执行前会弹出系统审批，请确认后再批。')
      ))

      return React.createElement('div', null,
        lastResult ? ResultBanner(lastResult) : null,
        React.createElement('div', { className: 'dsk-infobox' }, '点击「一键清理」后会弹出 DSH 系统审批，批准后才真正执行；默认移入回收站（可恢复），全部操作写入审计日志。统计为扫描时快照，清理后重新扫描可刷新数字。'),
        cards
      )
    }

    function DetailsOpen(paths, title) {
      return React.createElement(Details_, { paths: paths, keyTitle: title })
    }
    function Details_(props) {
      const [open, setOpen] = React.useState(false)
      return React.createElement('div', null,
        React.createElement('a', { className: 'dsk-muted', style: { cursor: 'pointer', textDecoration: 'underline' }, onClick: function() { setOpen(!open) } },
          open ? '收起明细 ▲' : '展开明细（' + props.paths.length + ' 条）▼'
        ),
        open ? React.createElement('div', { className: 'dsk-detail' },
          props.paths.slice(0, 120).map(function(p, i) { return React.createElement('div', { key: i }, p) })
        ) : null
      )
    }

    function ResultBanner(lr) {
      const r = lr.r || {}
      return React.createElement('div', { className: 'dsk-result', style: { borderLeftColor: r.ok ? '#37c28a' : '#e85d75' } },
        (r.ok ? '✅ ' : '❌ ') + lr.label + '：' + (r.note || r.error || '完成') +
        (r.executed != null ? '（执行 ' + r.executed + '/' + (r.total || '?') + '）' : '')
      )
    }

    // ================= Tab：重复文件 =================
    function DupesTab(props) {
      const rp = props.report
      const roots = (rp.summary.roots || [])
      const dupScan = rp.summary.dupScan || null
      const scanGroups = []
      for (const s of (rp.suggestions || [])) {
        if (s.type === 'duplicates') for (const g of (s.groups || [])) scanGroups.push(g)
      }
      const [deep, setDeep] = React.useState({ running: false, res: null, err: null })
      const [busy, setBusy] = React.useState(null)
      const [lastMsg, setLastMsg] = React.useState(null)

      function deepScan() {
        if (deep.running) return
        setDeep({ running: true, res: null, err: null })
        const t0 = Date.now()
        host.call('dedup.scan', { roots: roots }).then(function(r) {
          setDeep({ running: false, res: r && r.ok ? r : null, err: r && !r.ok ? (r.error || '失败') : null, ms: Date.now() - t0 })
        }).catch(function(e) {
          setDeep({ running: false, res: null, err: (e && e.message) || String(e) })
        })
      }
      function hardlink(groups, label) {
        setBusy(label)
        setLastMsg(null)
        host.call('dedup.hardlink', { groups: groups }).then(function(r) {
          setBusy(null)
          setLastMsg((r && r.ok ? '✅ ' : '❌ ') + label + '：' + ((r && r.note) || (r && r.error) || '完成'))
        }).catch(function(e) { setBusy(null); setLastMsg('❌ ' + label + '：' + ((e && e.message) || String(e))) })
      }
      function rollbackHardlink() {
        setBusy('回滚硬链接')
        setLastMsg(null)
        host.call('dedup.rollback', {}).then(function(r) {
          setBusy(null)
          setLastMsg((r && r.ok ? '✅ ' : '❌ ') + '回滚硬链接：' + ((r && r.note) || (r && r.error) || '完成'))
        }).catch(function(e) { setBusy(null); setLastMsg('❌ 回滚硬链接：' + ((e && e.message) || String(e))) })
      }
      function recycleAll(groups) {
        const paths = []
        for (const g of groups) for (const p of (g.removable || [])) paths.push(p)
        setBusy('移入回收站')
        setLastMsg(null)
        host.call('clean.execute', { type: 'duplicates', paths: paths }).then(function(r) {
          setBusy(null)
          setLastMsg((r && r.ok ? '✅ ' : '❌ ') + '重复文件移入回收站：' + ((r && r.note) || (r && r.error) || '完成'))
          props.onRefresh()
        }).catch(function(e) { setBusy(null); setLastMsg('❌ 移入回收站：' + ((e && e.message) || String(e))) })
      }

      const covText = dupScan
        ? ('查重覆盖：' + (dupScan.userZoneSeen ? '用户区目录' : '无用户区（本盘非系统/用户盘）') + ' + 扫描根浅层扩展（' + (dupScan.wideCandidates || 0) + ' 个候选文件）。浅层查重只覆盖散落目录——全盘深度检测请用下方按钮。')
        : '查重覆盖信息不可用（旧版扫描报告）。'

      const groupRow = function(g, gi, actions) {
        return React.createElement('div', { key: gi, className: 'dsk-clean', style: { padding: '7px 10px' } },
          React.createElement('div', { className: 'head' },
            React.createElement('span', { className: 'est' }, fmtBytes(g.size)),
            g.scope === 'wide' ? React.createElement('span', { className: 'dsk-chip' }, '浅层') : null,
            React.createElement('span', { className: 'dsk-muted', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }, title: g.keep }, '保留：' + g.keep),
            actions
          ),
          React.createElement('div', { className: 'dsk-muted' }, '删除 ' + (g.removable || []).length + ' 个副本：' + (g.removable || []).slice(0, 2).join('　') + ((g.removable || []).length > 2 ? ' 等' : ''))
        )
      }

      return React.createElement('div', null,
        lastMsg ? React.createElement('div', { className: 'dsk-result' }, lastMsg) : null,
        React.createElement('div', { className: 'dsk-infobox' }, covText),
        React.createElement('div', { className: 'dsk-sec' }, '扫描期查重结果' + (scanGroups.length ? '（' + scanGroups.length + ' 组）' : '')),
        scanGroups.length > 0
          ? React.createElement('div', null,
              scanGroups.map(function(g, i) {
                return groupRow(g, i, React.createElement('button', { className: 'dsk-btn', disabled: busy !== null, onClick: function() { recycleAll([g]) } }, '这组移入回收站'))
              }),
              React.createElement('button', { className: 'dsk-btn primary', disabled: busy !== null, style: { marginTop: 6 }, onClick: function() { recycleAll(scanGroups) } },
                busy === '移入回收站' ? '执行中…' : '全部移入回收站（弹出审批）')
            )
          : React.createElement('div', { className: 'dsk-muted' }, '扫描期未发现重复文件（或本盘无用户区、候选过少）。可用下面的深度查重扫全盘。'),
        React.createElement('div', { className: 'dsk-sec' }, '深度全盘查重（head/tail 两阶段哈希，排除系统与程序目录）'),
        React.createElement('div', { className: 'dsk-row' },
          React.createElement('button', { className: 'dsk-btn primary', disabled: deep.running || busy !== null, onClick: deepScan },
            deep.running ? '深度查重中…可能需要数分钟' : '开始深度查重（范围：' + (roots.join('、') || '—') + '）'),
          React.createElement('button', { className: 'dsk-btn', disabled: busy !== null, onClick: rollbackHardlink }, '回滚上次硬链接合并')
        ),
        deep.err ? React.createElement('div', { className: 'dsk-warnbox' }, '深度查重失败：' + deep.err) : null,
        deep.running ? React.createElement('div', { className: 'dsk-progress' }, React.createElement('div', { style: { width: '30%' } })) : null,
        deep.res ? (function() {
          const groups = deep.res.groups || []
          return React.createElement('div', null,
            React.createElement('div', { className: 'dsk-muted' }, '发现 ' + (deep.res.groupCount || groups.length) + ' 组重复，可节省 ≈' + fmtBytes(deep.res.totalSaveBytes) + '（耗时 ' + ((deep.ms || deep.res.elapsedMs || 0) / 1000).toFixed(1) + 's）'),
            groups.slice(0, 50).map(function(g, i) {
              return groupRow({ size: g.size, keep: (g.files && g.files[0] && g.files[0].path) || '', removable: (g.files || []).slice(1).map(function(f) { return f.path }), scope: 'deep' }, 'd' + i,
                React.createElement('button', { className: 'dsk-btn good', disabled: busy !== null, onClick: function() { hardlink([g], '硬链接合并组#' + (i + 1)) } }, '硬链接合并'))
            }),
            groups.length > 0 ? React.createElement('button', { className: 'dsk-btn good', disabled: busy !== null, style: { marginTop: 6 }, onClick: function() { hardlink(groups, '全部组硬链接合并') } },
              busy && busy.indexOf('硬链接') >= 0 ? '合并中…' : '全部硬链接合并（省空间，可回滚，弹出审批）') : null
          )
        })() : null,
        React.createElement('div', { className: 'dsk-tip' }, '硬链接合并 = 同一文件只存一份，删除多余副本但保留所有路径入口；可用「回滚」还原为独立文件。')
      )
    }

    // ================= Tab：一键整理 =================
    function OrganizeTab() {
      const [plan, setPlan] = React.useState(null)
      const [includeProgram, setIncludeProgram] = React.useState(false)
      const [checked, setChecked] = React.useState({})
      const [busy, setBusy] = React.useState(null)
      const [lastMsg, setLastMsg] = React.useState(null)
      const [genErr, setGenErr] = React.useState(null)

      function gen() {
        setBusy('生成方案')
        setGenErr(null)
        setPlan(null)
        host.call('organize.plan', { includeProgram: includeProgram }).then(function(r) {
          setBusy(null)
          if (r && r.ok && (r.items || []).length > 0) {
            const init = {}
            for (let i = 0; i < r.items.length; i++) init[i] = r.items[i].kind !== 'program'
            setPlan(r); setChecked(init)
          } else if (r && r.ok) {
            setGenErr('未发现可整理的散落目录/文件')
          } else {
            setGenErr((r && r.error) || '生成失败')
          }
        }).catch(function(e) { setBusy(null); setGenErr((e && e.message) || String(e)) })
      }
      function apply() {
        if (!plan) return
        const items = []
        for (let i = 0; i < plan.items.length; i++) {
          if (!checked[i]) continue
          const it = plan.items[i]
          items.push({ src: it.src, dst: it.dst, kind: it.kind, fixShortcuts: it.kind === 'program' })
        }
        if (items.length === 0) return
        setBusy('执行整理')
        setLastMsg(null)
        host.call('organize.apply', { items: items }).then(function(r) {
          setBusy(null)
          setLastMsg((r && r.ok ? '✅ ' : '❌ ') + '整理：' + ((r && r.note) || (r && r.error) || '完成'))
        }).catch(function(e) { setBusy(null); setLastMsg('❌ 整理：' + ((e && e.message) || String(e))) })
      }
      function rollback() {
        setBusy('回滚')
        setLastMsg(null)
        host.call('organize.rollback', {}).then(function(r) {
          setBusy(null)
          setLastMsg((r && r.ok ? '✅ ' : '❌ ') + '回滚：' + ((r && r.note) || (r && r.error) || '完成'))
        }).catch(function(e) { setBusy(null); setLastMsg('❌ 回滚：' + ((e && e.message) || String(e))) })
      }

      let selCount = 0, selBytes = 0
      if (plan) for (let i = 0; i < plan.items.length; i++) {
        if (checked[i]) { selCount++; selBytes += plan.items[i].bytes || 0 }
      }
      const kindBadge = function(kind) {
        if (kind === 'program') return React.createElement('span', { className: 'dsk-badge', style: { background: '#ff9f43' } }, '程序⚠')
        if (kind === 'dir') return React.createElement('span', { className: 'dsk-badge', style: { background: '#3fc1c9' } }, '目录')
        return React.createElement('span', { className: 'dsk-badge', style: { background: '#8e7cf3' } }, '文件')
      }

      return React.createElement('div', null,
        lastMsg ? React.createElement('div', { className: 'dsk-result', style: { borderLeftColor: lastMsg.indexOf('✅') >= 0 ? '#37c28a' : '#e85d75' } }, lastMsg) : null,
        React.createElement('div', { className: 'dsk-infobox' }, '整理 = 把用户区/盘根的散落目录与文件按类型移动到 <盘>:\\整理区\\<分类>\\。不删除任何东西，全程可一键回滚。程序/游戏目录移动会破坏快捷方式——如勾选将自动重写桌面/开始菜单/任务栏快捷方式。'),
        React.createElement('div', { className: 'dsk-row' },
          React.createElement('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 } },
            React.createElement('input', { type: 'checkbox', checked: includeProgram, onChange: function(e) { setIncludeProgram(e.target.checked) }, disabled: busy !== null }),
            '包含程序/游戏目录（自动重写快捷方式）'
          ),
          React.createElement('button', { className: 'dsk-btn primary', disabled: busy !== null, onClick: gen },
            busy === '生成方案' ? '分析中…' : (plan ? '重新生成方案' : '生成整理方案')),
          plan ? React.createElement('button', { className: 'dsk-btn good', disabled: busy !== null || selCount === 0, onClick: apply },
            busy === '执行整理' ? '执行中…' : '执行所选（' + selCount + ' 项 · ' + fmtBytes(selBytes) + '，弹出审批）') : null,
          React.createElement('button', { className: 'dsk-btn', disabled: busy !== null, onClick: rollback }, busy === '回滚' ? '回滚中…' : '回滚上一批整理')
        ),
        genErr ? React.createElement('div', { className: 'dsk-muted' }, genErr) : null,
        plan ? React.createElement('div', null,
          React.createElement('div', { className: 'dsk-sec' }, '方案预览（共 ' + plan.items.length + ' 项 · ' + fmtBytes(plan.totalBytes) + (plan.dirCount != null ? '：' + plan.dirCount + ' 目录 / ' + plan.fileCount + ' 文件' + (plan.programCount ? ' / ' + plan.programCount + ' 程序⚠' : '') : '') + '）'),
          React.createElement('table', { className: 'dsk-files' },
            React.createElement('tbody', null,
              plan.items.map(function(it, i) {
                return React.createElement('tr', { key: i, style: it.kind === 'program' ? { opacity: checked[i] ? 1 : .55 } : null },
                  React.createElement('td', null, React.createElement('input', { type: 'checkbox', checked: !!checked[i], onChange: function(e) {
                    setChecked(function(c) { const n = Object.assign({}, c); n[i] = e.target.checked; return n })
                  } })),
                  React.createElement('td', null, kindBadge(it.kind)),
                  React.createElement('td', { style: { maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }, title: it.src }, it.src),
                  React.createElement('td', { className: 'dsk-muted' }, '→'),
                  React.createElement('td', { style: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }, title: it.dst, className: 'dsk-muted' }, it.dst),
                  React.createElement('td', null, fmtBytes(it.bytes))
                )
              })
            )
          ),
          plan.items.some(function(it) { return it.kind === 'program' }) ? React.createElement('div', { className: 'dsk-warnbox' }, '⚠ 带「程序」徽章的行默认未勾选：移动会破坏其快捷方式；勾选表示接受自动重写快捷方式（记录在案，可随回滚恢复）。') : null
        ) : null
      )
    }

    // ================= Tab：磁盘健康 =================
    function HealthTab() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const load = function() {
        setData(null); setErr(null)
        host.call('health.get', {}).then(function(r) {
          if (r && r.ok) setData(r.disks)
          else setErr((r && r.error) || '获取失败')
        }).catch(function(e) { setErr((e && e.message) || String(e)) })
      }
      React.useEffect(load, [])

      if (err) return React.createElement('div', null,
        React.createElement('div', { className: 'dsk-warnbox' }, err),
        React.createElement('button', { className: 'dsk-btn', onClick: load }, '重试'))

      const disks = data || []
      const rank = { '健康': 0, '注意': 1, '警告': 2, '危险': 3 }
      let worst = null
      for (const d of disks) if (!worst || (rank[d.grade] || 0) > (rank[worst.grade] || 0)) worst = d
      const cnt = { healthy: disks.filter(function(d) { return d.grade === '健康' }).length, warn: disks.filter(function(d) { return d.grade === '注意' || d.grade === '警告' }).length, danger: disks.filter(function(d) { return d.grade === '危险' }).length }

      return React.createElement('div', null,
        data === null ? React.createElement('div', { className: 'dsk-muted' }, '正在读取 SMART 数据…（需管理员权限）') : null,
        data !== null ? React.createElement('div', null,
          React.createElement('div', { className: 'dsk-row' },
            worst ? GradeBadge(worst.grade) : null,
            React.createElement('span', { style: { fontWeight: 600 } },
              worst ? ('系统存储健康：' + worst.grade + (worst.issues.length ? ' — ' + worst.issues[0] : '')) : '未发现物理磁盘'),
            React.createElement('span', { className: 'dsk-chip' }, '✅ ' + cnt.healthy),
            cnt.warn ? React.createElement('span', { className: 'dsk-chip', style: { color: '#f2c14e' } }, '⚠ ' + cnt.warn) : null,
            cnt.danger ? React.createElement('span', { className: 'dsk-chip', style: { color: '#e85d75' } }, '⛔ ' + cnt.danger) : null,
            React.createElement('button', { className: 'dsk-btn', style: { marginLeft: 'auto' }, onClick: load }, '刷新')
          ),
          disks.map(function(d, i) { return DiskHealthCard(d, i) })
        ) : null
      )
    }

    function DiskHealthCard(d, i) {
      const chips = [d.media, d.bus, d.size ? fmtBytes(d.size) : null, d.firmware ? '固件 ' + d.firmware : null].filter(Boolean)
      return React.createElement('div', { key: i, className: 'dsk-clean' },
        React.createElement('div', { className: 'head' },
          React.createElement('span', { className: 't' }, d.name),
          GradeBadge(d.grade),
          chips.map(function(c, j) { return React.createElement('span', { key: j, className: 'dsk-chip' }, c) })
        ),
        d.op && d.op !== 'OK' ? React.createElement('div', { className: 'dsk-warnbox' }, '运行状态异常：' + d.op) : null,
        d.issues.length > 0 ? React.createElement('div', { className: 'dsk-warnbox' }, '⚠ ' + d.issues.join('；')) : null,
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '0 18px' } },
          Gauge({ label: '温度', value: d.temp, max: 80, text: d.temp != null ? d.temp + ' °C' : '—', color: d.temp > 55 ? '#e85d75' : d.temp > 45 ? '#f2c14e' : '#37c28a' }),
          Gauge({ label: 'SSD 寿命已用', value: d.wear, max: 100, text: d.wear != null ? d.wear + ' %' : '—', color: d.wear > 80 ? '#e85d75' : d.wear > 60 ? '#f2c14e' : '#37c28a' }),
          Gauge({ label: '通电时间', value: d.poh, max: 60000, text: d.poh != null ? d.poh.toLocaleString() + ' 小时' : '—' }),
          Gauge({ label: '通电次数', value: d.powerCycle, max: 50000, text: d.powerCycle != null ? Number(d.powerCycle).toLocaleString() + ' 次' : '—' }),
          Gauge({ label: '启停次数', value: d.startStop, max: 100000, text: d.startStop != null ? Number(d.startStop).toLocaleString() : '—' }),
          Gauge({ label: '磁头加载次数', value: d.loadUnload, max: 600000, text: d.loadUnload != null ? Number(d.loadUnload).toLocaleString() : '—' })
        ),
        React.createElement('div', { className: 'dsk-muted' },
          '读纠错 ' + (d.readErrCorr != null ? Number(d.readErrCorr).toLocaleString() : '—') +
          ' · 读不可纠 ' + (d.readErrUncorr != null ? Number(d.readErrUncorr).toLocaleString() : '—') +
          ' · 写纠错 ' + (d.writeErrCorr != null ? Number(d.writeErrCorr).toLocaleString() : '—') +
          ' · 写不可纠 ' + (d.writeErrUncorr != null ? Number(d.writeErrUncorr).toLocaleString() : '—') +
          (d.serial ? ' · S/N ' + String(d.serial).slice(0, 10) : '')
        ),
        d.volumes && d.volumes.length > 0 ? React.createElement('div', { style: { marginTop: 6 } },
          React.createElement('div', { className: 'dsk-muted' }, '承载的卷：'),
          React.createElement('table', { className: 'dsk-files' },
            React.createElement('tbody', null,
              d.volumes.map(function(v, j) {
                const usedPct = v.size && v.free != null && v.size > 0 ? Math.round(100 * (v.size - v.free) / v.size) : null
                return React.createElement('tr', { key: j },
                  React.createElement('td', null, v.letter ? v.letter + ':' : '(无盘符)'),
                  React.createElement('td', null, v.fs || '—'),
                  React.createElement('td', null, v.size ? fmtBytes(v.size) : '—'),
                  React.createElement('td', null, usedPct != null ? usedPct + '% 已用 · 余 ' + fmtBytes(v.free) : '—')
                )
              })
            )
          )
        ) : null
      )
    }

    // ================= 主面板 =================
    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'clean', label: '清理中心' },
      { id: 'dupes', label: '重复文件' },
      { id: 'organize', label: '一键整理' },
      { id: 'health', label: '磁盘健康' }
    ]

    function DiskPanel() {
      const [st, set] = React.useState({
        tab: 'overview', status: null, report: null, drill: null, drillPath: '',
        letters: [], usage: null, checked: [], scanning: false, error: null
      })

      React.useEffect(function() {
        host.call('report.drives', {}).then(function(r) {
          if (r && r.letters) {
            set(function(s) { return Object.assign({}, s, { letters: r.letters, checked: r.letters.slice(), usage: r.usage || null }) })
          }
        })
        fetchReport()
        return undefined
      }, [])

      React.useEffect(function() {
        if (!st.scanning) return undefined
        const d = ctx.interval(function() {
          host.call('scan.status', {}).then(function(s) {
            if (!s) return
            if (s.status === 'running') {
              set(function(prev) { return Object.assign({}, prev, { status: s }) })
            } else {
              set(function(prev) { return Object.assign({}, prev, { scanning: false, status: s }) })
              fetchReport()
            }
          })
        }, 500)
        return d
      }, [st.scanning])

      function fetchReport() {
        host.call('report.get', {}).then(function(r) {
          set(function(prev) { return Object.assign({}, prev, { report: r && r.ok ? r : prev.report, drill: null, drillPath: '' }) })
        })
      }

      function startScan() {
        const roots = st.checked.map(function(l) { return l + ':' })
        if (roots.length === 0) return
        set(function(s) { return Object.assign({}, s, { scanning: true, error: null }) })
        host.call('scan.start', { roots: roots, exclude: [] }).then(function(r) {
          if (!r || !r.ok) {
            set(function(s) { return Object.assign({}, s, { scanning: false, error: (r && r.error) || '启动失败' }) })
          }
        })
      }

      function cancelScan() {
        host.call('scan.cancel', {}).then(function() {})
      }

      function drill(path) {
        host.call('report.dir', { path: path }).then(function(r) {
          if (r && r.ok) set(function(s) { return Object.assign({}, s, { drill: r, drillPath: r.path, tab: 'overview' }) })
        })
      }

      function toggle(l) {
        set(function(s) {
          const c = s.checked.slice()
          const i = c.indexOf(l)
          if (i >= 0) c.splice(i, 1); else c.push(l)
          return Object.assign({}, s, { checked: c })
        })
      }

      const top = st.status ? st.status.progress : null
      const rp = st.report
      const done = rp && rp.ok

      const header = React.createElement('div', { className: 'dsk-row' },
        React.createElement('span', { style: { fontWeight: 600, fontSize: 14 } }, '磁盘分析器'),
        st.letters.map(function(l) {
          return React.createElement('label', { key: l, style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 13 } },
            React.createElement('input', { type: 'checkbox', checked: st.checked.indexOf(l) >= 0, onChange: function() { toggle(l) }, disabled: st.scanning }),
            l + ':'
          )
        }),
        React.createElement('button', { className: 'dsk-btn primary', onClick: startScan, disabled: st.scanning || st.checked.length === 0 }, st.scanning ? '扫描中…' : '开始扫描'),
        st.scanning ? React.createElement('button', { className: 'dsk-btn', onClick: cancelScan }, '取消') : null
      )

      const progressBar = st.scanning && top ? React.createElement('div', { className: 'dsk-row' },
        React.createElement('div', { className: 'dsk-progress' },
          React.createElement('div', { style: { width: '100%' } })
        ),
        React.createElement('span', { className: 'dsk-muted' }, '文件 ' + top.files + ' · 目录 ' + top.dirs + ' · ' + fmtBytes(top.bytes) + ' · ' + (top.currentPath || '…'))
      ) : null

      const errorBox = st.error ? React.createElement('div', { className: 'dsk-tip', style: { color: '#e85d75' } }, '错误：' + st.error) : null

      let tabBar = null
      let body = null
      if (done) {
        tabBar = React.createElement('div', { className: 'dsk-tabs' },
          TABS.map(function(t) {
            return React.createElement('button', {
              key: t.id,
              className: 'dsk-tab' + (st.tab === t.id ? ' on' : ''),
              onClick: function() { set(function(s) { return Object.assign({}, s, { tab: t.id }) }) }
            }, t.label)
          })
        )
        if (st.tab === 'overview') body = OverviewTab({ report: rp, st: st, setTab: function(id) { set(function(s) { return Object.assign({}, s, { tab: id }) }) }, drill: drill, clearDrill: function() { set(function(s) { return Object.assign({}, s, { drill: null }) }) } })
        else if (st.tab === 'clean') body = CleanCenterTab({ report: rp, onRefresh: fetchReport })
        else if (st.tab === 'dupes') body = DupesTab({ report: rp, onRefresh: fetchReport })
        else if (st.tab === 'organize') body = OrganizeTab()
        else if (st.tab === 'health') body = HealthTab()
      } else if (rp && !rp.ok) {
        body = React.createElement('div', { className: 'dsk-tip' }, (rp && rp.error) || '尚未扫描')
      } else {
        body = React.createElement('div', { className: 'dsk-muted' }, '选择盘符并点击「开始扫描」，完成后这里会出现 概览 / 清理中心 / 重复文件 / 一键整理 / 磁盘健康 五个页签。')
      }

      return React.createElement('div', { className: 'dsk-panel' },
        header, progressBar, errorBox, tabBar, body
      )
    }

    slots.inject('tool.view.cordis', function() {
      return slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        function(props) { return React.createElement(DiskPanel) }
      )
    })
  }
}
