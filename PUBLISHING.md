# 发布维护

本文只面向仓库维护者。DSH 用户的安装与配置请阅读 [README.md](README.md) 和 [INSTALL.zh.md](INSTALL.zh.md)，版本变更只记录在 [CHANGELOG.md](CHANGELOG.md)。

## npm Trusted Publisher

npm 包为 [`@kiritoko1029/dsh-multi-agent`](https://www.npmjs.com/package/@kiritoko1029/dsh-multi-agent)。在 npm 包的 **Settings → Trusted publishing** 中配置 GitHub Actions：

- Repository owner：`kiritoko1029`
- Repository name：`dsh-multi-agent`
- Workflow filename：`release.yml`
- Environment：留空；工作流当前未使用 GitHub Environment

发布工作流通过 GitHub OIDC 换取 npm 短期凭证，不配置 `NPM_TOKEN`，也不在仓库、workflow 日志或插件配置中保存长期 npm 令牌。`publish-npm` 任务显式安装 npm `11.20.0`，满足 Trusted Publishing 所需的 npm 11.5.1+，并使用包含后续修复的 11.x 版本。

`0.9.3-stage.0` 仅用于建立 npm 包与 Trusted Publisher 的引导关系。该暂存版本未公开，不是稳定插件发行版，也不应作为安装来源。

## 正常发布步骤

1. 更新 `package.json` 的版本和 `CHANGELOG.md` 的对应版本段落。
2. 运行语法检查、完整测试、Client 构建和 `release:pack`，检查生成的 TGZ 与 SHA-256。
3. 提交并推送 `main`，确认 CI 成功后创建并推送对应的 `vX.Y.Z` 标签。
4. 等待 `.github/workflows/release.yml` 中的 `release` 与 `publish-npm` 两个任务完成，并检查 GitHub Release 和 npm registry 中的版本。

普通 `main` 提交、本地安装、手动 `npm pack` 都不会发布 npm。只有版本标签会触发该工作流。

## 工作流与产物校验

`release` 任务依次执行依赖安装、语法检查、完整测试、标签版本核对、Client 构建和 TGZ / SHA-256 构建，随后创建 GitHub Release。`scripts/build-release.mjs` 同时把本次构建产物的 SHA-256 写入 GitHub Actions step output，由 `release` job output 传给 npm 任务。

`publish-npm` 任务使用最小权限 `contents: read` 与 `id-token: write`，从刚创建的 GitHub Release 下载 TGZ 和校验侧车。`scripts/publish-npm.mjs` 在发布前验证：

- 标签版本、checkout 的 `package.json` 与 TGZ 内 `package/package.json` 的名称和版本一致；
- 包不是 private，目标 registry 为 `https://registry.npmjs.org/`，访问级别为 public；
- checkout 与 TGZ 的 repository 均属于触发工作流的 GitHub 仓库；
- `dist` 中只有预期 TGZ 和同名 `.sha256`，TGZ 的实际 SHA-256 与 Release 构建 job output 一致；
- 侧车只包含该精确 TGZ 的一条有效 SHA-256 记录；
- 本地 TGZ 计算出用于发布前后比对的 SHA-512 `dist.integrity`。

校验通过后，脚本只发布这个精确文件，不使用 TGZ 通配符：

```sh
npm publish <精确TGZ> --access public --provenance --registry=https://registry.npmjs.org/
```

## 重试与故障恢复

- 发布前发现同版本且 integrity 相同：视为已完成，跳过重复发布。
- 发布前发现同版本但 integrity 不同：拒绝发布，不能覆盖 npm 中已有内容。
- `npm publish` 返回错误：继续执行有界 registry 查询；若版本实际已接收且 integrity 一致，则恢复成功，避免重跑时重复发布。
- 发布后 registry 暂时不可见或查询失败：在限定次数内重试，不把网络错误当成“包不存在”。
- 发布后 integrity 不同或最终无法确认：任务失败，不报告发布成功。

Trusted Publisher、OIDC 或仓库绑定配置错误时，GitHub Release 可能已经创建，但 npm 发布会失败。修正配置后在原工作流运行中选择 **Re-run failed jobs**，不要重复创建同一标签或版本，也不要删除 Release 来掩盖失败。

## 分发边界

后续包名为 `@kiritoko1029/dsh-multi-agent`，`npm pack` 生成的 Release 资产名为 `kiritoko1029-dsh-multi-agent-<version>.tgz`。既有 0.9.2 的 `dsh-multi-agent-0.9.2.tgz` 资产名不变。

0.9.2 及更早版本保持原有 GitHub Release 分发，不追溯发布到 npm。npm 发布不改变 DSH 安装方式：用户仍通过插件管理器安装 TGZ，不在 profile 目录手动执行 npm / pnpm 安装。
