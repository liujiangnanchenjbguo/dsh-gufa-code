/**
 * 10-icons：内联 SVG 图标集与「古」印章 Logo。全部使用 currentColor / 品牌色，无外部资源。
 */
const ICON_PATHS = {
  close: [['path', { d: 'M5 5l14 14M19 5L5 19' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  minus: [['path', { d: 'M5 12h14' }]],
  refresh: [['path', { d: 'M20 11a8 8 0 1 0-.6 4.2M20 4v7h-7' }]],
  'arrow-up': [
    ['path', { d: 'M12 19V5' }],
    ['path', { d: 'M6 11l6-6 6 6' }],
  ],
  'arrow-down': [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M6 13l6 6 6-6' }],
  ],
  monitor: [
    ['rect', { x: 3, y: 4.5, width: 18, height: 12, rx: 2 }],
    ['path', { d: 'M9 20h6M12 16.5V20' }],
  ],
  graph: [
    ['circle', { cx: 6, cy: 6, r: 2.2 }],
    ['circle', { cx: 6, cy: 18, r: 2.2 }],
    ['circle', { cx: 18, cy: 12, r: 2.2 }],
    ['path', { d: 'M6 8.2v7.6M8.2 12h7.6' }],
  ],
  undo: [
    ['path', { d: 'M9 14L4 9l5-5' }],
    ['path', { d: 'M4 9h10a6 6 0 0 1 0 12h-4' }],
  ],
  'arrow-left': [['path', { d: 'M19 12H5M11 6l-6 6 6 6' }]],
  'arrow-right': [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  'chevron-right': [['path', { d: 'M9 5l7 7-7 7' }]],
  'chevron-down': [['path', { d: 'M5 9l7 7 7-7' }]],
  folder: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }]],
  'folder-open': [
    ['path', { d: 'M3 8V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1' }],
    ['path', { d: 'M3.5 10h17l-2.2 8.3a2 2 0 0 1-1.9 1.5H5.2a2 2 0 0 1-2-1.6L2.3 12a1.4 1.4 0 0 1 1.2-2z' }],
  ],
  file: [['path', { d: 'M6 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3z' }], ['path', { d: 'M14 3v5h5' }]],
  files: [
    ['path', { d: 'M8 3h7l4 4v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }],
    ['path', { d: 'M15 3v4h4M3 8v12a1 1 0 0 0 1 1h9' }, { opacity: 0.55 }],
  ],
  git: [
    ['circle', { cx: 6, cy: 6, r: 2.2 }],
    ['circle', { cx: 6, cy: 18, r: 2.2 }],
    ['circle', { cx: 18, cy: 8, r: 2.2 }],
    ['path', { d: 'M6 8.2v7.6M8.2 6h5.4a2.2 2.2 0 0 1 2.2 2.2v5.6' }],
  ],
  server: [
    ['rect', { x: 3, y: 4, width: 18, height: 6, rx: 1.6 }],
    ['rect', { x: 3, y: 14, width: 18, height: 6, rx: 1.6 }],
    ['path', { d: 'M7 7h.01M7 17h.01' }],
  ],
  terminal: [['path', { d: 'M4 6l6 6-6 6M13 18h7' }]],
  sparkles: [
    ['path', { d: 'M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z' }],
    ['path', { d: 'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z' }, { opacity: 0.8 }],
  ],
  send: [['path', { d: 'M4 12l16-7-6.5 16-2.3-6.6L4 12z' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.4 }]],
  trash: [
    ['path', { d: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }],
    ['path', { d: 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13' }],
  ],
  pencil: [['path', { d: 'M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z' }], ['path', { d: 'M14 5.5l3.5 3.5' }]],
  save: [
    ['path', { d: 'M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }],
    ['path', { d: 'M8 3v6h7V3M8 21v-7h8v7' }],
  ],
  gear: [
    ['circle', { cx: 12, cy: 12, r: 3.2 }],
    ['path', { d: 'M12 2.8l1 2.6 2.7.7 2-1.8 2.2 2.2-1.8 2 .7 2.7 2.6 1v3l-2.6 1-.7 2.7 1.8 2-2.2 2.2-2-1.8-2.7.7-1 2.6h-3l-1-2.6-2.7-.7-2 1.8-2.2-2.2 1.8-2-.7-2.7-2.6-1v-3l2.6-1 .7-2.7-1.8-2 2.2-2.2 2 1.8 2.7-.7 1-2.6h3z' }],
  ],
  code: [['path', { d: 'M8.5 6L3 12l5.5 6M15.5 6L21 12l-5.5 6' }]],
  replace: [
    ['rect', { x: 7, y: 4.5, width: 12.5, height: 15, rx: 2 }],
    ['path', { d: 'M3 12h9' }],
    ['path', { d: 'M9.5 9.5L12 12l-2.5 2.5' }],
  ],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'M16 16l4.5 4.5' }]],
  message: [['path', { d: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z' }]],
  'panel-right': [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M14 4v16' }]],
  'panel-left': [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M10 4v16' }]],
  keyboard: [
    ['rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2 }],
    ['path', { d: 'M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M8 16.5h8' }],
  ],
  branch: [
    ['circle', { cx: 7, cy: 5, r: 2.2 }],
    ['circle', { cx: 7, cy: 19, r: 2.2 }],
    ['circle', { cx: 17, cy: 8, r: 2.2 }],
    ['path', { d: 'M7 7.2v9.6M9.2 5h4.3a3.5 3.5 0 0 1 3.5 3.5v0' }],
  ],
  check: [['path', { d: 'M4.5 12.5l5 5 10-11' }]],
  warn: [['path', { d: 'M12 3l9.5 17H2.5L12 3z' }], ['path', { d: 'M12 9v5M12 17h.01' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 8h.01' }]],
  history: [['path', { d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V10h5.5' }], ['path', { d: 'M12 8v4.5l3 2' }]],
  plug: [['path', { d: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v3' }]],
  'chevron-up': [['path', { d: 'M5 15l7-7 7 7' }]],
  layout: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M9 4v16M3 10h6' }]],
  image: [
    ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.4 }],
    ['circle', { cx: 8.5, cy: 9.5, r: 1.6 }],
    ['path', { d: 'M4 17l5-4.5 3.5 3L16 12l4 4' }],
  ],
}

/** 通用图标：props = { name, size?, className? } */
G.Icon = function Icon(props) {
  const size = props.size ?? 16
  const shapes = ICON_PATHS[props.name] ?? ICON_PATHS.file
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.strokeWidth ?? 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: props.className,
      'aria-hidden': 'true',
      focusable: 'false',
      style: props.style,
    },
    shapes.map((shape, index) => h(shape[0], { key: index, ...shape[1] })),
  )
}

/** 「古」印章 Logo（品牌艺术色，非主题 token）。 */
G.Seal = function Seal(props) {
  const size = props.size ?? 24
  return h(
    'svg',
    { viewBox: '0 0 128 128', width: size, height: size, className: props.className, 'aria-hidden': 'true', focusable: 'false' },
    h(
      'defs',
      null,
      h(
        'linearGradient',
        { id: 'gufaSealGrad', x1: '0', y1: '0', x2: '1', y2: '1' },
        h('stop', { offset: '0', stopColor: '#d0573f' }),
        h('stop', { offset: '0.55', stopColor: '#b33a2c' }),
        h('stop', { offset: '1', stopColor: '#8c211b' }),
      ),
    ),
    h('rect', { x: 6, y: 6, width: 116, height: 116, rx: 28, fill: 'url(#gufaSealGrad)' }),
    h('rect', { x: 15, y: 15, width: 98, height: 98, rx: 21, fill: 'none', stroke: '#f7e9d8', strokeOpacity: 0.78, strokeWidth: 3.5 }),
    h(
      'g',
      { fill: '#fbeee0' },
      h('rect', { x: 32, y: 32, width: 64, height: 9.5, rx: 2.5 }),
      h('rect', { x: 58.5, y: 32, width: 11, height: 30, rx: 2 }),
      h('path', {
        fillRule: 'evenodd',
        d: 'M40 62 h48 a4 4 0 0 1 4 4 v27 a4 4 0 0 1 -4 4 h-48 a4 4 0 0 1 -4 -4 v-27 a4 4 0 0 1 4 -4 z m8 10 h32 v19 h-32 z',
      }),
    ),
    h('path', { d: 'M27 101 l-7 -6 7 -6', fill: 'none', stroke: '#f7e9d8', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.8 }),
    h('path', { d: 'M101 101 l7 -6 -7 -6', fill: 'none', stroke: '#f7e9d8', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.8 }),
  )
}

/**
 * 侧边栏 panel 图标（ownerProps: size, active）。
 * 点击直接进入古法编程覆盖层，并 stopPropagation 阻止侧边栏把主面板切到 main key
 * （否则官方会话会被卸载，无法停靠进 IDE 右侧）。
 */
G.PanelIcon = function PanelIcon(props) {
  const active = G.useMode()
  return h(
    'span',
    {
      className: 'gufa-panel-icon',
      title: G.t('panel.label'),
      role: 'img',
      'aria-label': G.t('panel.label'),
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', filter: active ? 'drop-shadow(0 0 5px color-mix(in srgb, #c0392b 55%, transparent))' : undefined },
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (G.mode.get()) G.mode.set(false)
        else G.enterGufa()
      },
    },
    h(G.Seal, { size: props.size ?? 20 }),
  )
}

/** 侧边栏底部动作：显示「古法编程」按钮（ownerProps: wide）。 */
G.FooterAction = function FooterAction(props) {
  const active = G.useMode()
  const click = () => {
    if (G.mode.get()) G.mode.set(false)
    else G.enterGufa()
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'gufa-footer-action',
      title: active ? G.t('app.exitHint') : G.t('panel.enterHint'),
      'aria-label': G.t('panel.label'),
      'data-active': active ? '' : undefined,
      onClick: click,
    },
    h(G.Seal, { size: 18 }),
    props.wide === false ? null : h('span', { className: 'gufa-footer-action-label' }, active ? G.t('app.exit') : G.t('panel.label')),
  )
}
