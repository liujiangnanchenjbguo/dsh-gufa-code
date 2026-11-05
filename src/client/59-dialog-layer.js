/**
 * 59-dialog-layer：外部门户弹窗（DSH 官方设置等）打开时，把古法编程的会话停靠层降到弹窗之下。
 *
 * 背景：官方 dialog 通过 createPortal 挂到 document.body（`role="dialog" aria-modal="true"`），
 * 而停靠的官方会话根节点被 inline 设了 z-index 2147483040，会盖住弹窗右侧、导致关闭按钮点不到。
 * 这里只观察「外部 dialog」，不是我们自己的弹窗（在 `.gufa-root` 内），开关 html 属性给 CSS 用。
 */

G.installDialogLayerWatch = function installDialogLayerWatch(ctx) {
  if (typeof document === 'undefined') return () => {}
  const ATTR = 'data-gufa-external-modal'

  const isExternalDialog = (el) => {
    if (!(el instanceof Element) || typeof el.closest !== 'function') return false
    if (el.getAttribute('role') !== 'dialog' || el.getAttribute('aria-modal') !== 'true') return false
    return el.closest('.gufa-root') === null
  }

  const sync = () => {
    try {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      let open = false
      for (const dialog of dialogs) {
        if (isExternalDialog(dialog)) {
          open = true
          break
        }
      }
      if (document.documentElement.getAttribute(ATTR) === (open ? '1' : null)) return
      if (open) document.documentElement.setAttribute(ATTR, '1')
      else document.documentElement.removeAttribute(ATTR)
    } catch {
      /* ignore */
    }
  }

  let observer = null
  try {
    observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal'],
    })
  } catch {
    observer = null
  }
  sync()
  /* 兜底：某些弹窗只是切换 display（不触发 mutation attributes），低频轮询成本很低 */
  const timer = window.setInterval(sync, 500)
  return () => {
    if (observer !== null) observer.disconnect()
    window.clearInterval(timer)
    document.documentElement.removeAttribute(ATTR)
  }
}
