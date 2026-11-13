# 0.8.5 CLI 自动检测与手动覆盖 — 验证记录

## 功能

- Codex、Kimi Code、agy 设置页新增 CLI 路径输入。手动填写优先；空白保存为 unset，恢复包内自动检测默认值。
- Codex 手动命令用于模型目录与实际 app-server；缺省仍使用官方 package wrapper。
- Kimi / agy 手动命令用于模型目录和 ACP 任务。
- 无 CLI 且无 Codex 手动命令时不注册 provider，保留 DSH 回退；显式路径可在检测失败时通过配置重载启用。
- 保留 Windows 原生 CLI 检测、Provider 启动等待、ACP 保守权限与 Codex 局部 helper 修复。

## 验证

- macOS / Node v24.16.0：完整回归 **316 通过、0 失败、0 跳过**。
- UI 测试验证三个命令字段、手动覆盖、空白 unset、revision 和部分失败处理。
- Codex 相关测试覆盖目录优先级、显式 app-server argv、默认 wrapper、resume、取消与清理，以及无 CLI 的回退条件。
- 在 pnpm `nodeLinker: hoisted`、`autoInstallPeers: false` 的隔离 profile 安装最终 TGZ，并用 DSH 0.2.2-rc.2 的原生 resolver 导入六个 Host 入口，均成功。
- 打包白名单、路径穿越/链接、个人路径和常见凭据模式检查通过；不包含 node_modules、profile、会话、报告或测试目录。

## 边界

尚未在 Windows 上实际执行 Codex/agy 模型目录请求；手动路径功能需在目标电脑保存后点击“重新读取模型列表”验收。手动路径指向的程序由用户选择，填错会明确失败；它不是权限或模型授权开关。
