# 发布流程（维护者）

## 一键发布：打 tag + 建 GitHub Release

1. 确认 `package.json` 版本号已更新（`npm version patch --no-git-tag-version` 或手改）；
2. 提交并推送 tag：
   ```bash
   git tag v1.3.x && git push origin v1.3.x
   ```
3. 建一个 GitHub Release（网页或 CLI）：
   ```bash
   gh release create v1.3.x --title "..." --notes "..."
   ```
4. 触发两个 workflow：
   - `.github/workflows/publish.yml`：**npm trusted publishing（OIDC provenance）自动发布**，不需要本地 npm token / 2FA；
   - `.github/workflows/build-float.yml`：三平台编译 helper + 严格冒烟，并把二进制作为 release assets 附上。
5. 验证：`npm view dsh-gufa-code version`、Release 页面 assets。

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
