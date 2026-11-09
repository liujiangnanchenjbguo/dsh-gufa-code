# 编辑器性能设计（避免按键「不跟手」）

Monaco 本身很快；古法编程编辑器之前卡顿的主要原因是 **React 状态更新链路**：
每按一个键，Monaco 的 `onDidChangeModelContent` 会同步到 App 状态，导致整个 IDE
（资源管理器、终端、右侧 AI 会话、状态栏…）重渲染一次；光标位置变化又触发一次。
快捷键连打时就是每秒几十次整树渲染。

## 现在的实现

1. **内容缓冲区（不在每次按键时 setState）**
   - `onChange(path, content)` 只写入 `editorBuffersRef`（ref，不触发渲染）；
   - 只有「干净 ↔ 脏」变化时更新一次 tabs（标签圆点），每个编辑段最多一次；
   - 停顿 **300ms** 后用 `flushEditorBuffers()` 把缓冲内容同步进 tabs（一次渲染）；
   - 保存 / 自动保存（700ms）/ 关闭标签前**直接读缓冲**，所以不会写入旧内容；
   - 撤销到与磁盘一致时会自动变回「已保存」。

2. **光标/行号走外部 store**
   - Monaco 的光标事件写入 `G.cursorStore`（module-level，去重 + 订阅），
   - 状态栏的 `G.StatusCursor` 用 `useSyncExternalStore` 订阅，**只渲染状态栏那一小块**；
   - App 根组件不再因为光标移动而重渲染；选区（AI 引用用）180ms 防抖后单独更新。

3. **EditorPane 用 React.memo + 稳定回调**
   - 父组件因其它原因重渲染时，只要 tabs/activePath/theme 等 props 没变，Monaco 外层不重渲染；
   - `onChange/onSave/onSelectTab/onCursor` 都用 `useCallback`，依赖只包含真正会变的数据。

## 实测（macOS，113 行文本文件）

- 连续输入 `abc`：标签立即变脏、状态栏 Ln/Col 正常更新；
- 自动保存在 700ms 档内把 `abc` 写入磁盘（通过 Host `fs.read` 校验内容 +3 字节）；
- `Cmd+Z` 撤销后自动保存把文件恢复为原始内容（与 baseline 全等）；
- 三套测试 99 / 44 / 19 全过。

## 坑：内容缓冲不能把旧内容回灌给 Monaco（1.3.58 修复）

缓冲方案第一版在「干净→脏」的状态更新里只改了 `dirty`、没带最新 `content`，
导致 App 用旧的 `tabs.content` 重渲染 → EditorPane 的 model 同步逻辑误判为外部修改并
`model.setValue(旧内容)` → 用户刚输入的内容被覆盖、光标跳回开头。

修复：
1. 脏标记更新时把**缓冲里最新内容**一起写进 tabs；
2. EditorPane 同步 model 时增加保护：如果编辑器有焦点、且 model 内容仍等于上次上报内容，
   就认定是 App 状态暂时落后，**不 setValue**；只有非焦点场景/真正外部更新才同步。

回归验证：主窗口 113 行文件输入 `abcdef` → 内容保留、光标不跳；自动保存写入 +6 字节；
`Cmd+Z` 后恢复原始内容（1498 字节逐字节相等）。

## 后续可继续优化（未做）

- 超大文件（数万行）时 Monaco `model.getValue()` 每次变更复制整个字符串，可改为增量取内容/仅在 flush 时取；
- 右侧 AI 流式回复时 App 的频繁更新可进一步拆分订阅；
- 资源管理器大目录可做虚拟滚动。
