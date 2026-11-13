# Windows DSH Codex 导入诊断（不是插件安装包）

用于排查插件管理器只显示 `codex-provider: failed to import`、但没有完整异常的情况。

## 使用

1. 解压本 ZIP，保持 `Diagnose-CodexHost.ps1` 和 `probe.cjs` 在同一文件夹。
2. 保持 DSH 打开，让脚本能够从正在运行的 `DeepSeek Harness` 进程定位应用 EXE。
3. 在这个文件夹打开 **PowerShell 7.6 或更新版本**，运行：

```powershell
pwsh -NoProfile -File .\Diagnose-CodexHost.ps1
```

4. 等待结束，最多约一分钟。把生成的 `CodexHost-Diagnostic-日期时间.txt` 发回排查。报告包含安装路径和用户名目录，请先检查内容。

**不要把这个 ZIP 放到插件管理器安装。** 它不是新的插件版本。

## 无法自动找到 DSH 时

从 DSH 快捷方式属性或安装目录取得 `DeepSeek Harness.exe` 的真实完整路径，再指定：

```powershell
pwsh -NoProfile -File .\Diagnose-CodexHost.ps1 -DshExe 'DSH EXE 的实际绝对路径'
```

不要传 Volta 的 node.exe。脚本不会回退到系统 Node。

默认检查当前用户的 `.dsh\profiles\desktop`。如果实际使用其它 profile 或自定义位置，显式指定：

```powershell
pwsh -NoProfile -File .\Diagnose-CodexHost.ps1 -DshExe 'DSH EXE 的实际绝对路径' -ProfileDir '实际 profile 目录的绝对路径'
```

参数 `-DshInstallDir` 仅在自动定位 CLI 包失败时使用，指向包含 `@deepseek-ai/dsh` 的 package.json 的目录，而不是插件目录；可以是 app.asar 内部路径，由 Electron 验证。

如果 PowerShell 执行策略拦截脚本，请先保留提示，不要关闭全局执行策略或绕过组织限制。

## 这个工具做什么

- 在独立短时子进程中使用 DSH 自己的 Electron/Node，不使用普通终端的 Volta Node。
- 读取 DSH 版本、profile 包清单、插件实际版本及 Codex 文件 SHA-256。
- 使用已安装 DSH 的官方运行时解析表和解析器，再导入 Codex 入口，打印完整错误及 cause。
- 不调用插件 apply、不启动 Codex/模型任务，不安装依赖、不修改或删除 profile，不读取模型配置或凭据文件，不停止现有 DSH。
- 只创建一个新的诊断文本报告，不覆盖已有报告；子进程有超时上限。

## 边界

这是“相同安装的运行时 + 官方 resolver”的**独立进程导入探测**，不是读取正在运行的 Host 日志。它重建选中的包映射，但不执行用户 YAML 表达式、不挂载插件树、不复用现有模块缓存。

如果报告显示 `DSH_RESOLVER_IMPORT=IMPORT_OK`，而界面仍失败，需要继续查看真实 Host 的 Loader 状态/错误日志，不能据此声称启用成功。

诊断主体已在 macOS 的 DSH 0.2.2-rc.2 Electron 运行时实际执行，成功导入隔离安装的插件 0.8.3。PowerShell wrapper 已做静态检查，**尚无 Windows 实机运行或 PowerShell parser 验证**。工具仅针对 DSH 0.2.2-rc.1 / rc.2 的已核对 API，版本不符会停止，不猜测兼容接口。
