# DSH 多 Agent 派发

把独立任务按自然语言规则派发给 **DSH 自身、Codex、Kimi Code 或 Antigravity（agy）**，并通过 DSH 原生子代理完成通知把结果送回主会话。

## 0.9.2：顶栏多 Agent 设置面板

- 会话顶栏右侧新增“多 Agent 派发”小按钮，点击后在宽敞浮层中完成全部配置，不再进入 DSH 设置页。
- 面板按“全部”“模型与思考强度”“派发策略与规则”“运行参数”分组，保留 DSH、Codex、Kimi Code 与 Antigravity（agy）的模型、路由、权限和运行配置。
- 保留四个 Config namespace 的独立 revision / CAS 保存与部分失败处理；支持未保存关闭确认、Escape、遮罩关闭、焦点圈定和中英文界面。
- 原 DSH 设置页入口已移除；已有配置值保持不变，无需手工迁移。

### 0.9.0：子代理权限申请（主会话审批）

子代理的权限申请不再一律拒绝。每个 Agent（Kimi、agy、Codex）都有独立的"子代理权限请求策略"，默认 **主会话审批**：

- **主会话审批（默认）**：权限申请送入派发它的主会话审批链，Web 端在主会话对话中出现原生审批面板；主会话轮次已结束、审批链无可用应答器或审批服务异常时，自动降级为交互式审批卡片，两条通道都无人应答时拒绝（fail-closed），任务不会被静默卡死。主会话审批策略为 `never` 时按其语义拒绝。
- **人工审批**：每次权限申请都弹出交互式审批卡片（允许一次 / 始终允许 / 拒绝），不经过主会话审批链。
- **允许所有**：自动批准全部申请。
- **拒绝所有**：自动拒绝全部申请（0.8.x 分享版的 Kimi/agy 默认行为，旧保存值继续有效）。
- **子代理控制**：走子代理自己的权限体系，按等级适配各后端：
  - `auto`：子代理自动处理。Codex 沿用下方"Codex 权限模式"的线程参数（默认 `approve-for-me` 自动审查；审查升级仍无人值守时拒绝；设为 `never` 或 bypass 时按该模式运行）；ACP 子代理按其内部规则过滤后提出的申请自动接受（仅单次授权）。
  - `full access`：完全访问。Codex 使用 bypass 线程模式；agy 追加原生 `--dangerously-skip-permissions`；Kimi 的 acp 子命令没有公开的跳过参数，按自动允许全部申请实现（文档如实标注）。
  - `ask request`：逐次询问。Codex 以 on-request 线程运行（无自动审查器），每次升级连同 ACP 的每次申请都送主会话审批链。

Codex 在主会话审批 / 人工审批 / 允许所有策略下使用新的 ask-request 线程参数（`approvalPolicy: on-request` + `sandbox: workspace-write`、无自动审查器），因此真实的权限事件会到达本插件并按策略送审；批准时命令/文件申请返回 `accept`，权限升级回显所申请的权限。Kimi 与 agy 的 ACP `session/request_permission` 同样按策略决定：一次授权只选 `allow_once`（子代理未提供时拒绝，绝不扩大授权），持续授权仅出现在用户选择"始终允许"或 `full-access` 等级且子代理提供 `allow_always` 时；拒绝优先回选子代理提供的 `reject_once` 选项，未提供才按取消返回。审批卡片会解析出具体操作——命令（`command:`）、目标路径（`path:`）和内容预览（`content:`），并兼容 Kimi（动作写在 `content` 文本块）与 agy（`kind` / `locations` / `diff` / `rawInput`）两种载荷；缺少 `kind` 时按工具名推断类别，中文任务显示中文类别（如“子代理权限请求（写入文件）”）。权限申请与结果会以活动条目显示在任务面板；所有未决路径 fail-closed（拒绝），运行取消后迟到的批准一律作废。

**升级说明：** 从 0.8.x 升级后，未改动过策略的安装默认从 `reject`（Kimi/agy）或自动审查（Codex `approve-for-me`）变为主会话审批——这是收紧交互而非放权（不再自动放行的同时也不会自动拒绝，改由主会话决定）；如需保持旧行为，在设置中把策略改为 `reject` 即可。已保存的 `allow` / `reject` 值不受影响。

### 0.8.8：原生任务面板与 Windows 兼容

任务面板改用 DSH 自带的右侧栏页面注册、开始页入口和文件预览，不再要求安装第三方 Better Sidebar。任务列表、活动流水、历史、续接和报告查看保留；原生导航参数传递父会话与子任务，后台会话不会误开到当前页面。

### 0.8.7：宿主依赖隔离与 Windows 兼容

0.8.6 的 Windows 适配仍把 rc.1 Host Provider 包作为普通依赖，可能在全新 profile 中遮蔽 DSH 自带实现，导致 `subagents` 及标准/PTC/创造模式无法启动。0.8.7 移除了这些生产依赖：ACP 使用纯 SDK，Codex 使用纯协议传输与原生 Codex 包，所需进程辅助代码保留在插件内部。Cordis 仅作为宿主 peer，不再随插件重复安装。

### 0.8.6：CLI 自动检测与手动覆盖

