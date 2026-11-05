/**
 * 59-popup-layer：弹窗/菜单层级修正。
 *
 * 背景（踩坑记录，见 docs/KNOWN-PITFALLS.md）：
 * 古法编程的界面都在 `.gufa-overlay-root`（z-index:1）这个层叠上下文里，而右侧停靠的
 * 官方会话根节点是 body 级 fixed、z-index 2147483040。任何在 root 内部弹出的
 * modal / menu / popover，如果只设自己的 z-index，都会被困在 root 的上下文里，
 * 被停靠会话盖住（表现为「弹窗被右侧聊天挡一半、点不到关闭」）。
 *
 * 修法：检测 root 内是否出现 popup，出现时给 html 加 `data-gufa-popup`，
 * 由 CSS 把整个 overlay root 临时抬到停靠会话之上。
 */

G.installPopupLayerWatch = function installPopupLayerWatch(ctx) {
  if (typeof document === 'undefined') return () => {}
  const ATTR = 'data-gufa-popup'
  const SELECTOR = [
    '[role="menu"]',
    '[role="listbox"]',
    '[role="dialog"]',
    '.gufa-modal',
    '.gufa-float-backdrop',
    '.gufa-branch-dialog-backdrop',
    '.gufa-session-backdrop',
    '.gufa-shortcuts-backdrop',
  ].join(',')

  /* 真正需要抬的是 overlay root 的 body 级祖先：它和停靠会话都是 body 的直接子节点，
     在祖先上设 z-index 才能压过会话的 2147483040；只抬 .gufa-overlay-root 出不了
     它自己的层叠上下文。 */
  let liftedNodes = []
  const lift = (open) => {
    try {
      if (open) {
        if (liftedNodes.length > 0) return
        let node = document.querySelector('.gufa-overlay-root')
        if (node === null) return
        while (node.parentElement !== null && node.parentElement !== document.body) node = node.parentElement
        if (node.parentElement !== document.body) return
        const saved = { node, zIndex: node.style.zIndex, position: node.style.position }
        node.style.zIndex = '2147483300'
        if (window.getComputedStyle(node).position === 'static') node.style.position = 'relative'
        liftedNodes.push(saved)
        if (node.parentElement !== document.body) return
      } else {
        for (const saved of liftedNodes) {
          saved.node.style.zIndex = saved.zIndex
          saved.node.style.position = saved.position
        }
        liftedNodes = []
      }
    } catch {
      /* ignore */
    }
  }

  const sync = () => {
    try {
      const root = document.querySelector('.gufa-root')
      const popup = root === null ? null : root.querySelector(SELECTOR)
      const open = popup !== null
      lift(open)
      if ((document.documentElement.getAttribute(ATTR) === '1') === open) return
      if (open) document.documentElement.setAttribute(ATTR, '1')
      else document.documentElement.removeAttribute(ATTR)
    } catch {
      /* ignore */
    }
  }

  let observer = null
  try {
    observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'aria-hidden'] })
  } catch {
    observer = null
  }
  sync()
  const timer = window.setInterval(sync, 400)
  return () => {
    if (observer !== null) observer.disconnect()
    window.clearInterval(timer)
    lift(false)
    document.documentElement.removeAttribute(ATTR)
  }
}
