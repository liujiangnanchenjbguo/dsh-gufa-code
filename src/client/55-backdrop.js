/**
 * 55-backdrop：把「梁圣」皮肤（@leon___/dsh-client-liang-intensity-skin）的背景图渐变
 * 复刻到古法编程覆盖层里。
 *
 * 皮肤的做法（见其 client.js）：
 *   - 在中心列挂一个 `.liang-skin-backdrop`，背景 = `var(--liang-page)`；
 *   - 内部放一个 `<img class="liang-skin-sequence-frame">`，src 指向皮肤 assets 里的人像
 *     （按强度档位切换 stage-XX.webp），右侧 `min(42vw,720px)`、`object-fit:cover`，
 *     并用 `mask-image: linear-gradient(90deg, transparent → black)` 做「左透明→右实」的渐变；
 *   - 透明度由 `--liang-portrait-opacity` 控制，可选 `data-mask="on"` 时再叠一层渐变遮罩。
 *
 * 古法编程是 `shell.overlay` 覆盖层，会盖住皮肤背景。本模块读取皮肤当前的背景节点/人像/透明度/
 * 遮罩状态，在覆盖层里用同样的渐变规则重建一份背景，让 IDE 也能看到同一张背景图与渐变，
 * 并通过标题栏的「背景」按钮随时开关（偏好持久化）。
 *
 * 皮肤关闭 / 找不到背景节点时不渲染（IDE 保持纯净实色）。
 */

/** 背景开关偏好（'0' = 关闭）。 */
const GUFA_BACKDROP_PREF_KEY = 'gufa-code:backdrop:v1'

G.backdropPref = {
  get() {
    try {
      return localStorage.getItem(GUFA_BACKDROP_PREF_KEY) !== '0'
    } catch {
      return true
    }
  },
  set(value) {
    try {
      localStorage.setItem(GUFA_BACKDROP_PREF_KEY, value === true ? '1' : '0')
    } catch {
      /* 隐私模式忽略 */
    }
  },
}

/** 背景浓度偏好：null = 跟随皮肤自身的透明度；数字 = 0–100 的独立无级浓度。 */
const GUFA_BACKDROP_STRENGTH_KEY = 'gufa-code:backdrop-strength:v1'

G.backdropStrengthPref = {
  get() {
    try {
      const raw = localStorage.getItem(GUFA_BACKDROP_STRENGTH_KEY)
      if (raw === null || raw === '') return null
      const value = Number.parseFloat(raw)
      return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
    } catch {
      return null
    }
  },
  set(value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(GUFA_BACKDROP_STRENGTH_KEY)
      else localStorage.setItem(GUFA_BACKDROP_STRENGTH_KEY, String(Math.max(0, Math.min(100, Number(value)))))
    } catch {
      /* 隐私模式忽略 */
    }
  },
}

/** 滑动变祖皮肤的偏好存储（皮肤源码里的常量），用于开启「31 档细分」。 */
const SKIN_SETTINGS_KEY = 'dsh-liang-intensity-skin.settings.v1'
const SKIN_SETTINGS_MARKER = 'gufa-code:skin-fine-stops:v1'
const SKIN_DEFAULT_VALUES = Object.freeze({
  bindEffort: true,
  maskEnabled: true,
  xianxiaPortraits: false,
  particlesEnabled: false,
  motionEnabled: false,
  fineStopsEnabled: false,
  hideSlider: false,
})

/**
 * 开启滑动变祖皮肤的「31 档细分」（fineStopsEnabled）。
 *
 * 皮肤默认行为：绑定思考等级时，松手会把**外观滑块**吸附到模型真实推理档位
 * （5 档就是 0/7.5/15/22.5/30），所以进度条和背景会「弹」到档位上。
 * 打开 31 档细分后：外观可停在 0–30 的任意整数级（松手只吸附到最近整数级），
 * 进度条与背景停在松手位置，模型仍提交最近的真实推理档位 —— 正是想要的行为。
 *
 * 只干预一次（写 marker，之后用户在皮肤设置里再关掉不会被反复打开）；
 * 写入后派发 StorageEvent，让皮肤的内存 store 立即生效，无需刷新。
 * @returns {{applied:boolean, reason?:string}}
 */
