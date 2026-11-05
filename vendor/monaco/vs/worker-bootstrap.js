/* eslint-disable */
/**
 * Monaco worker 引导脚本（古法编程离线资产）。
 *
 * 与 Monaco 官方 AMD 用法一致：只设置 MonacoEnvironment.baseUrl + importScripts(workerMain.js)，
 * workerMain 内部自带的模块加载逻辑会按 baseUrl 去 importScripts 各依赖模块。
 * （不要在这里再 importScripts(loader.js)：worker 里 loader 与 workerMain 的模块系统会冲突，
 *   表现为 workerMain 里 “X is not a function”。）
 */
(function () {
  var href = String(self.location.href || '')
  var base = href.replace(/\/worker-bootstrap\.js(?:\?.*)?$/, '')
  if (base === href || base === '') base = '/gufa-code/asset/monaco'
  self.MonacoEnvironment = { baseUrl: base + '/' }
  importScripts(base + '/base/worker/workerMain.js')
})()
