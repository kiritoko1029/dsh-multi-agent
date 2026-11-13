# 0.8.5 CLI 自动检测与手动覆盖版说明

在 0.8.4 Windows/启动修复基础上，为 Codex、Kimi Code、agy 增加统一设置页 CLI 路径输入。留空自动检测，手动填写优先，清空覆盖恢复自动检测。Codex 手动路径同时用于目录查询和 app-server；其它权限与路由不变。

在 0.8.3 的 Codex 导入修复基础上，支持 Windows 原生 CLI 路径与官方安装位置；三个 Provider 改为注入等待可用性服务，避免动态 disabled 条件在冷启动时提前跳过组件。实际 Windows 目录读取仍待接收者验证。

针对 Codex 入口额外加载整套 Subagent 服务的耦合问题，将五个仅依赖 Node 内置模块的进程辅助函数纳入插件，保持官方 rc.1 实现和 MIT 许可；去掉 Codex 对 subagent、timeout、brand 包入口的顶层导入。其它运行行为、模型路由与权限不变。

这不是已经完成 Windows Host 验收的版本：外部普通 Node 缺少宿主 peer 的报错，不能直接等同于 DSH 的 `failed to import` 摘要。该候选消除已知不必要的导入链；实际 Windows Host 是否恢复启用，仍需接收者验证。

本包基于 0.8.1 的 DSH rc.1 / rc.2 双版本适配制作，保留原包名 `@local/dsh-multi-agent`，避免因改名产生两套重复工具注册。

## 本次整理

- 删除打包者专用的 Kimi、agy 绝对路径，使用接收者本机的检测结果。
- Kimi / agy 新安装采用保守的 ACP `reject` 默认权限；明确说明报告写入可能因此被拒绝。
- 补充首次安装、前置依赖、CLI 检测、费用与安全说明。
- 保留已构建 Client、所有 Host 入口、语言资源、图标和第三方声明。
- 不捆绑 node_modules、用户配置、账户凭据、会话、任务报告、备份、开发测试或本机日志。

## 安装包性质

这是 npm 格式 TGZ，可交给 DSH 插件管理器从本地绝对路径安装。安装依赖仍需联网；无需接收者自行构建前端。`private: true` 仅阻止误发布 npm，不阻止本地安装。

外层分享 ZIP 只是便于转发的容器：解压后安装其中 TGZ，并阅读安装说明。SHA-256 文件用于核对传输完整性，不是数字签名，也不能独立证明来源可信。

该包在独立分享工作区生成，没有替换打包者当前 profile 的安装或权限配置。没有执行 npm publish、GitHub 上传或插件市场提交。

## 支持边界

- DSH：仅 `0.2.2-rc.1` / `0.2.2-rc.2`。
- 平台：macOS 上执行构建和回归；Linux / Windows 未经实机验证。
- 可视任务面板依赖独立的 Better Sidebar；它未捆绑，需安装与当前 DSH 兼容的版本。
- 外部 Agent 需自行安装 CLI 并登录；不携带模型服务或额度。
- 真实上游契约测试使用隔离边界替身，不代表完整 rc.2 Desktop 或所有真实 CLI 场景已验收。

完整功能见 README；接收者首次使用请读 INSTALL.zh.md。
