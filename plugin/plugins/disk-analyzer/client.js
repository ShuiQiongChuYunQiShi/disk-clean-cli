// Windows 磁盘分析器 —— 客户端半（产品化模板）
// 通过 cordis_define 定义时作为 code.client 传入。
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert(
      '.dsk-panel{font-size:13px;line-height:1.5;color:var(--text-1,#e8e8e8);max-width:720px}' +
      '.dsk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}' +
      '.dsk-btn{background:var(--button-bg,#2a2f3a);border:1px solid var(--border,#3a3f4b);color:var(--text-1,#e8e8e8);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:13px}' +
      '.dsk-btn:hover{filter:brightness(1.15)}' +
      '.dsk-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.dsk-btn.primary{background:#4f8cff;border-color:#4f8cff;color:#fff}' +
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
      '.dsk-suggest{background:var(--bg-2,#22262e);border:1px solid var(--border,#333);border-radius:6px;padding:8px 10px;margin:6px 0}' +
      '.dsk-suggest-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.dsk-badge{color:#fff;border-radius:4px;padding:1px 8px;font-size:11px}' +
      '.dsk-suggest-items{font-size:12px;color:var(--text-2,#9aa);margin-top:4px;max-height:120px;overflow:auto}'
    )

    function fmtBytes(n) {
      if (!n || n < 0) return '0 B'
      const u = ['B','KB','MB','GB','TB']
      let v = n, k = 0
      while (v >= 1024 && k < u.length - 1) { v /= 1024; k++ }
      return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[k]
    }
    const PALETTE = ['#4f8cff','#37c28a','#ff9f43','#e85d75','#8e7cf3','#3fc1c9','#f2c14e','#7b8cde','#5abf6f','#d97bc4','#a8b8c8','#c9a86a']

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

    function SuggestList(props) {
      const items = props.items || []
      const riskColor = { low: '#37c28a', medium: '#f2c14e', high: '#ff9f43', 'high-irreversible': '#e85d75' }
      const riskLabel = { low: '低风险', medium: '中风险', high: '高风险', 'high-irreversible': '不可逆' }
      return React.createElement('div', null,
        items.map(function(s, i) {
          const rows = []
          if (s.items) rows.push(s.items.slice(0, 5).map(function(it) { return it.path || it.label }).join('；'))
          if (s.groups) rows.push(s.groups.slice(0, 5).map(function(g) { return '删 ' + g.removable.length + ' 个，保留 ' + g.keep }).join('；'))
          return React.createElement('div', { key: i, className: 'dsk-suggest', style: { borderLeft: '3px solid ' + (riskColor[s.risk] || '#999') } },
            React.createElement('div', { className: 'dsk-suggest-head' },
              React.createElement('span', { style: { fontWeight: 600 } }, s.title),
              React.createElement('span', { className: 'dsk-badge', style: { background: riskColor[s.risk] || '#999' } }, riskLabel[s.risk] || s.risk),
              React.createElement('span', { className: 'dsk-muted' }, s.estBytes ? '可释放 ' + fmtBytes(s.estBytes) : '')
            ),
            React.createElement('div', { className: 'dsk-muted' }, s.note || ''),
            rows.length ? React.createElement('div', { className: 'dsk-suggest-items' }, rows.map(function(r, j) { return React.createElement('div', { key: j }, r) })) : null
          )
        })
      )
    }

    function DiskPanel() {
      const [st, set] = React.useState({
        phase: 'idle', status: null, report: null, drill: null, drillPath: '',
        letters: [], usage: null, checked: [], scanning: false, error: null
      })

      React.useEffect(function() {
        host.call('report.drives', {}).then(function(r) {
          if (r && r.letters) {
            set(function(s) { return Object.assign({}, s, { letters: r.letters, checked: r.letters.slice(), usage: r.usage || null }) })
          }
        })
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
        set(function(s) { return Object.assign({}, s, { scanning: true, error: null, phase: 'running' }) })
        host.call('scan.start', { roots: roots, exclude: [] }).then(function(r) {
          if (!r || !r.ok) {
            set(function(s) { return Object.assign({}, s, { scanning: false, phase: 'idle', error: (r && r.error) || '启动失败' }) })
          }
        })
      }

      function cancelScan() {
        host.call('scan.cancel', {}).then(function() {})
      }

      function drill(path) {
        host.call('report.dir', { path: path }).then(function(r) {
          if (r && r.ok) set(function(s) { return Object.assign({}, s, { drill: r, drillPath: r.path }) })
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

      let body = null
      if (done) {
        const sm = rp.summary
        const catItems = rp.category.map(function(c, i) { return { label: c.label, value: c.bytes, color: PALETTE[i % PALETTE.length] } })
        const topDirItems = rp.topDirs.map(function(d, i) { return { label: d.path, value: d.bytes, color: PALETTE[(i + 2) % PALETTE.length], path: d.path } })
        const extItems = rp.extTop.map(function(e, i) { return { label: e.ext, value: e.bytes, color: PALETTE[(i + 1) % PALETTE.length] } })

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
          { k: '跳过', v: String(sm.skipped.permission + sm.skipped.cycle + sm.skipped.protected + sm.skipped.excluded + sm.skipped.deep) },
          { k: '耗时', v: (sm.elapsedMs / 1000).toFixed(1) + 's' }
        ].map(function(c, i) {
          return React.createElement('div', { key: i, className: 'dsk-card' },
            React.createElement('div', { className: 'k' }, c.k),
            React.createElement('div', { className: 'v' }, c.v)
          )
        })

        const suggestBlock = rp.suggestions && rp.suggestions.length ? React.createElement('div', null,
          React.createElement('div', { className: 'dsk-sec' }, '智能建议（' + rp.suggestions.length + ' 项，可释放约 ' + fmtBytes(rp.suggestions.reduce(function(a, s) { return a + (s.estBytes || 0) }, 0)) + '）'),
          React.createElement(SuggestList, { items: rp.suggestions })
        ) : null

        body = React.createElement('div', null,
          suggestBlock,
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
          React.createElement('div', { className: 'dsk-sec' }, '扩展名分布'),
          React.createElement(BarList, { items: extItems }),
          React.createElement('div', { className: 'dsk-flex' },
            React.createElement('div', { style: { flex: 1, minWidth: 240 } },
              React.createElement('div', { className: 'dsk-sec' }, '垃圾点/缓存占用'),
              rp.junk.length ? React.createElement(BarList, { items: rp.junk.map(function(j, i) { return { label: j.label + '（' + j.count + ' 项）', value: j.bytes, color: '#e85d75' } }) }) : React.createElement('div', { className: 'dsk-muted' }, '未发现明显垃圾点'),
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
              )
            )
          ),
          React.createElement('div', { className: 'dsk-tip' }, '扫描时间 ' + (sm.scannedAt || '') + ' · 跳过明细：权限 ' + sm.skipped.permission + ' · 循环 ' + sm.skipped.cycle + ' · 系统保护 ' + sm.skipped.protected + ' · 排除 ' + sm.skipped.excluded + ' · 过深 ' + sm.skipped.deep)
        )
      } else if (rp && !rp.ok) {
        body = React.createElement('div', { className: 'dsk-tip' }, (rp && rp.error) || '尚未扫描')
      }

      let drillView = null
      if (st.drill && st.drill.ok) {
        const d = st.drill
        const parts = d.path.split(/[\\/]/).filter(Boolean)
        const crumb = React.createElement('div', { className: 'dsk-crumb' },
          React.createElement('a', { onClick: function() { set(function(s) { return Object.assign({}, s, { drill: null }) }) } }, '← 返回总览'),
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
        drillView = React.createElement('div', null,
          crumb,
          React.createElement('div', { className: 'dsk-sec' }, '子目录（' + d.dirs.length + '）'),
          React.createElement(BarList, { items: dirItems, onSelect: function(it) { drill(it.path) } }),
          React.createElement('div', { className: 'dsk-sec' }, '文件（Top ' + d.files.length + '）'),
          React.createElement('table', { className: 'dsk-files' },
            React.createElement('tbody', null,
              d.files.map(function(f, i) {
                return React.createElement('tr', { key: i },
                  React.createElement('td', null, f.name),
                  React.createElement('td', null, fmtBytes(f.bytes))
                )
              })
            )
          )
        )
      }

      return React.createElement('div', { className: 'dsk-panel' },
        header, progressBar, errorBox, body, drillView
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
