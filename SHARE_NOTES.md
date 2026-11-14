# 0.9.2 顶栏多 Agent 设置面板说明

0.9.2 将模型、思考强度、路由规则、权限策略和运行参数从 DSH 设置页迁移到会话顶栏右侧的“多 Agent 派发”按钮与宽敞浮层。全部原有配置值和四个 namespace 的 CAS 保存逻辑保持不变，新增分组浏览、未保存关闭确认、键盘焦点管理及中英文界面；原设置页入口已移除。完整回归共 371 项，370 通过、0 失败、1 项原有条件跳过。

## 0.9.0 子代理权限申请版说明

0.9.0 为 Kimi、agy、Codex 三个子代理后端加入统一的"子代理权限请求策略"，默认 **主会话审批**：权限申请送入派发它的主会话审批链（Web 端原生审批面板），轮次已结束或无应答器时自动降级为交互式审批卡片；也可按 Agent 选择人工审批、允许所有、拒绝所有或子代理控制（auto / full-access / ask-request 三级，agy 的 full-access 追加其原生 `--dangerously-skip-permissions`）。Codex 在交互类策略下改用 on-request 线程（workspace-write、无自动审查器）使真实升级请求可达并可被批准；所有未决路径 fail-closed。0.8.x 保存的 `allow` / `reject` 值继续有效。测试新增 20+ 权限场景；详见 README 的 0.9.0 一节。

## 0.8.8 原生任务面板与 Windows 兼容版说明

0.8.8 将 Agent 任务面板迁移到 DSH 原生右侧栏、开始页入口和文件预览，不再依赖第三方 Better Sidebar。保留 0.8.7 的 Host 依赖隔离与全部 Windows 适配。

## 0.8.7 宿主依赖隔离与 Windows 兼容

0.8.7 修复 0.8.6 在全新 profile 中带入 rc.1 Host 包、导致 DSH 自带 `subagents` 与多个 Agent 预设无法启动的问题。生产依赖不再包含 `dsh-subagent`、`dsh-subagent-acp`、`dsh-subagent-codex`、`dsh-sdk-protocol` 或其它 Host 运行时包；Cordis 由宿主提供。包含下方 0.8.6 的全部 Windows 适配。

## 0.8.6 Windows 兼容版说明

本轮在 0.8.5 基础上补齐 Windows 原生命令选择、Kimi/agy 手动路径门禁、Provider 环境继承、ACP 启动失败处理、目录身份比较、Windows 报告链接和跨平台测试脚本。Codex 可使用依赖包内的原生二进制，脚本 shim 会在启动前明确拒绝；权限、模型授权与路由默认值不变。

以下是 0.8.5 的原始功能说明：统一设置页 CLI 路径输入支持留空自动检测、手动优先和清空覆盖恢复自动检测。

在 0.8.3 的 Codex 导入修复基础上，支持 Windows 原生 CLI 路径与官方安装位置；三个 Provider 改为注入等待可用性服务，避免动态 disabled 条件在冷启动时提前跳过组件。实际 Windows 目录读取仍待接收者验证。

针对 Codex 入口额外加载整套 Subagent 服务的耦合问题，将五个仅依赖 Node 内置模块的进程辅助函数纳入插件，保持官方 rc.1 实现和 MIT 许可；去掉 Codex 对 subagent、timeout、brand 包入口的顶层导入。其它运行行为、模型路由与权限不变。

这不是已经完成 Windows Host 验收的版本：外部普通 Node 缺少宿主 peer 的报错，不能直接等同于 DSH 的 `failed to import` 摘要。该候选消除已知不必要的导入链；实际 Windows Host 是否恢复启用，仍需接收者验证。

0.9.0 起包名由 `@local/dsh-multi-agent` 改为 `dsh-multi-agent`，插件标识、Cordis 补丁组件名、Client 模块标识、设置存储键和任务面板标签页标识随之改变。新旧包不能同时安装，否则会出现两套重复的工具注册；从 0.8.x 升级请按 INSTALL.zh.md 的迁移步骤先卸载旧包。

## 本次整理

- 删除打包者专用的 Kimi、agy 绝对路径，使用接收者本机的检测结果。
- Kimi / agy 新安装默认 `main-session`（主会话审批）；0.8.x 保存的 `allow` / `reject` 值继续有效。批准操作不是操作系统级沙箱，风险说明见 INSTALL.zh.md。
- 补充首次安装、前置依赖、CLI 检测、费用与安全说明。
- 保留已构建 Client、所有 Host 入口、语言资源、图标和第三方声明。
- 不捆绑 node_modules、用户配置、账户凭据、会话、任务报告、备份、开发测试或本机日志。

## 安装包性质

这是 npm 格式 TGZ，可交给 DSH 插件管理器从本地绝对路径安装。安装依赖仍需联网；无需接收者自行构建前端。包清单已允许公共 npm 发布，但只有推送新版本标签并通过 GitHub Release 工作流才会发布，本地安装不会触发 npm publish。

安装包从 [GitHub Releases](https://github.com/kiritoko1029/dsh-multi-agent/releases) 下载：`dsh-multi-agent-0.9.2.tgz` 及同名 `.sha256`。SHA-256 文件用于核对传输完整性，不是数字签名，也不能独立证明来源可信。

该包由独立工作区构建；TGZ 不含打包者 profile、用户配置或凭据。源码与安装包发布到 GitHub 仓库与 Releases；启用自动发布流程后的新版本会由 GitHub Actions 通过 OIDC Trusted Publishing 同步到 npm 包 `@kiritoko1029/dsh-multi-agent`，对应资产名为 `kiritoko1029-dsh-multi-agent-<version>.tgz`。0.9.2 及更早版本不追溯发布，也不提交插件市场。

## 支持边界

- DSH：仅 `0.2.2-rc.1` / `0.2.2-rc.2` / `0.2.2-rc.3`。
- 平台：macOS 上执行构建和回归；Linux / Windows 未经实机验证。
- 0.8.8 起，可视任务面板使用 DSH 原生右侧栏与文件预览，不再需要第三方 Better Sidebar。
- 外部 Agent 需自行安装 CLI 并登录；不携带模型服务或额度。
- 真实上游契约测试使用隔离边界替身，不代表完整 rc.2 Desktop 或所有真实 CLI 场景已验收。

完整功能见 README；接收者首次使用请读 INSTALL.zh.md。
