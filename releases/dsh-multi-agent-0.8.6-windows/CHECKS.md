# DSH 多 Agent 派发 0.8.6 — 验证记录

## 本轮 Windows 适配

- 移除打包者本机绝对路径，按平台检测原生 CLI；处理 Windows 大小写环境键、重复 PATH 键与带引号的 PATH 目录。
- Codex 按“手动命令 → 检测到的原生命令 → 依赖包内原生二进制”选择，目录查询与 app-server 共用命令；嵌套依赖布局从 `@openai/codex` 自身作用域解析平台包。
- 对 Windows 的 `.cmd`、`.bat`、JavaScript、PowerShell shim 在启动前给出明确错误，不送入无 shell 的原生进程边界。JavaScript wrapper 回退显式设置 Electron Node 模式。
- Kimi/agy 手动命令及 Provider env 不再被自动检测门禁误拦；命令保留 volatile 热更新；模型目录继承对应 Provider 环境。
- ACP 目录探测同时观察 `child.done`，启动失败及时返回并清理，避免未处理拒绝和无效等待。
- 续接工作区按 realpath 与设备/文件身份比较，避免 Windows 等价路径被误判为不同目录。
- Markdown 与旧完成通知支持 Windows 报告路径；保留危险协议及协议相对链接拦截。
- `npm test` 不再依赖 POSIX glob；测试夹具、CRLF 官方源码校验与 agy smoke 脚本补充平台处理。

## 已执行

- macOS / Node：`npm run check` 通过。
- macOS / Node：`npm test` 共 **329 项，328 通过、0 失败、1 跳过**。跳过项仍需调用方显式提供 DSH rc.1/rc.2 官方源码，保持原有不自动下载策略。
- `npm run build` 通过，已生成最新 `client-bundle.js`。
- 独立代码审查发现的两项回归（嵌套 Codex 平台包解析、ACP 命令热更新）已修复并复核关闭，无剩余阻断问题。
- `npm pack` 完成，包内共 52 个文件，包含新增 `lib/codex-command.js`、`lib/path-compat.js`、`lib/process-command.js`。
- 当前 macOS profile 使用本工作区的链接安装；通过插件管理器停用/启用重载均返回 `applied`。路由、Codex、Kimi、agy、可用性与任务监控均为活动状态，完成卡片 Client 注册为活动。

## 尚未验证 / Windows 验收要求

本轮没有把模拟 Windows 测试当作 Windows 实机验收。目标 Windows 电脑仍需验证：

1. DSH 仅使用受支持的 `0.2.2-rc.1` 或 `0.2.2-rc.2`，不要用版本豁免强行安装。
2. 在 Windows 上执行 `npm run check` 与 `npm test`，覆盖 NTFS、junction、PATH 和 CRLF 检出行为。
3. 安装并登录所需外部 CLI；Kimi/agy 在设置中填写实际原生 `.exe` / `.com`，不要填写 `.cmd` / `.bat` / `.js` / `.ps1`。
4. 重新读取 Codex/Kimi/agy 模型目录，再各执行一个小任务，确认 ACP/app-server 握手、权限选择、报告写入和完成通知。
5. 验证设置中的命令热更新、完成任务续接，以及取消/超时后的整个 Windows 进程树回收。
6. 刷新 DSH 页面后检查任务面板和 Windows 报告链接。任务面板仍需单独安装并启用兼容的 Better Sidebar。

安装依赖需要联网。Kimi/agy 新安装保持 `permission: reject`；如需写报告，请由用户在理解风险后自行改为 `allow`，不要为验收直接关闭所有安全限制。详细安装与安全说明见包内 `INSTALL.zh.md`。
