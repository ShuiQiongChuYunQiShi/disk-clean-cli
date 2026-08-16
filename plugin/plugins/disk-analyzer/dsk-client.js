// dsk-client.js — 磁盘分析可视化面板（动态插件 Client 半区，tool.view.cordis key=self）
// 纯 JS + React.createElement + 手写 SVG 图表；数据经 host.call('scan.status'/'report.get') 获取
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const dis = styles.insert(
      '.dsk-panel{font-family:system-ui,sans-serif;font-size:12px;line-height:1.5;border:1px solid rgba(128,128,128,.35);border-radius:8px;padding:10px 12px;margin:6px 0;background:rgba(128,128,128,.06);color:inherit}' +
      '.dsk-panel h4{margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:8px}' +
      '.dsk-panel .row{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0}' +
      '.dsk-panel .stat{min-width:88px}' +
      '.dsk-panel .num{font-size:16px;font-weight:600}' +
      '.dsk-panel .lbl{opacity:.6;font-size:11px}' +
      '.dsk-panel .cols{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}' +
      '.dsk-panel .legend{font-size:11px;max-width:220px}' +
      '.dsk-panel .legend div{display:flex;align-items:center;gap:6px;margin:2px 0}' +
      '.dsk-panel .sw{width:10px;height:10px;border-radius:2px;display:inline-block;flex:none}' +
      '.dsk-panel table{border-collapse:collapse;width:100%;margin:4px 0;font-size:11px}' +
      '.dsk-panel td,.dsk-panel th{border-bottom:1px solid rgba(128,128,128,.18);padding:3px 6px;text-align:left;vertical-align:top}' +
      '.dsk-panel .bar{background:rgba(128,128,128,.15);border-radius:3px;height:9px;overflow:hidden;min-width:120px}' +
      '.dsk-panel .bar>div{height:100%}' +
      '.dsk-panel .btn{border:1px solid rgba(128,128,128,.4);border-radius:5px;background:transparent;color:inherit;font-size:11px;padding:2px 10px;cursor:pointer;margin-left:auto}' +
      '.dsk-panel .prog{color:inherit;opacity:.85}' +
      '.dsk-panel .warn{color:#e5a13b}' +
      '.dsk-panel .ok{color:#4caf7d}'
    )
    ctx.effect(function() { return dis })

    const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#86bcb6', '#d37295']
    function fmtB(n) {
      if (!n || n < 0) return '0 B'
      const u = ['B', 'KB', 'MB', 'GB', 'TB']
      let v = n, k = 0
      while (v >= 1024 && k < u.length - 1) { v /= 1024; k++ }
      return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k]
    }
    function pct(a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '0%' }

    function PieChart(props) {
      const data = props.data || []
      const total = data.reduce(function(a, d) { return a + (d.bytes || 0) }, 0)
      if (!total) return React.createElement('div', null, '—')
      const cx = 100, cy = 100, r = 80
      let angle = -Math.PI / 2
      const paths = []
      const legend = []
      data.forEach(function(d, i) {
        const frac = (d.bytes || 0) / total
        const a2 = angle + frac * 2 * Math.PI
        const large = (a2 - angle) > Math.PI ? 1 : 0
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
        const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
        const col = PALETTE[i % PALETTE.length]
        paths.push(React.createElement('path', { key: 'p' + i, d: 'M' + cx + ',' + cy + ' L' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z', fill: col, stroke: 'rgba(0,0,0,.15)', strokeWidth: 1 }))
        legend.push(React.createElement('div', { key: 'l' + i },
          React.createElement('span', { className: 'sw', style: { background: col } }),
          React.createElement('span', null, d.label + ' ' + fmtB(d.bytes) + '（' + pct(d.bytes, total) + '）')
        ))
        angle = a2
      })
      return React.createElement('div', { className: 'cols' },
        React.createElement('svg', { viewBox: '0 0 200 200', width: 170, height: 170, style: { display: 'block', flex: 'none' } }, paths),
        React.createElement('div', { className: 'legend' }, legend)
      )
    }

    function DskPanel() {
      const [view, setView] = React.useState({ phase: 'loading', scan: null, report: null, err: null })
      const load = React.useCallback(function() {
        return host.call('scan.status', {}).then(function(st) {
          if (st && st.status === 'running') { setView({ phase: 'running', scan: st, report: null, err: null }); return }
          return host.call('report.get', {}).then(function(rep) {
            if (rep && rep.ok === false) setView({ phase: 'idle', scan: st, report: null, err: rep.error || null })
            else setView({ phase: 'done', scan: st, report: rep, err: null })
          }).catch(function(e) { setView({ phase: 'error', scan: st, report: null, err: String((e && e.message) || e) }) })
        }).catch(function(e) { setView({ phase: 'error', scan: null, report: null, err: String((e && e.message) || e) }) })
      }, [])
      React.useEffect(function() {
        let alive = true
        function tick() {
          host.call('scan.status', {}).then(function(st) {
            if (!alive) return
            if (st && st.status === 'running') {
              setView({ phase: 'running', scan: st, report: null, err: null })
              ctx.timeout(tick, 2500)
            } else { load() }
          }).catch(function() { if (alive) ctx.timeout(tick, 4000) })
        }
        tick()
        return function() { alive = false }
      }, [load])

      const p = view.phase
      if (p === 'loading') return React.createElement('div', { className: 'dsk-panel' }, React.createElement('h4', null, '磁盘分析面板'), '加载中…')
      if (p === 'error') return React.createElement('div', { className: 'dsk-panel' }, React.createElement('h4', null, '磁盘分析面板'), React.createElement('span', { style: { color: '#e15759' } }, '无法连接分析服务：' + (view.err || '未知错误')), React.createElement('button', { className: 'btn', onClick: load }, '重试'))
      if (p === 'running') {
        const pr = (view.scan && view.scan.progress) || {}
        return React.createElement('div', { className: 'dsk-panel' },
          React.createElement('h4', null, '磁盘分析面板', React.createElement('span', { className: 'prog' }, '⏳ 扫描中')),
          React.createElement('div', { className: 'row' },
            React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, fmtB(pr.bytes || 0)), React.createElement('div', { className: 'lbl' }, '已统计')),
            React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, (pr.files || 0).toLocaleString()), React.createElement('div', { className: 'lbl' }, '文件')),
            React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, (pr.dirs || 0).toLocaleString()), React.createElement('div', { className: 'lbl' }, '目录')),
            React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, ((view.scan && view.scan.elapsedMs) || 0) / 1000 + 's'), React.createElement('div', { className: 'lbl' }, '已用'))
          ),
          React.createElement('div', { className: 'prog', style: { wordBreak: 'break-all' } }, pr.currentPath || ''),
          React.createElement('button', { className: 'btn', onClick: load }, '刷新')
        )
      }
      if (p === 'idle') return React.createElement('div', { className: 'dsk-panel' },
        React.createElement('h4', null, '磁盘分析面板'),
        React.createElement('div', null, '还没有扫描结果。对助手说「扫描 D 盘」开始分析。', view.err ? React.createElement('div', { style: { color: '#e15759' } }, '（' + view.err + '）') : null),
        React.createElement('button', { className: 'btn', onClick: load }, '刷新')
      )
      const rep = view.report || {}
      const sm = rep.summary || {}
      const cat = (rep.category || []).slice(0, 8)
      const dirs = (rep.topDirs || []).slice(0, 8)
      const sugg = rep.suggestions || []
      const org = rep.organize || null
      const est = sugg.reduce(function(a, s) { return a + (s.estBytes || 0) }, 0)
      return React.createElement('div', { className: 'dsk-panel' },
        React.createElement('h4', null, '磁盘分析面板', React.createElement('button', { className: 'btn', onClick: load }, '刷新')),
        React.createElement('div', { className: 'row' },
          React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, fmtB(sm.totalBytes)), React.createElement('div', { className: 'lbl' }, '总大小')),
          React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, (sm.totalFiles || 0).toLocaleString()), React.createElement('div', { className: 'lbl' }, '文件')),
          React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, (sm.totalDirs || 0).toLocaleString()), React.createElement('div', { className: 'lbl' }, '目录')),
          React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, ((sm.elapsedMs || 0) / 1000).toFixed(1) + 's'), React.createElement('div', { className: 'lbl' }, '耗时')),
          React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num' }, fmtB(est)), React.createElement('div', { className: 'lbl' }, '建议可释放/涉及'))
        ),
        cat.length > 0 ? React.createElement('div', { style: { marginTop: 6 } }, React.createElement('div', { className: 'lbl', style: { marginBottom: 4 } }, '类别占比'), React.createElement(PieChart, { data: cat })) : null,
        dirs.length > 0 ? React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', { className: 'lbl', style: { marginBottom: 4 } }, '大目录 Top ' + dirs.length),
          React.createElement('table', null,
            React.createElement('tbody', null, dirs.map(function(d, i) {
              const w = (d.bytes / dirs[0].bytes * 100)
              return React.createElement('tr', { key: i },
                React.createElement('td', { style: { maxWidth: 220, wordBreak: 'break-all' } }, d.path),
                React.createElement('td', null, fmtB(d.bytes)),
                React.createElement('td', null, React.createElement('div', { className: 'bar' }, React.createElement('div', { style: { width: Math.max(3, w) + '%', background: PALETTE[i % PALETTE.length] } })))
              )
            }))
          )
        ) : null,
        sugg.length > 0 ? React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', { className: 'lbl', style: { marginBottom: 4 } }, '智能建议（' + sugg.length + ' 类）'),
          React.createElement('table', null,
            React.createElement('tbody', null, sugg.map(function(s, i) {
              const riskCol = s.risk === 'high' || s.risk === 'high-irreversible' ? '#e15759' : (s.risk === 'medium' ? '#e5a13b' : 'inherit')
              return React.createElement('tr', { key: i },
                React.createElement('td', null, (i + 1) + '. ' + s.title),
                React.createElement('td', null, s.estBytes != null ? fmtB(s.estBytes) : '—'),
                React.createElement('td', { style: { color: riskCol } }, s.risk || '')
              )
            }))
          )
        ) : null,
        org ? React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', { className: 'lbl', style: { marginBottom: 4 } }, '目录整理候选'),
          React.createElement('div', { className: 'row' },
            React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num ok' }, String(org.looseCandidates || 0)), React.createElement('div', { className: 'lbl' }, '可整理')),
            React.createElement('div', { className: 'stat' }, React.createElement('div', { className: 'num warn' }, String(org.programHints || 0)), React.createElement('div', { className: 'lbl' }, '程序目录（仅提示）'))
          )
        ) : null
      )
    }

    slots.inject('tool.view.cordis', function() {
      return slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        function(props) { return React.createElement(DskPanel) }
      )
    })
  }
}
