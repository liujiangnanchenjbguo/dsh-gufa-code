/**
 * 46-gitgraph：Git Graph 视图（类似 Cursor / Git Graph 扩展的提交图）。
 * 以编辑器标签页的形式打开；纯前端计算泳道布局，Host 只提供 git log 数据。
 */

/** 泳道颜色（跟随强调色，深浅主题都可读）。 */
const GUFA_GRAPH_COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#7f9cf5']

/**
 * 计算提交图泳道布局（纯函数，供测试）。
 * @param {Array<{hash:string, parents:string[]}>} commits 新→旧
 * @returns {{rows: Array<object>, laneCount: number, hashRow: Map<string, number>}}
 */
G.gitGraphLayout = function gitGraphLayout(commits) {
  const lanes = []
  const rows = []
  const hashRow = new Map()
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) {
      const free = lanes.indexOf(null)
      lane = free === -1 ? lanes.length : free
      lanes[lane] = commit.hash
    }
    rows.push({ commit, lane, lanesBefore: lanes.slice() })
    hashRow.set(commit.hash, rows.length - 1)
    lanes[lane] = commit.parents.length > 0 ? commit.parents[0] : null
    let insertAt = lane + 1
    for (const parent of commit.parents.slice(1)) {
      if (lanes.indexOf(parent) === -1) {
        lanes.splice(insertAt, 0, parent)
        insertAt += 1
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
  }
  for (let index = 0; index < rows.length; index += 1) {
    rows[index].lanesAfter = index + 1 < rows.length ? rows[index + 1].lanesBefore.slice() : []
  }
  let laneCount = 1
  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1, row.lanesBefore.length, row.lanesAfter.length)
  }
  return { rows, laneCount, hashRow }
}

/** 提交行（含泳道 SVG）。 */
function gufaGraphRow(props) {
  const t = G.useT()
  const row = props.row
  const laneWidth = 14
  const rowHeight = 26
  const width = Math.max(laneWidth, props.laneCount * laneWidth)
  const cx = (lane) => lane * laneWidth + laneWidth / 2
  const cy = rowHeight / 2
  const color = (lane) => GUFA_GRAPH_COLORS[lane % GUFA_GRAPH_COLORS.length]
  const elements = []
  // 上方泳道竖线
  for (let lane = 0; lane < row.lanesBefore.length; lane += 1) {
    if (row.lanesBefore[lane] === null || row.lanesBefore[lane] === undefined) continue
    elements.push(h('line', { key: `b:${lane}`, x1: cx(lane), y1: 0, x2: cx(lane), y2: cy, stroke: color(lane), strokeWidth: 1.6, opacity: 0.85 }))
  }
  // 下方泳道竖线
  for (let lane = 0; lane < row.lanesAfter.length; lane += 1) {
    if (row.lanesAfter[lane] === null || row.lanesAfter[lane] === undefined) continue
    elements.push(h('line', { key: `a:${lane}`, x1: cx(lane), y1: cy, x2: cx(lane), y2: rowHeight, stroke: color(lane), strokeWidth: 1.6, opacity: 0.85 }))
  }
  // 提交 → 父提交连线
  const parents = row.commit.parents ?? []
  parents.forEach((parent, index) => {
    let targetLane = -1
    const targetRow = props.hashRow.get(parent)
    if (targetRow !== undefined) targetLane = props.rows[targetRow].lane
    else targetLane = row.lanesAfter.indexOf(parent)
    if (targetLane === -1) targetLane = row.lane
    if (targetLane === row.lane) return
    const x1 = cx(row.lane)
    const x2 = cx(targetLane)
    elements.push(
      h('path', {
        key: `p:${index}`,
        d: `M ${x1} ${cy} C ${x1} ${cy + 10}, ${x2} ${cy + 8}, ${x2} ${rowHeight}`,
        fill: 'none',
        stroke: color(targetLane),
        strokeWidth: 1.6,
        opacity: 0.9,
      }),
    )
  })
  // 提交节点
  elements.push(h('circle', { key: 'dot', cx: cx(row.lane), cy, r: 3.6, fill: color(row.lane), stroke: 'var(--gufa-bg, #111)', strokeWidth: 1.2 }))
  return h(
    'div',
    {
      className: 'gufa-graph-row',
      'data-selected': props.selected === true ? '' : undefined,
      onClick: () => props.onSelect(row.commit),
      title: row.commit.subject,
    },
    h('span', { className: 'gufa-graph-svg', style: { width, minWidth: width } }, h('svg', { width, height: rowHeight }, ...elements)),
    h('span', { className: 'gufa-graph-refs' }, ...(row.commit.refs ?? []).slice(0, 3).map((ref) => {
      const current = ref.startsWith('HEAD -> ')
      const clean = current ? ref.slice('HEAD -> '.length) : ref
      return h('span', { key: ref, className: 'gufa-graph-ref', 'data-current': current || clean === props.branch ? '' : undefined }, current ? `HEAD -> ${clean}` : clean)
    })),
    h('span', { className: 'gufa-graph-subject' }, row.commit.subject),
    h('span', { className: 'gufa-graph-meta' }, row.commit.author),
    h('span', { className: 'gufa-graph-meta' }, row.commit.when),
  )
}