统一设置页为 Codex、Kimi Code、Antigravity 提供 CLI 路径输入。留空使用自动检测；手动填写优先使用用户配置，清空已保存的覆盖可恢复自动检测。

- Codex 按“手动路径 → 检测到的原生 CLI → 依赖包内的原生 Codex”选择，模型目录与实际 app-server 使用同一命令；仅在兼容回退中使用官方 JavaScript wrapper，并显式设置 Electron 的 Node 模式。
- Kimi / agy 手动路径同时用于模型目录与 ACP 任务，不再被独立的自动检测门禁误拦；目录查询继承对应 Provider 的环境覆盖。
- 保留 0.8.4 的 Windows 原生 CLI 检测、Provider 启动等待和 Codex 局部 helper 修复。

Windows 下请填写实际原生程序（通常为 `.exe`）的绝对路径。当前没有 Windows 实机端到端验收，模型目录读取仍需在目标环境验证。

本版修复 Windows 外部 CLI 可用性检测，并消除三个 Provider 的启动时序竞态：

- 支持原生 `.exe` / `.com`、Windows PATH 和官方安装目录；不把 `.cmd` / `.bat` 当作 DSH 可直接启动的原生程序。
- Codex 检查 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`；Kimi 检查当前用户的 `.kimi-code\bin`；agy 检查 `%LOCALAPPDATA%\agy\bin`。
- 三个 Provider 通过 Cordis 注入等待可用性服务，不再在服务未就绪时用动态 `disabled` 表达式跳过挂载。
- 保留 0.8.3 的 Codex 局部 helper 导入修复；不改模型授权、用户路由或权限默认。
- `.cmd` / `.bat` / JavaScript / PowerShell shim 会在 Windows 启动前给出明确错误，不进入无 shell 的 `CreateProcess`；重复 `Path` / `PATH` 键和带引号的 PATH 目录按确定规则处理。
- ACP 目录探测同时观察进程退出，启动失败立即返回并回收子进程；续接工作区按目录身份比较，不再仅比较路径字符串。
- 任务 Markdown 链接支持 Windows 盘符、反斜杠 UNC 与 `file:///C:/...`，旧完成通知可识别盘符报告路径；危险协议和 `//host/...` 仍按原安全规则拒绝。

当前 macOS 上完成了模拟 Windows 路径、真实 Loader 生命周期和完整回归验证。实际 Windows CLI 的模型目录读取仍应在接收者电脑验收，不能把模拟路径测试描述为 Windows 端到端通过。