G.ensureSkinFineStops = function ensureSkinFineStops() {
  try {
    if (localStorage.getItem(SKIN_SETTINGS_MARKER) === '1') return { applied: false, reason: 'marked' }
    let record = null
    try {
      const raw = localStorage.getItem(SKIN_SETTINGS_KEY)
      record = raw === null ? null : JSON.parse(raw)
    } catch {
      record = null
    }
    const versioned = record !== null && typeof record === 'object' && record.version === 1 && record.values !== null && typeof record.values === 'object'
    const legacyBind = localStorage.getItem('dsh-liang-intensity-skin.bind-effort') !== '0'
    const legacyMask = localStorage.getItem('dsh-liang-intensity-skin.mask') !== '0'
    const values = versioned
      ? { ...SKIN_DEFAULT_VALUES, ...record.values }
      : { ...SKIN_DEFAULT_VALUES, bindEffort: legacyBind, maskEnabled: legacyMask }
    localStorage.setItem(SKIN_SETTINGS_MARKER, '1')
    if (values.fineStopsEnabled === true) return { applied: false, reason: 'already-enabled' }
    values.fineStopsEnabled = true
    const payload = JSON.stringify({ version: 1, values })
    const previous = localStorage.getItem(SKIN_SETTINGS_KEY)
    localStorage.setItem(SKIN_SETTINGS_KEY, payload)
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof StorageEvent === 'function') {
        window.dispatchEvent(new StorageEvent('storage', {
          key: SKIN_SETTINGS_KEY,
          oldValue: previous,
          newValue: payload,
          storageArea: localStorage,
        }))
      }
    } catch (error) {
      console.error('[gufa-code] 通知皮肤设置失败（刷新后仍会生效）', error)
    }
    return { applied: true }
  } catch (error) {
    return { applied: false, reason: String(error) }
  }
}

/** 读取当前「31 档细分」是否开启（诊断探针用）。 */
G.readSkinFineStops = function readSkinFineStops() {
  try {
    const raw = localStorage.getItem(SKIN_SETTINGS_KEY)
    const record = raw === null ? null : JSON.parse(raw)
    return record !== null && typeof record === 'object' && record.values !== null && typeof record.values === 'object' && record.values.fineStopsEnabled === true
  } catch {
    return false
  }
}

/** 解析 transform 矩阵里的缩放（取 a 分量；非矩阵时返回 1）。 */
function gufaTransformScale(transform) {
  if (typeof transform !== 'string' || transform === '' || transform === 'none') return 1
  const matrix = /matrix\(([^)]+)\)/.exec(transform)
  if (matrix === null) return 1
  const parts = matrix[1].split(',').map((part) => Number.parseFloat(part))
  return parts.length >= 4 && Number.isFinite(parts[0]) && parts[0] > 0 ? parts[0] : 1
}

/**
 * 读取当前皮肤背景状态。纯 DOM 读取，不修改皮肤节点。
 * @returns {{available:boolean, pageColor?:string, pageImage?:string, portraitSrc?:string, portraitOpacity?:number, portraitScale?:number, mask?:boolean, media?:string}}
 */
G.readSkinBackdropMeta = function readSkinBackdropMeta() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return { available: false }
  const body = document.body
  if (body === null || body === undefined || typeof body.hasAttribute !== 'function') return { available: false }
  if (!body.hasAttribute('data-liang-skin')) return { available: false }
  if (typeof document.querySelector !== 'function') return { available: false }
  const node = document.querySelector('.liang-skin-backdrop')
  if (node === null || node === undefined) return { available: false }
  let style
  try {
    style = window.getComputedStyle(node)
  } catch {
    return { available: false }
  }
  const pageColor = style.backgroundColor !== '' && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : ''
  const pageImage = style.backgroundImage !== 'none' && style.backgroundImage !== '' ? style.backgroundImage : ''
  const img = typeof node.querySelector === 'function' ? node.querySelector('img') : null
  let portraitSrc = ''
  let portraitOpacity = 1
  let portraitScale = 1
  if (img !== null && img !== undefined) {
    portraitSrc = img.currentSrc || img.src || ''
    try {
      const imgStyle = window.getComputedStyle(img)
      if (imgStyle.display === 'none') portraitSrc = ''
      const opacity = Number.parseFloat(imgStyle.opacity)
      if (Number.isFinite(opacity)) portraitOpacity = Math.max(0, Math.min(1, opacity))
      portraitScale = Math.max(0.1, Math.min(3, gufaTransformScale(imgStyle.transform)))
    } catch {
      /* 忽略样式读取失败 */
    }
  }
  return {
    available: true,
    pageColor,
    pageImage,
    portraitSrc,
    portraitOpacity,
    portraitScale,
    mask: typeof node.getAttribute === 'function' && node.getAttribute('data-mask') === 'on',
    media: (typeof node.getAttribute === 'function' && node.getAttribute('data-media')) || 'color',
  }
}

