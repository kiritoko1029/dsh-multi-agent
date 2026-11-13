# 0.8.3 Codex 导入链修复候选 — 验证记录

## 修复范围

Codex 原先为五个进程辅助函数而顶层加载整个 `dsh-subagent` 服务入口，带入 `dsh-util-time` 等宿主 peer 依赖。现在从插件自己的 Node-only helper 模块加载这些函数，保留官方 rc.1 实现及完整 MIT 许可；计时上限直接使用原常量，run id 仍为 randomUUID。Codex 不再顶层导入 subagent、timeout、brand 入口，SDK JSON-RPC 和 CLI 定位保持不变。

没有改模型路由、取消/清理语义、权限默认、ACP 实现或用户 profile，也没有逐个安装宿主 peer。

## 已执行验证

- macOS / Node v24.16.0：语法检查和完整回归 **301 通过、0 失败、0 跳过**。
- 包含两版官方固定源码的隔离契约验证，以及新 helper 的 UTF-8 诊断上限、取消、幂等清理等回归。
- 独立临时项目使用 pnpm v11.28.5，设置 `nodeLinker: hoisted`、`autoInstallPeers: false`，安装时 `--ignore-scripts`；与官方 DSH profile 的 peer 策略一致，但没有启动完整 Host。
- 在该项目安装旧 0.8.2 TGZ，普通 Node 导入 Codex 复现 `MODULE_NOT_FOUND @deepseek-ai/dsh-timeout`。这与用户报告的 util-time 不完全相同，均属于旧入口要求宿主 peer 的链路；不把它描述为逐字复现 Windows Host 报错。
- 在同一项目安装最终 0.8.3 TGZ，确认 util-time 和 timeout 仍不可解析，Codex 入口导入成功并导出正确的 apply/name。
- 新增测试同时阻止 subagent、timeout、brand 的裸包名与磁盘入口加载，Codex 实际入口仍导入成功。

## 必须保留的边界

用户提供的 util-time 堆栈来自外部 Node；DSH Host 有自己的 ESM/CJS 解析器。普通 Node 缺 peer 不等于 Host 也缺 peer，不能断言动态 import 必然绕过 Host。

本候选已消除已知不必要的加载链，但 **未完成 Windows Host 的真实 TGZ 安装、组件启用和 Codex 委派验收**，也未证明 UI `failed to import` 与外部 Node 完全同因。

请通过 DSH 插件管理器替换为 0.8.3，完整重启 DSH，确认 Codex 组件是否启用，再执行一次小任务。若仍失败，请取得 DSH Host 完整导入异常及 cause，不再删除配置或用外部 Node 的 peer 缺失代替 Host 日志。

SHA-256 只验证传输完整性，不是数字签名。
