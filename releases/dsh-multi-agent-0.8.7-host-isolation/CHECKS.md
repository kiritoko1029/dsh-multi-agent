# DSH 多 Agent 派发 0.8.7 — 宿主隔离修复与验证

## 修复原因

0.8.6 将 rc.1 的 `@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-subagent-acp`、`@deepseek-ai/dsh-subagent-codex` 作为生产依赖。全新 profile 安装后，这些本地包及 Codex 间接带入的 `dsh-tool-subagent` 可能遮蔽 DSH rc.2 自带实现，导致 `subagents` 服务不被接受，继而出现标准/PTC/创造模式加载失败和会话无法创建。

0.8.7 将插件运行代码与 DSH Host 包彻底隔离：

- 三个 Host Provider 包及 `dsh-sdk-protocol` 均不再进入生产依赖闭包。
- Cordis 改为由宿主提供的 peer。
- ACP 直接使用 `@agentclientprotocol/sdk`；纯进程 helper、ACP 文本收集和 DSH 模型继承 helper 保留在插件内。
- Codex 使用插件内的纯 Node JSON-RPC transport，直接依赖 `@openai/codex` 获取原生平台包。
- 保留 0.8.6 的 Windows 路径、原生命令、环境合并、目录身份、ACP 生命周期和报告链接修复。

## 已执行验证

- `npm run check`：通过。
- `npm test`：共 **330 项，329 通过、0 失败、1 跳过**。跳过项仍要求显式提供 DSH rc.1/rc.2 官方源码，不自动下载。
- `npm run build`：通过，Client bundle 已重建。
- 新增依赖隔离测试遍历生产普通/可选依赖闭包，拒绝任何 DSH Host 运行时包；可选平台包按实际安装平台处理。
- 在禁止相关 Host 包解析的独立 Node 进程中，Codex 与 ACP 入口均成功导入。
- 使用最终 TGZ 创建全新隔离安装目录，设置 `nodeLinker: hoisted`、`autoInstallPeers: false` 并关闭安装脚本，安装成功。
- 使用 DSH 0.2.2-rc.2 的原生 resolver 验证：
  - `@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-sdk-protocol` 均来自 **installation / 0.2.2-rc.2**；
  - profile 内不存在这些 Host 包的本地副本；
  - 内置 subagent 模块成功导入；
  - 插件根入口、availability、task-monitor、delegation-policy、ACP、agy、Codex 共 7 个 Host 入口全部成功导入。
- 最终 TGZ 共 53 个文件，包含全部本地运行模块。

## 升级与验证边界

1. 用本 TGZ 替换 0.8.6；若管理器提示 already-installed，先备份设置并只移除旧的本插件 bundle，再安装新版，不要删除整个 `.dsh`。
2. 替换后**完全退出并重启 DSH**，以清除旧模块缓存和旧依赖映射。
3. 确认 `subagent`、`subagent-spawn-in-process`、`subagent-fork-in-process` 为标准模式所需的启用状态；标准/PTC/创造模式不应再因本包带入的旧 Host 依赖而失败。
4. 当前验证在 macOS 上完成，不包含 Windows 实机 Host 启动。Windows 上仍需验证原生 CLI、模型目录、任务派发、续接和进程树回收。
5. Kimi/agy 默认 `permission: reject`；如需报告写入，由用户在理解风险后自行调整。任务面板仍依赖单独安装并启用的 Better Sidebar。

详细安装与安全说明见包内 `INSTALL.zh.md`。