/**
 * 订阅皮肤背景状态：皮肤强度变化会换人像、改透明度，这里每 1.5s 轮询一次并在变化时重渲染。
 * @returns {ReturnType<typeof G.readSkinBackdropMeta>}
 */
G.useSkinBackdrop = function useSkinBackdrop() {
  const [meta, setMeta] = useState(() => G.readSkinBackdropMeta())
  useEffect(() => {
    let disposed = false
    const sync = () => {
      if (disposed) return
      const next = G.readSkinBackdropMeta()
      setMeta((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
    }
    sync()
    const timer = window.setInterval(sync, 350)
    window.addEventListener('resize', sync)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return meta
}

/**
 * 背景层：页面底色 + 右侧人像（带左→右渐变遮罩）+ 可选遮罩。
 * 同时注册一个空 overlay 探针（`gufa-code-backdrop-live-<state>`），便于 Client Inspect
 * 验证「背景层已挂载 / 人像已加载」，无需截图。
 */
G.SkinBackdrop = function SkinBackdrop(props) {
  const meta = props.meta
  const [imgState, setImgState] = useState('pending')
  const [layers, setLayers] = useState(() => ({
    current: meta !== null && meta !== undefined && meta.available === true && typeof meta.portraitSrc === 'string' ? meta.portraitSrc : '',
    previous: '',
  }))
  const enabled = props.enabled !== false
  const active = meta !== null && meta !== undefined && meta.available === true && enabled === true
  const portraitSrc = active && typeof meta.portraitSrc === 'string' ? meta.portraitSrc : ''

  // 人像源变化（皮肤换档）时保留旧图层做交叉淡出，避免硬切
  useEffect(() => {
    setLayers((previous) => (previous.current === portraitSrc ? previous : { current: portraitSrc, previous: previous.current }))
  }, [portraitSrc])
  useEffect(() => {
    if (layers.previous === '') return undefined
    const timer = window.setTimeout(() => setLayers((previous) => (previous.previous === '' ? previous : { ...previous, previous: '' })), 520)
    return () => window.clearTimeout(timer)
  }, [layers.previous])
  useEffect(() => {
    if (!active) return undefined
    if (G.ctx === null || G.ctx === undefined || typeof G.ctx.inject !== 'function') return undefined
    const state = imgState === 'ok' ? 'img-ok' : imgState === 'fail' ? 'img-fail' : meta.portraitSrc ? 'img-loading' : 'color-only'
    let dispose = () => {}
    let disposeScope
    try {
      disposeScope = G.ctx.inject(['slots'], (scope) => {
        try {
          const removal = scope.slots.register({ name: 'shell.overlay', id: `gufa-code-backdrop-live-${state}`, order: 996 }, () => null)
          dispose = typeof removal === 'function' ? removal : () => {}
        } catch (error) {
          console.error('[gufa-code] 注册背景探针失败', error)
        }
      })
    } catch (error) {
      console.error('[gufa-code] 注入背景探针失败', error)
      return undefined
    }
    return () => {
      try {
        dispose()
      } catch {
        /* ignore */
      }
      try {
        disposeScope?.()
      } catch {
        /* ignore */
      }
    }
  }, [active, imgState, meta])
  if (!active) return null
  const pageStyle = {}
  if (typeof meta.pageColor === 'string' && meta.pageColor !== '') pageStyle.backgroundColor = meta.pageColor
  if (typeof meta.pageImage === 'string' && meta.pageImage !== '') pageStyle.backgroundImage = meta.pageImage
  pageStyle.backgroundSize = 'cover'
  pageStyle.backgroundPosition = 'center'
  // 浓度：用户拖动过滑杆就用无级值，否则跟随皮肤自身透明度
  const strength = typeof props.strength === 'number' && Number.isFinite(props.strength)
    ? Math.max(0, Math.min(1, props.strength / 100))
    : Math.max(0, Math.min(1, meta.portraitOpacity))
  const portraitStyle = {
    opacity: strength,
    transform: `translateY(-50%) scale(${meta.portraitScale})`,
  }
  const leavingStyle = {
    opacity: 0,
    transform: `translateY(-50%) scale(${meta.portraitScale})`,
  }
  return h(
    'div',
    { className: 'gufa-backdrop', 'aria-hidden': 'true' },
    h('div', { className: 'gufa-backdrop-page', style: pageStyle }),
    h('div', { className: 'gufa-backdrop-glow', 'aria-hidden': 'true' }),
    layers.previous !== ''
      ? h('img', { key: `prev:${layers.previous}`, className: 'gufa-backdrop-portrait', src: layers.previous, alt: '', draggable: false, style: leavingStyle, 'data-leaving': '' })
      : null,
    layers.current !== ''
      ? h('img', {
          key: `cur:${layers.current}`,
          className: 'gufa-backdrop-portrait',
          src: layers.current,
          alt: '',
          draggable: false,
          style: portraitStyle,
          onLoad: () => setImgState('ok'),
          onError: () => setImgState('fail'),
        })
      : null,
    h('div', { className: 'gufa-backdrop-fade' }),
    meta.mask === true ? h('div', { className: 'gufa-backdrop-scrim' }) : null,
    h(G.BackdropParticles, { strength }),
  )
}

/**
 * 背景粒子层：按「滑动变祖」原版粒子参数复刻（小颗粒、数量多、加色发光、从右下方涌向人像）。
 * 原版用 WebGL 点精灵 + 加色混合；这里用 2D canvas + 预渲染光点 sprite + 'lighter' 混合近似，
 * 性能足够（每帧 drawImage，30fps）。
 */
G.BackdropParticles = function BackdropParticles(props) {
  const canvasRef = useRef(null)
  const strengthRaw = typeof props.strength === 'number' && Number.isFinite(props.strength) ? props.strength : 1
  const strength = Math.max(0, Math.min(1, strengthRaw))
  /* 摸鱼窗口里背景层是被 CSS 隐藏的：完全不要创建 canvas / 跑动画，省 CPU 与内存 */
  const skipFloat = typeof G.isFloatMode === 'function' && G.isFloatMode() === true
  useEffect(() => {
    if (skipFloat) return undefined
    const canvas = canvasRef.current
    if (canvas === null || canvas === undefined) return undefined
    const context = canvas.getContext('2d')
    if (context === null || context === undefined) return undefined
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      reduced = false
    }
    if (reduced) return undefined

    const dpr = Math.min(1.25, window.devicePixelRatio || 1)
    let width = 0
    let height = 0
    const resize = () => {
      width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      canvas.width = width
      canvas.height = height
      sprite = makeSprite()
      for (const particle of particles) spawn(particle, true)
    }

    /* 预渲染光点 sprite（暖金色核心 + 外圈微光） */
    let sprite = null
    const makeSprite = () => {
      const size = 64
      const off = document.createElement('canvas')
      off.width = size
      off.height = size
      const ctx = off.getContext('2d')
      if (ctx === null) return null
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      gradient.addColorStop(0, 'rgba(255,241,214,1)')
      gradient.addColorStop(0.25, 'rgba(240,196,120,0.85)')
      gradient.addColorStop(0.55, 'rgba(210,150,80,0.35)')
      gradient.addColorStop(1, 'rgba(150,90,50,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
      return off
    }

    const TAU = Math.PI * 2
    /* 与皮肤原版一致的群体参数：数量随「背景浓度」放大，尺寸 2~5.2 CSS px，寿命 3~7s */
    const activeCount = Math.round(300 + strength * 720)
    const anchorX = 0.58
    const anchorY = 0.92
    const targetX = 0.5
    const targetY = 0.4
    const particles = Array.from({ length: activeCount }, () => ({ x: 0, y: 0, vx: 0, vy: 0, size: 0, life: 0, maxLife: 1, phase: 0 }))
    const clamp01 = (value) => Math.max(0, Math.min(1, value))
    const spawn = (particle, randomLife) => {
      const spread = width * 0.05
      particle.x = anchorX * width + (Math.random() - 0.5) * spread * 2
      particle.y = anchorY * height + (Math.random() - 0.5) * spread * 1.4
      particle.vx = (Math.random() - 0.5) * 90 * dpr
      particle.vy = (-30 - Math.random() * 110) * dpr
      particle.maxLife = 3 + Math.random() * 4
      particle.life = randomLife ? Math.random() * particle.maxLife : 0
      particle.size = (2 + Math.random() * 3.2) * dpr
      particle.phase = Math.random() * TAU
    }
    for (const particle of particles) spawn(particle, true)

    const pointer = { x: -1e4, y: -1e4, down: false }
    let last = 0
    let raf = 0
    let paused = document.visibilityState === 'hidden'
    const tick = (now) => {
      if (paused) { raf = 0; return }
      raf = window.requestAnimationFrame(tick)
      if (now - last < 40) return
      const dt = Math.min(0.048, (last === 0 ? 0.016 : (now - last) / 1000))
      last = now
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      const levelFactor = 0.45 + 0.55 * strength
      for (const particle of particles) {
        particle.life += dt
        if (particle.life > particle.maxLife) spawn(particle, false)
        const curl = Math.sin(particle.y * 0.0016 + now * 0.00025 + particle.phase)
        particle.vx += curl * width * 0.02 * dt + (Math.random() - 0.5) * width * 0.05 * dt
        particle.vy -= height * 0.008 * dt
        particle.vy += (Math.random() - 0.5) * height * 0.03 * dt
        const dxp = pointer.x - particle.x
        const dyp = pointer.y - particle.y
        const distance = Math.hypot(dxp, dyp)
        if (pointer.x > -1e3 && distance < width * 0.34 && distance > 0.001) {
          const falloff = 1 - distance / (width * 0.34)
          const sign = pointer.down === true ? -1 : 1
          particle.vx -= (dxp / distance) * falloff * 900 * dt * sign
          particle.vy -= (dyp / distance) * falloff * 900 * dt * sign
        }
        const toX = targetX * width - particle.x
        const toY = targetY * height - particle.y
        const toDistance = Math.hypot(toX, toY) || 1
        const pull = 60 * dt * levelFactor * dpr
        particle.vx += (toX / toDistance) * pull
        particle.vy += (toY / toDistance) * pull
        const damping = Math.max(0, 1 - 0.8 * dt)
        particle.vx *= damping
        particle.vy *= damping
        particle.x += particle.vx * dt
        particle.y += particle.vy * dt
        if (particle.y < -height * 0.15 || particle.x < -width * 0.1 || particle.x > width * 1.1) spawn(particle, false)
        const lifeRatio = particle.life / particle.maxLife
        const fade = Math.min(1, lifeRatio / 0.18) * Math.pow(Math.sin(Math.PI * clamp01(lifeRatio)), 0.7)
        const twinkle = 0.55 + 0.45 * Math.sin(particle.phase + now * 0.0016)
        const alpha = Math.max(0, Math.min(1, (0.3 + 0.42 * levelFactor) * twinkle * fade))
        if (alpha <= 0.01 || sprite === null) continue
        const size = particle.size * (0.8 + 0.4 * levelFactor)
        context.globalAlpha = alpha * 0.9
        context.drawImage(sprite, particle.x - size * 1.6, particle.y - size * 1.6, size * 3.2, size * 3.2)
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
    }
    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = (event.clientX - rect.left) * dpr
      pointer.y = (event.clientY - rect.top) * dpr
    }
    const onPointerLeave = () => {
      pointer.x = -1e4
      pointer.y = -1e4
    }
    const onPointerDown = () => { pointer.down = true }
    const onPointerUp = () => { pointer.down = false }
    const resume = () => {
      paused = false
      last = 0
      if (raf === 0) raf = window.requestAnimationFrame(tick)
    }
    const pause = () => {
      paused = true
      if (raf !== 0) { window.cancelAnimationFrame(raf); raf = 0 }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') pause(); else resume() }
    const onBlur = () => pause()
    const onFocus = () => resume()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('resize', resize)
    resize()
    if (!paused) raf = window.requestAnimationFrame(tick)
    try {
      void G.api('dev.log', { message: `particles-start count=${activeCount} size=2-5.2css dpr=${dpr} canvas=${width}x${height}` }).catch(() => {})
    } catch {
      /* ignore */
    }
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('resize', resize)
    }
  }, [strength, skipFloat])
  if (skipFloat) return null
  return h('canvas', { ref: canvasRef, className: 'gufa-backdrop-particles', 'aria-hidden': 'true', style: { mixBlendMode: 'screen' } })
}

/** 背景浓度滑杆（无级、连续；双击恢复「跟随皮肤」）。 */
G.BackdropStrengthSlider = function BackdropStrengthSlider(props) {
  const t = G.useT()
  const raw = typeof props.value === 'number' && Number.isFinite(props.value) ? props.value : 100
  const value = Math.max(0, Math.min(100, Math.round(raw)))
  return h(
    'label',
    { className: 'gufa-strength', title: `${t('app.backdropStrength')} — ${t('app.backdropStrengthHint')}` },
    h(G.Icon, { name: 'image', size: 12 }),
    h('input', {
      className: 'gufa-strength-range',
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value,
      'aria-label': t('app.backdropStrength'),
      onChange: (event) => props.onChange?.(Number(event.target.value)),
      onDoubleClick: () => props.onReset?.(),
    }),
    h('span', { className: 'gufa-strength-value' }, `${value}%`),
  )
}

/** 纯函数暴露（测试/控制台排查）。 */
G.__backdrop = { read: G.readSkinBackdropMeta }