G.GitGraphView = function GitGraphView(props) {
  const t = G.useT()
  const root = typeof props.root === 'string' && props.root !== '' ? props.root : null
  const [state, setState] = useState({ status: 'loading', commits: [], branch: '', error: '' })
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState({ status: 'idle', files: [], error: '' })
  const [showAll, setShowAll] = useState(true)
  const [copyTip, setCopyTip] = useState('')

  useEffect(() => {
    if (root === null) {
      setState({ status: 'ready', commits: [], branch: '', error: '' })
      return undefined
    }
    let cancelled = false
    setState((current) => ({ ...current, status: current.commits.length === 0 ? 'loading' : 'refreshing', error: '' }))
    void G.api('git.graph', { root, all: showAll })
      .then((value) => {
        if (cancelled) return
        setState({
          status: 'ready',
          commits: Array.isArray(value?.commits) ? value.commits : [],
          branch: typeof value?.branch === 'string' ? value.branch : '',
          error: typeof value?.error === 'string' ? value.error : '',
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({ status: 'error', commits: [], branch: '', error: G.errorText(error) })
      })
    return () => {
      cancelled = true
    }
  }, [root, props.refreshToken, showAll])

  /* 选中提交后拉取改动文件列表 */
  useEffect(() => {
    if (root === null || selected === null) {
      setDetail({ status: 'idle', files: [], error: '' })
      return undefined
    }
    let cancelled = false
    setDetail({ status: 'loading', files: [], error: '' })
    void G.api('git.commitFiles', { root, hash: selected.hash })
      .then((value) => {
        if (cancelled) return
        setDetail({ status: 'ready', files: Array.isArray(value?.files) ? value.files : [], error: '' })
      })
      .catch((error) => {
        if (cancelled) return
        setDetail({ status: 'error', files: [], error: G.errorText(error) })
      })
    return () => {
      cancelled = true
    }
  }, [root, selected])

  const layout = useMemo(() => G.gitGraphLayout(state.commits), [state.commits])

  const copyHash = (hash) => {
    try {
      void navigator.clipboard?.writeText(hash)
      setCopyTip(t('graph.copied'))
      window.setTimeout(() => setCopyTip(''), 1500)
    } catch {
      /* ignore */
    }
  }

  const header = h(
    'div',
    { className: 'gufa-graph-head' },
    h(G.Icon, { name: 'graph', size: 14 }),
    h('span', { className: 'gufa-panel-head-title' }, t('graph.title')),
    state.branch !== '' ? h('span', { className: 'gufa-graph-branch' }, h(G.Icon, { name: 'branch', size: 12 }), state.branch) : null,
    h('div', { style: { flex: '1 1 auto' } }),
    copyTip !== '' ? h('span', { className: 'gufa-hint' }, copyTip) : null,
    h(G.Button, { icon: 'branch', title: t('graph.toggleAll'), onClick: () => setShowAll((value) => value !== true) }, showAll === true ? t('graph.allBranches') : t('graph.currentBranch')),
    h(G.IconButton, { title: t('graph.refresh'), onClick: () => props.onRefresh?.() }, h(G.Icon, { name: 'refresh', size: 13 })),
  )

  if (root === null) {
    return h('div', { className: 'gufa-graph-view' }, header, h(G.Empty, { icon: 'branch', title: t('graph.noProject') }))
  }
  if (state.status === 'loading') {
    return h('div', { className: 'gufa-graph-view' }, header, h('div', { className: 'gufa-graph-loading' }, h(G.Spinner), t('common.loading')))
  }
  if (state.error !== '') {
    return h('div', { className: 'gufa-graph-view' }, header, h('div', { className: 'gufa-error-banner', style: { margin: 10 } }, state.error))
  }
  if (state.commits.length === 0) {
    return h('div', { className: 'gufa-graph-view' }, header, h(G.Empty, { icon: 'branch', title: t('graph.noCommits') }))
  }

  const aside = selected === null
    ? h('div', { className: 'gufa-graph-aside gufa-graph-aside-empty' }, t('graph.selectCommitHint'))
    : h(
        'div',
        { className: 'gufa-graph-aside' },
        h(
          'div',
          { className: 'gufa-graph-commit' },
          h('div', { className: 'gufa-graph-commit-subject' }, selected.subject),
          h('div', { className: 'gufa-graph-commit-meta' }, h('code', null, selected.short), h('span', null, selected.author), h('span', null, selected.when)),
          h(
            'div',
            { className: 'gufa-graph-commit-actions' },
            h(G.Button, { icon: 'files', onClick: () => copyHash(selected.hash) }, t('graph.copyHash')),
            selected.refs !== null && selected.refs !== undefined && selected.refs.length > 0
              ? h('span', { className: 'gufa-graph-refs' }, ...selected.refs.slice(0, 4).map((ref) => h('span', { key: ref, className: 'gufa-graph-ref' }, ref)))
              : null,
          ),
        ),
        h('div', { className: 'gufa-graph-files-head' }, t('graph.changedFiles'), detail.status === 'ready' ? h('span', { className: 'gufa-graph-files-count' }, String(detail.files.length)) : null),
        detail.status === 'loading'
          ? h('div', { className: 'gufa-graph-loading', style: { height: 80 } }, h(G.Spinner), t('common.loading'))
          : detail.status === 'error'
            ? h('div', { className: 'gufa-error-banner', style: { margin: 8 } }, detail.error)
            : detail.files.length === 0
              ? h('div', { className: 'gufa-hint', style: { padding: '8px 12px' } }, t('graph.noChangedFiles'))
              : h(
                  'div',
                  { className: 'gufa-graph-files' },
                  ...detail.files.map((file) =>
                    h(
                      'button',
                      {
                        key: `${file.status}:${file.path}`,
                        type: 'button',
                        className: 'gufa-graph-file',
                        title: t('graph.openFileDiff'),
                        onClick: () => props.onOpenCommitFile?.(selected, file),
                      },
                      h('span', { className: 'gufa-graph-file-status', 'data-kind': file.status }, file.status),
                      h('span', { className: 'gufa-graph-file-path' }, file.path),
                    ),
                  ),
                ),
      )

  return h(
    'div',
    { className: 'gufa-graph-view' },
    header,
    h(
      'div',
      { className: 'gufa-graph-split' },
      h(
        'div',
        { className: 'gufa-graph-body gufa-scroll' },
        ...layout.rows.map((row) =>
          h(gufaGraphRow, {
            key: row.commit.hash,
            row,
            rows: layout.rows,
            hashRow: layout.hashRow,
            laneCount: layout.laneCount,
            branch: state.branch,
            selected: selected !== null && selected.hash === row.commit.hash,
            onSelect: (commit) => setSelected(commit),
          }),
        ),
      ),
      aside,
    ),
  )
}