这是 `dsh-multi-agent` 0.9.2 的发布说明。源码与安装包发布在 [GitHub 仓库](https://github.com/kiritoko1029/dsh-multi-agent)，安装包从 [Releases](https://github.com/kiritoko1029/dsh-multi-agent/releases) 下载，未发布到 npm。首次安装请先阅读 [安装与安全说明](INSTALL.zh.md)，版本变更见 [更新日志](CHANGELOG.md)。

- Kimi / agy 命令从接收者自己的用户目录与 PATH 检测，不含打包者的本机路径。
- Kimi / agy 新安装默认 `permission: main-session`：权限申请送主会话审批；0.8.x 保存的 `allow` / `reject` 值继续有效。批准操作可能允许写文件与执行命令，这不是操作系统级只读沙箱。
- 不包含账号、密钥、会话、任务报告、备份或 node_modules；安装依赖需要联网。
- 任务面板使用 DSH 原生右侧栏与文件预览，无需安装第三方侧栏扩展。
- macOS 是当前验证平台；Linux / Windows 未作实机安装和 CLI 执行验收，不承诺跨平台即装即用。

## DSH 版本兼容（继承 0.8.1）

同一份插件面向 **DSH `0.2.2-rc.1` / `0.2.2-rc.2` / `0.2.2-rc.3`**，无需手工切换模式。兼容层根据注入的 Host 服务能力选择接口，而非根据插件目录中依赖包的版本推测 Host；不识别或混合的接口组合会拒绝启动，不在派发失败后换参数格式重试，避免重复创建任务。

- rc.1 保留 `agents.roots()` 与嵌套 `request` 的 activation 契约；rc.2 使用精确存活 Agent／子代理树根判定和顶层 activation 参数。新派发与外部续接共用此适配边界。
- rc.1 的持续协作例外仍使用 `spawn_teammate`；rc.2 不再提示或声明该工具，持续协作成员通过 `dispatch_agent(agent: "dsh")` 创建，再使用原生消息与已启用的 Team 任务板。两版均保留 `subagent_fork` 上下文继承例外。
- rc.2 显式指定 `provider/model` 而未给 `reasoning_effort` 时使用模型默认强度；显式给 effort 必须同时提供完整 route。rc.1 保留既有选型行为。配置默认值与单次显式覆盖分别处理，模型授权检查不放宽。
- 超时控制当前执行，不承诺跨版本递归终止全部后代。尤其 rc.2 的 `dispose()` 仅释放当前 activation；不会通过关闭主会话整棵树误杀其他并行任务。
- rc.1 保留按 `turn/end` 结算的行为；rc.2 按配对的 `subagent/start/end` residency 结算。当前轮完成不提前开放续接，旧运行的迟到结果不能覆盖新续接。已接收的原生任务到期后若未确认停止，显示超时错误并禁止续接/清理，待同一运行的权威终态确认；不把“已请求取消”当成“已停止”。启动未接收的续接失败仍恢复前一终态。
- 完成卡片兼容旧通知和 rc.2 的 `stopReason`。未找到本地任务时保留原通知、停止原因和报告入口，不显示误导性的任务详情按钮。
- 三个官方 Subagent 依赖仍固定为 rc.1 的 Provider/helper 基线；它们不替换注入的 Host 服务。此轮不盲目升级依赖或扩大到未验证的 DSH 版本，版本准入由 `engines.dsh` 明确限定。

**升级安全：** 插件双版本兼容不等于 DSH 会话日志可降级。rc.2 创建具名子代理后会写入旧版无法读取的目录记录；升级前备份会话存储，不要让 rc.1 与 rc.2 同时访问同一份存储，也不要在新日志上直接降级。已有路由配置、报告路径和任务身份无需手工重置。

## 设计

```text
主 Agent
  │ dispatch_agent(description, task, expected_output, agent?, report_path?)
  ▼
路由层（本插件）
  ├─ 按设置中的自然语言规则选择 Agent
  ├─ 歧义时或始终询问用户（可配置）
  └─ 组装自包含任务契约
  ▼
DSH Subagent Manager
  ├─ dsh       → 原生 spawn Provider，支持 provider/model/reasoning effort
  ├─ codex     → 官方 Codex app-server，支持默认模型
  ├─ kimi-code → ACP → kimi acp，session/new 后设置默认模型
  └─ agy       → ACP → agy acp，复用本机登录，设置会话模型与思考强度
  ▼
主会话收到 activation id；完成后收到最终文本 / 报告路径 / 失败诊断
```

- 不 monkey-patch 现有 `subagent`，不复制一套进程和会话管理。
- 向所有可调用 `dispatch_agent` 的主会话注入全局主动派发提示词：面对多步骤或大范围任务，主 Agent 应主动识别并默认派发可独立、可并行、适合专长 Agent 或可隔离上下文的子任务，无需等待用户明确要求；琐碎单步任务仍直接完成，不为凑数量而派发。
- 路由由主 Agent 根据设置中的自然语言规则决策；插件不额外调用分类模型，也不把规则硬编码成关键词评分。
- Kimi Code 使用 ACP，负责初始化、会话创建、模型设置、prompt、取消和权限请求。
- Codex 复用官方 app-server 协议与结果选择逻辑，默认模型在每次启动前读取；未配置时使用 Codex 原生模型配置。
- DSH 自身使用原生 `spawn` Provider。可在路由页设置默认 provider/model/reasoning effort，也可在单次调用中覆盖；模型路由受当前 Session 的授权列表与 LLM 能力校验约束。
- 外部子代理每轮仍由独立 managed activation 执行：完成后可用 `continue_agent` 恢复同一 Codex thread / Kimi 或 agy session 并开始下一轮。运行中暂不追加指令。首次派发仍需自包含；续接会保留子会话自己的上下文，不继承主会话全文。
- 工具只对 root/main Agent 开放。DSH 内部子代理不能继续调用它，从而不会绕过原生派发深度，也不会触发无效的子代理用户问答。
- 父 Session 保留 external child 的归属与终态。已接收的子任务由 DSH 管理，路由组件重载不再立即取消它们；每个任务原有的超时计时和完成回传继续有效。Host 进程退出/崩溃后的续跑不在此保证内。
- 0.4.2 修复了从 `run_code` 派发后任务立即中止的问题，并补齐交接竞争处理：调用方取消信号只控制启动阶段，接收成功后解除监听，避免 PTC 正常结束时的清理误杀后台任务。是否已接收由 DSH 管理器裁决；返回成功的 activation 不再因交接瞬间的调用方取消而被销毁。任务超时独立计时，不会被启动取消状态屏蔽；接收后的父子中断遵循 DSH 原生管理机制。

## 普通派发与原生例外

独立的“派发路由约束”组件在 root 会话中执行以下规则：

- 普通新任务统一使用 `dispatch_agent`，包括分配给 DSH 自身的任务。直接调用 `subagent` / `subagent_codex` 会在创建子任务之前被拒绝，并提示正确入口。
- rc.1 中，只有确需持续成员协作或继承已完成对话时，先调用 `declare_delegate_exception`，再在下一步调用 `spawn_teammate` 或 `subagent_fork`。rc.2 中，持续协作改走 `dispatch_agent(agent: "dsh")`；例外仅用于继承已完成上下文的 `subagent_fork`。
- 例外必须填写闭合的 `purpose`、具体 `reason`，以及与原生调用完全一致的 `description`；一次声明只允许本轮的一次匹配尝试，失败也会消费。声明记录由会话日志重放，不能跨会话或 Fork 继承复用。
- 已有成员/子代理的 `send_message`、等待、中断、查询和任务看板操作不受影响。不要为了并行普通任务而创建 Team。
- 非 root 子代理不受此策略阻塞；当前工具集中没有本插件的 `dispatch_agent` 时放行原生派发。这是派发工作流约束，不是权限安全边界，不改变审批、沙箱和模型授权。

例外示例：

```json
{
  "tool": "subagent_fork",
  "purpose": "context_inheritance",
  "description": "复核既有决策",
  "reason": "需要继承本会话已完成轮次中的设计讨论，完整搬运这些上下文会造成大量重复。"
}
```

声明成功后调用原生 `subagent_fork`，并使用相同的 `description`。仅在 rc.1 中，`spawn_teammate` 对应的 `purpose` 为 `ongoing_collaboration`；rc.2 不提供该例外。

## 前置条件

1. 使用 DSH `0.2.2-rc.1`、`0.2.2-rc.2` 或 `0.2.2-rc.3`，在自己的 DSH 中配置可用模型。只有使用外部 Agent 时才需要对应 CLI；不必把全部 CLI 装齐。
2. 使用 Codex 时，在本机安装并登录 Codex CLI。本插件独立注册 `codex-router` Provider，不要求启用官方 Codex 工具 bundle。
3. 使用 Kimi 时，在本机安装并登录新版 Kimi Code CLI。优先检测当前用户的 `~/.kimi-code/bin/kimi`，然后搜索 PATH；可用 `KIMI_COMMAND` 覆盖检测路径。
4. 使用 Antigravity 时，在本机安装并登录 `agy`，通过 `agy --version` 和 `agy acp --help` 检查。优先检测当前用户的 `~/.local/bin/agy`，然后搜索 PATH；可用 `AGY_COMMAND` 覆盖检测路径。
5. 可视任务面板使用 DSH 原生右侧栏；无外部侧栏依赖。
6. Codex、Kimi Code 和 agy 使用各自原生的认证和项目配置；DSH 子代理使用当前 DSH 的模型与工具组合。本插件不复制或保存 API Key。

参考文档：

- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Kimi Code `kimi` 命令](https://www.kimi.com/code/docs/kimi-code-cli/reference/kimi-command.html)
- [Kimi Code `kimi acp`](https://www.kimi.com/code/docs/kimi-code-cli/reference/kimi-acp.html)
- [Antigravity ACP](https://antigravity.google/docs/ide/extensions/acp/)
- [Antigravity CLI 命令](https://antigravity.google/docs/cli/reference/)

## 设置

打开会话顶栏右侧的 **多 Agent 派发** 小按钮，在弹出的宽敞面板中完成全部配置。三个组件的配置统一迁移到这个入口，DSH 设置页与插件详情中的独立配置入口不再提供这些字段（组件启停仍由插件管理器负责）。面板按“模型与思考强度”“派发策略与规则”“运行参数”分组，集中配置 DSH、Codex、Kimi 和 Antigravity（agy）。

底层保留原有三个配置项及其保存值，无需重填或手工迁移。统一“保存更改”逐项调用 DSH 原生配置通道，每项均带 revision 冲突保护；这些写入不是跨组件事务。部分保存失败时保留失败项的编辑，不重复提交已成功的项。更改应用于后续派发，已运行的任务不受影响。

模型与思考强度均可从建议列表选择，也可手动输入。选项来自所选模型的目录；切换模型会清空旧强度覆盖值。留空表示继承原生默认值。不可用 Provider 的区域显示禁用状态，不影响 DSH 设置保存。

模型目录读取失败时可点击重试，或直接手动输入模型；不会因目录不可用而清空已有配置或阻止保存。

### Multi-agent router / 多 Agent 派发

- `selectionMode`
  - `auto`：主 Agent 按路由规则给出 `agent`；未选择时使用 `defaultAgent`，未配置默认值则报错，不会静默乱派。
  - `ask-if-ambiguous`：明确匹配时自动执行，未给出 `agent` 时弹出选择。
  - `always-ask`：主 Agent 可以推荐，但每次由用户最终选择。
- `defaultAgent`：可选的自动路由兜底 Agent。
- `routes`：表单中可增删的 `Agent + 提示词` 规则行，直接用自然语言描述哪类任务适合哪个 Agent。
- `additionalInstructions`：补充路由偏好，例如“用户明确点名时优先”。
- `taskPreamble`：附加到每个子任务的通用要求，例如代码规范或回复语言。
- `timeoutSeconds`：单次任务墙钟超时，默认 1800 秒，覆盖启动握手与执行阶段；超时由 DSH 取消 activation，并按 `aborted` 结算，不是 CLI 退出码。
- `dsh.defaultProvider` / `dsh.defaultModel`：位于“模型与思考强度”分组的 DSH 默认模型路由；留空继承主会话。通过 `remote.session.modelCatalog()` 读取实际 provider/model 建议，provider 变化时过滤模型列表，也可手动输入。
- `dsh.defaultReasoningEffort`：DSH 子代理默认推理强度；选中模型后显示该模型实际支持的 effort 建议，留空使用模型默认值。

高级字段 `codex` / `kimiCode` / `agy` / `dsh`（Provider 名、显示名、说明和启用状态）保留在 Cordis 配置中，默认分别绑定 `codex-router`、`kimi-code`、`agy` 与 `spawn`，一般无需修改。

### Codex Provider

- `model`：位于顶栏“多 Agent 派发”面板顶部的默认 Codex 模型；通过可用性检测到的本机当前 Codex CLI 执行 `debug models`（不使用 `--bundled` 静态快照），读取与交互 `/models` 一致的公开模型（`visibility: list`），可下拉选择或手动输入；留空使用 Codex 原生配置，后续每次启动都会读取最新值。
- `reasoningEffort`：默认思考强度；建议取自 Codex 目录的 `supported_reasoning_levels`，执行时明确发送到 app-server 的 `turn/start.effort`。留空时不覆盖原生默认值。
- `permissionPolicy`：子代理权限请求策略，默认 `main-session`。主会话审批 / 人工审批 / 允许所有时线程使用 ask-request 参数（无自动审查器），真实升级请求按策略决定；拒绝所有与子代理控制的 `auto` 沿用下方 `permissionMode`。
- `subagentPermissionMode`：子代理控制等级（`auto` / `full-access` / `ask-request`），仅策略为 `subagent` 时生效，映射到 Codex 原生线程模式。
- `permissionMode`：Codex 原生线程权限模式，默认 `approve-for-me`（自动审查 + workspace-write）；策略为拒绝所有或子代理控制 auto 时直接作为线程模式使用。
- `env`：Codex 子进程环境覆盖。
- `disposeGraceMs`：进程退出宽限时间。

### Kimi Code ACP

- `model`：位于顶栏“多 Agent 派发”面板顶部的默认 Kimi 模型别名；通过 `kimi provider list --json` 读取实际配置别名与显示名，可下拉选择或手动输入；留空使用 Kimi 原生配置。设置时在 ACP `session/new` 成功后、`session/prompt` 前调用 `session/set_config_option`。

- `reasoningEffort`：默认思考强度；建议取自模型的 `supportEfforts`。模型设置成功后，按会话最新返回的 `thinking` 选项验证并设置强度；不支持的值会在发送任务前报错，不会静默忽略。
- `command` / `args`：默认 `<本机 kimi 路径> acp`。
- `permission`：子代理权限请求策略，默认 `main-session`（主会话审批）。
  - `main-session`：申请送主会话审批链；主会话轮次已结束时降级为交互卡片。
  - `human`：每次申请弹交互式审批卡片。
  - `allow`：自动选择 ACP 返回的首个 `allow_once` / `allow_always` 选项。
  - `reject`：拒绝子代理发出的权限请求（0.8.x 默认），可能导致报告写入或任务执行失败。
  - `subagent`：子代理控制，配合 `subagentPermissionMode` 等级（`auto` 接受其内部规则过滤后的申请；`full-access` 自动允许全部——kimi acp 没有公开的跳过参数；`ask-request` 逐次送主会话审批）。
- `subagentPermissionMode`：子代理控制等级，仅 `permission: subagent` 时生效。
- `env`：显式子进程环境覆盖。不要在这里填写不再需要的密钥；子 Agent 原生认证通常已经足够。
- `disposeEofGraceMs` / `disposeGraceMs`：进程退出与强制终止的宽限时间。

### Antigravity（agy）ACP（0.7.0）

在顶栏“多 Agent 派发”面板配置 **Antigravity（agy）**。它有独立的模型、思考强度和运行参数，不会覆盖 Kimi 的 ACP 配置。

- `command` / `args`：使用本机自动检测到的 agy 路径和 `["acp"]`；可在顶栏面板中修改命令，特殊安装位置需同步设置 `AGY_COMMAND`，供 DSH 启动时检测。
- `model` / `reasoningEffort`：留空沿用原生默认值；指定后通过 ACP 会话配置设置。思考强度使用 agy 的 `thought_level`，与 Kimi 的 `thinking` 分开处理。不要把普通 CLI 的 `--model` / `--effort` 直接追加到 `agy acp` 参数。
- 模型建议来自 `GET /multi-agent/model-catalog/agy`：通过短暂 ACP 会话读取实际模型族及各模型支持的强度，15 秒超时并回收进程，不执行任务 prompt。不要把 `agy models` 中带强度后缀的组合 ID 当作模型族填写。可选模型以当前账号和 ACP 返回值为准。
- `permission`：子代理权限请求策略，默认 `main-session`（主会话审批），选项与 Kimi 相同（`main-session` / `human` / `allow` / `reject` / `subagent`）。
- `subagentPermissionMode`：子代理控制等级。agy 与 Kimi 的差异在 `full-access`：agy 会追加原生 `--dangerously-skip-permissions` 启动参数，彻底交由其内部权限体系；其余等级语义一致。
- `env` 与退出宽限参数：语义与 Kimi ACP 相同；已有登录无需额外填写密钥。
- 可在路由规则、默认 Agent 中选择 `agy`，或直接调用 `dispatch_agent` 并指定 `agent: "agy"`。结果、工具活动和报告进入同一任务面板。
- 完成后的任务通过 `continue_agent` 复用原 ACP 会话。agy 使用 `session/load` 检查原用户或助手历史是否存在；缺少加载能力或历史为空时在发送新任务前拒绝，不静默新建会话。原生数据库锁等原因可能导致 CLI 未保存历史，适配器不会修复或改写 CLI 数据库。历史回放不混入当前任务正文。

```json
{
  "description": "用 Antigravity 检查实现",
  "agent": "agy",
  "language": "zh-CN",
  "task": "检查当前工作区的实现，指出具体问题并说明验证方法。",
  "expected_output": "中文审查结论、相关文件位置和验证结果。"
}
```

## 本机可用性与回退

- 插件挂载时检测本机原生 `codex`、`kimi` 与 `agy`。Kimi / agy 没有检测到命令且未手动配置时不注册 Provider；Codex 还可使用依赖包内的原生二进制，不再要求 PATH 中必须存在外部命令。
- 可用 `CODEX_COMMAND`、`KIMI_COMMAND`、`AGY_COMMAND` 指定检测路径；也可在顶栏“多 Agent 派发”面板手动覆盖。Kimi 默认检测 `~/.kimi-code/bin/kimi`，agy 在 POSIX 检测 `~/.local/bin/agy`、在 Windows 检测 `%LOCALAPPDATA%\agy\bin\agy.exe`。手动命令与 Provider `env` 同时用于目录查询和任务。
- 运行期间若选中的 Codex/Kimi/agy Provider 不可用，`dispatch_agent` 自动回退到本机 DSH，并在结果中返回 `route: "fallback"`；不会把外部 Agent 不可用静默当成任务成功。
- DSH 子代理不依赖外部 CLI，始终作为本机兜底。模型选择仍遵守当前 Session 的模型授权和能力校验。
- 新安装外部 CLI 后需要重载插件或重启 DSH，让 Loader 重新计算组件可用性。

**安全边界：** Kimi 和 agy 非交互任务可以写文件、执行 Shell。任何批准类策略（主会话审批中点了允许、人工审批、允许所有、子代理控制）都可能批准这些操作，且都不是操作系统沙箱；请只在受信任工作区使用。需要隔离时使用独立 worktree、容器或操作系统沙箱，不要仅靠提示词声明“只读”。

## 主 Agent 调用契约

`dispatch_agent` 参数：

| 参数 | 必填 | 含义 |
|---|---|---|
| `description` | 是 | 使用主会话语言的简短任务标题 |
| `language` | 否 | 主会话语言，例如 `zh-CN`、`en`。全局提示要求每次显式传入；省略时取最近真实用户消息的有界语言线索，约束子任务进度、最终回复及报告 |
| `task` | 是 | 完整目标、要做的工作、约束和相关路径 |
| `expected_output` | 是 | 主会话需要的准确返回内容 |
| `agent` | 否 | `dsh`、`codex`、`kimi-code` 或 `agy`；按选择模式可省略或作为推荐 |
| `provider` + `model` | 否 | 仅 DSH：单次覆盖模型路由，必须同时提供并通过 Session 授权与能力校验 |
| `reasoning_effort` | 否 | 仅 DSH：单次覆盖推理强度 |
| `context` | 否 | 背景、已有发现、依赖，避免子代理重复探索 |
| `report_path` | 否 | 自定义报告路径；相对路径基于子任务 cwd。缺省自动使用固定目录 `.dsh/agent-reports/` 下的唯一 Markdown 文件 |
| `cwd` | 否 | 子任务初始目录，缺省继承主会话 |
| `route_reason` | 否 | 简短路由理由 |

示例：

```json
{
  "description": "修复解析器回归",
  "agent": "codex",
  "task": "定位并修复 parser 在空输入上的回归，补充边界测试并运行相关测试。",
  "context": "回归出现在上次 tokenizer 重构之后；不要修改公开 API。",
  "expected_output": "返回根因、修改文件、测试命令和结果；若有遗留风险单独列出。"
}
```

DSH 子代理指定模型示例：

```json
{
  "description": "审查解析器改动",
  "agent": "dsh",
  "provider": "magpie",
  "model": "kimi/k3.1-pro",
  "reasoning_effort": "highspeed",
  "task": "使用 DSH 原生工具审查当前工作区的解析器改动并运行相关测试。",
  "expected_output": "返回问题列表、验证结果和报告路径。"
}
```

### 报告存放位置

每次派发都会生成一个默认报告路径：

```text
<子任务工作区>/.dsh/agent-reports/<UTC时间>-<任务名>-<唯一id>.md
```

例如：`/path/to/project/.dsh/agent-reports/20261110T012345Z-fix-parser-a1b2c3d4.md`。

- 每次任务使用独立文件，避免并行覆盖。
- 子代理收到该绝对路径，必须实际写入报告，并在最终回复中给出准确路径。
- 启动工具结果也包含 `reportPath`，主会话完成后可以直接读取。
- 显式传入 `report_path` 时才覆盖默认位置；相对路径基于子任务 cwd。
- 报告由子代理写入；启动成功不代表文件已存在，失败或取消时要以完成通知和文件实际状态为准。

子代理的最终回复必须直接满足 `expected_output`。主会话需要报告细节时应读取该文件，而不是把路径当作报告内容。

## 并行与结果

独立任务可以在同一 assistant 消息中多次调用 `dispatch_agent`。工具调用本身只返回：

```text
started codex subagent <childId>
Report path: <absolute-report-path>
```

最终答案通过后续 DSH completion notice 回到主会话。只有等待结果时，主 Agent 应结束当前 turn，不要轮询或睡眠。

## 任务标签面板与完成卡片（0.5.1）

派发新的 Codex/Kimi/agy 任务后，当前主会话的原生右侧栏会自动打开 **Agent 任务** 面板；也可以从开始页的 Agent 任务入口打开。界面使用 DSH 原生页面与文件预览，原生 Team 任务面板仍保留。后台会话的新任务不会误开到当前页面。

- 每个子任务独占一个标签页，按创建时间倒序排列，最新任务在前；标签及任务标题区显示本地日期和时间，不显示“创建时间”文字前缀，耗时仍保留。同一 Agent 的多次派发分别展示，支持键盘切换，完成通知可定位对应标签。
- 0.7.0 起，子任务正文按连续消息流完整展示，不再逐条使用卡片、消息标签或摘要/全文两层展示。相邻工具活动按发生顺序分组，穿插在正文之间，默认折叠为紧凑列表；工具输出可进一步展开，展开时不强制跟随滚动。与最后一条正文完全相同的最终结果不重复展示。
- 0.7.1 修复连续正文显示 Markdown 源码的问题：消息和最终结果统一渲染标题、强调、列表、引用、表格、代码块及链接。文件链接点击后使用当前任务工作区和父会话的文件查看入口；代码与原始 HTML 按文本显示，危险链接不会执行，图片不自动加载。Markdown 解析器随 Client bundle 本地打包，不访问 CDN。
- 新派发的任务标题沿用主会话语言；子任务的进度消息、最终回复和报告也遵守传入的语言约束。保留代码、路径和专有名词，尊重明确指定的交付物语言。已有英文标题和报告不自动翻译。
- 每个子任务独立记录阅读位置及自动跟随状态。在消息区底部时，新消息、已有消息追加内容或最终输出更新会自动跟随；向上滚动暂停，回到底部恢复，也可点击向下箭头回到最新。不显示底部“正在跟随”或“已暂停跟随”状态条。
- 切换标签后保留各任务阅读位置；刷新任务列表和新任务出现不会强制切走当前标签。消息到来时不会为了保持固定条数而主动移除正在阅读的内容。
- Codex 记录已完成的正文消息和工具项；Kimi 和 agy 记录 ACP 正文片段、工具开始及更新。不会展示或编造内部推理，也不把这些活动自动塞入主模型上下文。
- 完成通知以任务卡片展示，提供“打开任务面板”“查看报告”和原始通知全文；点击面板入口会选中对应子任务标签。
- 报告按钮调用原生文件查看功能。没有监控记录的旧通知，会将其中明确的 `.dsh/agent-reports/` 绝对 Markdown 路径提供为“查看报告（来自原通知）”，不宣称已核验文件存在。
- 关闭/隐藏面板会停止列表刷新；只有当前选中的可见子任务读取详细活动，没有可显示的当前会话时不强行打开。
- 主模型可用 `agent_tasks` 查询自己派发的任务状态与活动，不能查询其他主会话。

0.6.0 起，任务摘要、归档状态、输出与真实外部会话引用保存在 DSH 原生存储域 `multi_agent_task_history`，不保存凭据。进程重启时，未结束的记录标为已中断并归档，等待明确续接，不会自动重跑。活动流水仍仅保存在当前 Host 内存中：每任务最多 500 项活动、256K 字符活动正文，单条正文最多 16K 字符；恢复后的历史可查看摘要、报告和续接能力，不能补录之前的流水。最多保留 200 条任务记录，运行中的任务不因达到数量限制被淘汰；超过上限时最早终态记录会被淘汰。

更新时使用保持启用状态的 profile 增量协调，不再采用关闭整个 bundle 后重开的方式。路由组件卸载不取消已接收任务，原有 deadline 继续执行；Host 重启仍会终止进程。本地 Client 源码改动后先运行 `node scripts/build-client.mjs` 生成合并入口，再协调加载。

## 模型与 token 用量（0.8.0）

任务详情标题区显示模型、思考强度及 token 用量，历史详情使用同一信息区，不给每条消息增加卡片。

- 模型和思考强度优先取后端返回的实际值；只能获得请求配置时明确标为“配置”，不是运行结果确认。没有数据时显示“未提供”，不猜测默认模型或强度。
- Token 只展示后端提供的消耗数据，不用文本长度估算，不把上下文窗口占用冒充消耗。未提供与真实的 `0` 分开处理。
- 优先展示报告的总量；只在输入与输出两项均已知时相加计算总量。缓存和思考 token 如有明细单独展示，不再重复加到总数。
- 标签区分任务累计、会话和本轮用量，避免把不同统计口径混为一谈。续接沿用同一逻辑任务，重复累计通知不重复加总。
- 旧任务可能没有新字段；不会根据当前全局设置补造历史模型或 token 数。采集能力取决于当前 CLI / ACP 协议实际返回的数据。
- DSH 从自身子会话事件记录模型、思考强度及真实 usage，按事件序号去重。Codex 使用 `thread/tokenUsage/updated.tokenUsage.total` 的线程累计快照，标为“会话 Token”，重复快照不累加；不将 `last` 猜成整轮用量。
- Kimi/agy 从 ACP 会话配置读取模型和思考强度；只有 prompt 响应包含 `usage` 才显示消耗。`usage_update.used/size` 表示上下文窗口占用，不计作消耗；未提供实验性 usage 的 CLI 仍会显示“—”。

## 历史归档、清理与续接（0.6.0）

- 已完成、已中止和错误任务自动归档。0.6.1 起，顶部“历史任务”入口打开独立的历史视图，列表独立滚动，不与当前任务消息区上下叠放；查看历史详情时收起列表，并可返回先前活动任务、恢复阅读位置。正在查看的任务结束时保留详情，不会自动打开历史列表。历史提供查看、恢复到活动标签和清理；恢复标签本身不会启动模型。
- 清理只从面板列表隐藏终态任务并释放活动流水，保留磁盘报告和底层会话。主 Agent 可按仍保留的逻辑 childId 查询、恢复或续接；清理不等同于删除会话，历史上限淘汰的记录不保证仍可通过本插件访问。
- 面板“继续指挥”或主 Agent 的 `continue_agent({ childId, message, expected_output?, language? })` 调用同一业务入口。续接开始后回到活动区，下一轮结束再次归档。只允许本父会话的终态任务，拒绝重复并发续接。
- DSH：通过原生 `sendMessage` 唤起同一子会话。Codex：新任务使用持久 thread，后续 `thread/resume` 复用它。Kimi：按能力优先 `session/resume`，兼容 `session/load`。agy：使用 `session/load` 确认保存的历史存在；两者均屏蔽旧消息回放。
- 外部续接会创建新的 managed activation，但面板保持同一个逻辑任务，通过内部别名关联各轮；不能把新 conversation 当成旧会话复用。缺失原始 ID、远端历史已被删除、能力不支持或工作区不匹配时直接报错，不静默重新派发。
- 升级前的 Codex 临时线程不落盘、Kimi 原始 ID 未记录；这些旧任务无法通过本插件可靠恢复。新持久记录才提供外部续接能力。外部恢复沿用原工作区和模型，当前审批策略仍逐轮执行。
- 0.6.0 修复历史存储单元名称不合规范与初始化拒绝未及时捕获造成的 Host 崩溃。初始化失败时显示明确不可用错误并阻止任务操作；不删除或重置损坏数据，卸载失败也不会形成未处理拒绝。
- 报告和完成通知保留，超时与取消不回滚已发生的文件修改或外部副作用；跨 Host 同时续接的分布式锁、运行中外部 steer 不在当前范围。

## 开发

以下命令供完整开发工作区使用，不是接收者的安装步骤。分享 TGZ 已包含构建产物，但不包含开发测试目录；完整测试需在保留测试的开发工作区运行。首次安装请按 INSTALL.zh.md 使用插件管理器。

```sh
# 本地 link 安装前，先在插件目录安装依赖；不要在 profile 目录执行 pnpm。
pnpm install --ignore-scripts
node scripts/build-client.mjs
node scripts/check.mjs
node --test test/*.test.mjs test/client.test.js

# 可选的真实 agy 验证：使用本机登录，消耗两轮模型请求，验证原会话上下文恢复。
node scripts/smoke-agy.mjs
# 可指定 CLI 路径，也可用 AGY_SMOKE_MODEL / AGY_SMOKE_EFFORT 指定测试模型与强度。
```

### 双版本契约验证

默认 `node --test test/*.test.mjs test/client.test.js` 不联网；未设置上游源码目录时，会明确跳过真实上游矩阵，其余双版本 fixture 测试仍执行。完整矩阵需要 Node 24+（使用内置 TypeScript 去类型 API）及两份官方固定版本源码：

```sh
node scripts/verify-runtime-contracts.mjs \
  --rc1-source /path/to/rc1-source \
  --rc2-source /path/to/rc2-source

# 同时将真实上游矩阵纳入完整回归，不跳过该项：
DSH_RC1_SOURCE=/path/to/rc1-source \
DSH_RC2_SOURCE=/path/to/rc2-source \
node --test test/*.test.mjs test/client.test.js
```

脚本会校验使用文件的固定 SHA-256，分别执行两版官方的 AgentRegistry、startActivation 和外部启动管理器方法，检查错误形状对照、参数保持、精确身份、取消、provider 变更和不重试。无参数时查看 `node scripts/verify-runtime-contracts.mjs --help`。脚本不自动下载、不安装依赖、不调用模型。

验证边界：这是“真实上游方法 + 明确的资源/Session/provider 替身”的隔离契约验证，不是完整 Cordis Host 或 rc.2 桌面端到端验收。0.8.1 开发验证已包含完整回归和两版源码矩阵；真实 CLI、原生页面注册与桌面渲染仍以对应运行环境中的实际操作为准。

本地链接包更新后需要由 Plugin Manager 协调重新加载。以返回的 `application` 和 `nextStep` 为准：`applied` 后仍需验证实际任务；`restart-required` 表示新代码需重启 DSH 才会加载，不能将磁盘版本更新说成正在运行的新版本。若返回 `failed to import`，先排查 Host 导入错误。前端源码修改后需重建 Client bundle；浏览器页面刷新本身不会重启 Host。
