# 发布流程（维护者）

## ⚠️ 发布规则（用户明确要求）

- **只有用户明确说「发布 / 发版」时才发布 npm**。日常改 bug、跑测试、构建本地 client/helper 都不发布。
- 创建 GitHub Release **不再自动触发 npm 发布**（`publish.yml` 只保留 `workflow_dispatch`）。
- 用户未要求发布时：本地 commit / push main 可以（只会跑 test，不会发 npm），但**不要**打新 tag、不要 `gh release create`。
- 用户要求发布时：按下面流程 bump/tag/release，然后手动触发 `publish.yml`。

## 发布流程：打 tag + 建 GitHub Release + 手动触发 npm

1. 确认 `package.json` 版本号已更新（`npm version patch --no-git-tag-version` 或手改）；
2. 提交并推送 tag：
   ```bash
   git tag v1.3.x && git push origin v1.3.x
   ```
3. 建一个 GitHub Release（网页或 CLI）：
   ```bash
   gh release create v1.3.x --title "..." --notes "..."
   ```
4. Release 会触发 `.github/workflows/build-float.yml`（三平台编译 helper + 严格冒烟，二进制作为 release assets）；
5. **用户明确要求发布时**，手动触发 npm（trusted publishing / OIDC provenance，不需要本地 token）：
   ```bash
   gh workflow run publish.yml --repo liujiannanchenjbguo/dsh-gufa-code
   ```
6. 验证：`npm view dsh-gufa-code version`、Release 页面 assets。

## 本地发布（不推荐，需要 npm 2FA）

`npm publish`（会要求网页 2FA 验证）。优先用上面的 GitHub Release 流程。

## 发布前检查

```bash
node scripts/build-client.mjs
node --check client.js
node scripts/selftest-client.mjs   # 99
node scripts/selftest-host.mjs     # 30
node scripts/test-editor.mjs       # 19
npm pack --dry-run | grep desktop/float/bin   # 三平台二进制在包里
```
