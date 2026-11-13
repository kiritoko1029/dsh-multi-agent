# 0.8.4 Windows CLI 与启动修复 — 验证记录

## 修复内容

- `availability.js`：Windows 使用分号 PATH、大小写不敏感环境键和原生 `.exe` / `.com` 候选；显式 `.cmd` / `.bat` 不再被当作 DSH 可直接启动的原生程序。
- 默认位置：Codex 支持 CODEX_INSTALL_DIR 和 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`；Kimi 使用当前用户 `.kimi-code\bin`；agy 使用 `%LOCALAPPDATA%\agy\bin`。POSIX 原路径保留。
- 三个 Provider 删除在可用性服务尚未就绪时求值的动态 disabled 条件，改为 `inject: [multiAgentAvailability]`，由 Cordis 等待依赖；内部可用性检查与模型/权限配置不变。
- 保留 0.8.3 的 Codex 独立进程 helper 修复。

## 验证

- macOS / Node v24.16.0：完整回归 **304 通过、0 失败、0 跳过**。
- 新增 Windows 原生扩展名、PATH 分隔、官方默认路径和缺失 CLI 的回归测试；60 项 Provider/可用性定向测试通过。
- 真实 Cordis Loader 冷启动回归：旧动态禁用方式可在模块导入成功时留下无 fiber 的未挂载组件；改为注入等待后，Provider 进入 active 且 apply 恰好一次。
- 使用 DSH 0.2.2-rc.2 Electron 的真实 runtime resolution，在禁用 peer 自动安装的隔离 profile 中，Codex、ACP、agy、availability、task-monitor、delegation-policy 六个入口均导入成功。
- 普通 Node 对 ACP 直接导入仍可能缺宿主 peer；这不是 DSH Host 验收，已通过上述原生 resolver 测试区分。

## 仍需实机验收

没有实际 Windows CLI 模型目录读取的端到端证据。本包补上了代码中可确认的 Windows 检测缺陷和已复现的启动竞态；安装后应分别点击“重新读取模型列表”，再执行一个需要的小型任务。

旧 profile 如果还保留三个 Provider 的动态 disabled 覆盖，会继续绕过新版默认；只清理这些旧覆盖，保留模型、命令和权限设置。不要删除整份配置或安装宿主 peer 来掩盖问题。

SHA-256 仅校验传输完整性，不是数字签名。
