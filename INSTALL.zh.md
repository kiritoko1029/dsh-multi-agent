# DSH 多 Agent 派发 0.9.0 — 安装与安全说明

本项目不是 DSH 官方插件。源码与安装包发布在 [GitHub 仓库](https://github.com/kiritoko1029/dsh-multi-agent)，未发布到 npm；请从 [Releases](https://github.com/kiritoko1029/dsh-multi-agent/releases) 下载 `dsh-multi-agent-0.9.0.tgz` 及其 `.sha256` 校验文件。

## 一、准备环境

1. DSH 必须为 `0.2.2-rc.1`、`0.2.2-rc.2` 或 `0.2.2-rc.3`；其它版本未列入兼容范围，不要通过版本豁免强行安装。
2. 在自己的 DSH 中配置可用模型。仅使用 DSH 子代理时，不需要安装外部 CLI。
3. 需要哪个外部 Agent，就在本机安装并登录哪个 CLI：Codex、Kimi Code 或 Google Antigravity（agy）。安装这个插件不会赠送账号、模型额度，也不会带入分享者的登录。
4. “Agent 任务”面板直接使用 DSH 原生右侧栏和文件预览，无需安装第三方侧栏插件。
5. 安装依赖需要联网。macOS 是打包与回归验证平台；Linux / Windows 未经过实机安装和 CLI 执行验收。

## 从 0.8.x 升级到 0.9.0

0.9.0 有两处会影响既有安装的变化，升级前请先读：

1. **包名改为 `dsh-multi-agent`**（原 `@local/dsh-multi-agent`）。插件标识、Cordis 补丁中的组件名、Client 模块标识、设置存储键和任务面板标签页标识都随之改变。新旧包不能同时安装，否则会出现两套重复的工具注册。
2. **默认权限策略改为主会话审批**：Kimi / agy 的 `reject`、Codex 的 `approve-for-me` 自动审查，变为主会话审批。这是收紧交互而不是放权；已保存的 `allow` / `reject` 值继续有效。

升级步骤：

1. 记录或备份当前插件设置（模型、CLI 路径、路由规则、权限策略）。
2. 在 DSH 插件管理器中卸载旧的 `@local/dsh-multi-agent` bundle；不要清空整个 profile，也不要删除整个 `.dsh`。
3. 安装 Releases 中的 `dsh-multi-agent-0.9.0.tgz`，按管理器提示应用或重启 DSH。
4. 重新核对设置页：包名变化后旧设置键不会自动迁移，请按第 1 步的记录重新填写，再确认每个 Agent 的权限策略符合预期。

若 0.8.6 曾导致标准 / PTC / 创造模式失败，0.9.0 已包含 0.8.7 的宿主依赖隔离修复，升级后完全重启 DSH 即可；不要为恢复而删除整个 `.dsh`。旧版 profile 若保留 `disabled: !!js ...` 条件覆盖，会继续绕过新版默认，升级时只清理这三个 Provider 的旧动态 disabled 覆盖，保留模型、命令、权限和其他插件设置，无需删除整份 `cordis.patch.yml`。

## 二、首次安装（推荐）

从 Releases 页面下载 `dsh-multi-agent-0.9.0.tgz`，需要时一并下载 `.sha256` 校验文件：在 macOS / Linux 上执行 `shasum -a 256 -c dsh-multi-agent-0.9.0.tgz.sha256` 即可核对传输完整性（该校验值不是数字签名，也不能独立证明来源可信）。TGZ 本身就是插件安装包，不需要先解开。

把 TGZ 文件或它在 DSH 所在电脑上的绝对路径交给 DSH，并发送：

> 请安装我提供的本地多 Agent 派发插件 TGZ。先检查我的 DSH 版本和安装包信息，再通过插件管理器安装。不要手动改 profile 文件，不要开启版本豁免，不要替我把权限策略改成 allow 或 full-access。如果需要执行依赖安装脚本，先说明具体脚本和原因。安装后核验插件状态，并按管理器返回结果告知是否需要重启。

对应 DSH 工具是 `plugin_manager` 的 `install_bundle` 操作，`target` 使用本地 TGZ 的绝对路径（也支持绝对 `file:` tarball spec）。不要在 profile 目录手工执行 npm / pnpm 安装。

管理器若返回需要重启，就重启 DSH；若返回已应用，仍要检查设置页、任务面板和测试任务。仅看到磁盘文件或包版本不代表新模块已生效。

**如果已安装旧包 `@local/dsh-multi-agent`：** 先备份自己的插件设置，遵循管理器的升级结果。旧版管理器可能要求先卸载再安装；不要盲目卸载、复制整个 profile 或覆盖其它插件配置。

## 三、首次配置与 CLI 手动覆盖

在“DSH 设置 → 多 Agent 派发”中，Codex、Kimi Code、Antigravity 都有“CLI 路径（留空自动检测）”输入：

- 留空：使用本机自动检测结果。
- 手动填写：保存后优先使用该路径。Windows 下通常填写实际 `.exe` 的绝对路径。
- 清空并保存：删除当前用户的手动覆盖，恢复自动检测。
- 修改后点击对应 Agent 的“重新读取模型列表”，再选择模型。

Codex 的手动路径也用于实际 app-server 调用；Kimi / agy 的手动路径用于模型目录与 ACP 任务。路径指向的程序由用户选择，填错会在目录读取或任务启动时失败，不要把它当作模型配置错误。

打开 DSH 设置中的“多 Agent 派发”：

- 先用 DSH 自身做一个小任务确认基础能力，再启用需要的外部 Agent。
- 模型/推理强度可留空继承后端默认；只填写自己账号可用的模型。
- 根据需要调整自然语言路由。插件会向主会话添加主动派发指引，并对部分原生新建委派工具施加工作流约束，影响当前 profile 中可使用该插件的主会话，不只是一个面板装饰。
- Kimi / agy CLI 缺失且未手动配置时对应 Provider 不启用；Codex 可回退到依赖包内的原生二进制。向不可用外部 Agent 派发可能回退 DSH，工具回执会说明 fallback。请检查实际执行者，不要以为始终由指定外部 CLI 完成。

### CLI 路径

- Codex：Windows 检测 `%CODEX_INSTALL_DIR%\codex.exe`、`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` 和 PATH，并可回退到依赖包内的原生 Codex；macOS/Linux 保留原常见位置。可用 `CODEX_COMMAND` 指定原生程序路径。模型目录和 app-server 使用同一选择结果。
- Kimi：Windows 检测当前用户的 `%USERPROFILE%\.kimi-code\bin\kimi.exe`；macOS/Linux 检测 `~/.kimi-code/bin/kimi`，再搜索 PATH。可用 `KIMI_COMMAND` 指定路径。
- agy：Windows 检测 `%LOCALAPPDATA%\agy\bin\agy.exe`；macOS/Linux 检测 `~/.local/bin/agy`，再搜索 PATH。可用 `AGY_COMMAND` 指定路径。

Windows 只接受 DSH 托管进程边界可直接启动的原生程序。`.cmd` / `.bat` / `.js` / `.ps1` 等脚本或 shim 不会被当作 EXE 启动，而会在启动前提示选择原生 `.exe` / `.com`。若 PATH 中只有 npm 的 `.cmd`，Codex 会尝试依赖包内的原生二进制；Kimi / agy 仍需填写对应原生可执行文件。

这些变量必须进入 **DSH 进程的启动环境**。在另一个终端里临时 export，不会改变已运行桌面进程的环境。自定义命令也可在插件设置中填写，手动路径优先于自动检测；新装 CLI 或修改环境变量后通常需要重启或重载插件。

## 四、权限与费用：先读再启用

- **0.9.0 起，Kimi / agy / Codex 新安装默认 `permission: main-session`（主会话审批）。** 子代理的权限申请会送到派发它的主会话：主会话轮次进行中出现原生审批面板；轮次已结束则弹出交互式审批卡片。没有人作答或服务不可用时一律拒绝（fail-closed）。
- 五种策略按 Agent 在统一设置页独立配置：`main-session`（主会话审批）、`human`（人工审批卡片）、`allow`（允许所有）、`reject`（拒绝所有，0.8.x 的 Kimi/agy 默认，旧保存值继续有效）、`subagent`（子代理控制，含 `auto` / `full-access` / `ask-request` 三个等级；agy 的 `full-access` 会追加其原生 `--dangerously-skip-permissions` 参数）。
- 批准操作可能允许写文件、执行命令及访问 CLI 自身可访问的内容。这些策略**都不是操作系统级沙箱**，也不保证 CLI 的所有行为都会请求权限。敏感工作应使用独立工作目录、容器或其它隔离方式。
- Codex 在主会话审批 / 人工审批 / 允许所有策略下以 on-request 线程运行（workspace-write 沙箱、无自动审查器），真实升级请求才会到达送审；拒绝所有与子代理控制 `auto` 沿用其 `permissionMode`（默认 `approve-for-me` 自动审查）。
- DSH、Codex、Kimi、agy 使用各自的模型配置、登录和计费。多个 Agent 并行可能同时消耗额度。
- 父 DSH 的权限设置不等于所有外部 CLI 自动继承相同权限。安装本插件不代表授予所有后续操作无限权限。

本包不包含分享者的账号、密钥、会话历史、任务报告、备份或 node_modules。首次安装仍会从配置的包仓库下载 npm 依赖；它不是离线全依赖包。

## 五、安装后检查

1. 插件管理器未显示加载失败；设置页可打开。
2. 在 DSH 原生右侧栏的开始页打开“Agent 任务”，或在新任务派发后查看自动打开的页面。
3. 给 DSH 一个小型只读分析任务，确认派发回执、最终通知和任务状态一致。
4. 按需测试已登录的外部 CLI。若需要写报告，应事先选择自己接受的权限策略，不要为了测试直接关闭所有安全限制。
5. 测试已完成任务的续接，确认沿用原任务，而不是创建另一份会话。

## 六、兼容性与数据提醒

插件沿用 rc.1 / rc.2 双版本兼容层，测试覆盖两版接口及官方固定源码的隔离契约。**这不等于在所有系统、CLI 版本和桌面窗口尺寸上完成了端到端验收；rc.2 桌面完整验收仍有限制。**

DSH rc.2 创建具名子代理后可能写入 rc.1 无法读取的会话记录。升级 DSH 前备份自己的会话存储，不要让两版进程同时读写同一份存储，也不要直接在新版记录上降级。

本项目自有代码以 [MIT 许可证](LICENSE) 发布。第三方版权与许可证见 `THIRD_PARTY_NOTICES.md`；`acp-provider.js`、`lib/codex-run.js`、`lib/provider-process-contract.js`、`lib/dsh-model.js` 和 `lib/json-rpc-line-transport.js` 包含改编自 DeepSeek Harness 的 MIT 代码，其原始声明保留在对应文件内。
