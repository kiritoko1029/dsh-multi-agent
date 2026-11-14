# 更新日志

本项目的更新日志遵循 [Keep a Changelog] 风格，版本编号遵循 [语义化版本]。历史条目按现有说明与验证记录整理；无法确认发布日期的版本不标注日期。

## [未发布]

### 新增

- GitHub Release 工作流新增 `publish-npm` 后续任务：新版本标签完成 GitHub Release 后，下载并校验同一份 TGZ 资产，自动发布到 npm 并附加 provenance。
- 使用 npm Trusted Publishing：npm 11.20.0 通过 GitHub OIDC 获取短期发布凭证，不配置或存储 `NPM_TOKEN` 等长期令牌。
- 新增发布校验脚本，绑定标签、checkout 与 TGZ 清单、仓库、Release 构建 SHA-256、侧车和 npm SHA-512 integrity；支持重复运行跳过与发布后有界验证。
- Release 任务增加完整测试门禁，测试通过后才创建 Release 并进入 npm 发布任务。

### 变更

- 包名改为 `@kiritoko1029/dsh-multi-agent`，移除 `private: true`，显式设置公共 npm registry 与 `access: public`；后续 Release TGZ 使用 scoped 包名生成的资产文件名。
- Cordis patch、Client module id 与 locale namespace 同步使用 scoped 包名；包名也是 DSH 插件安装身份，升级时不要同时启用新旧两个包。
- 为配置 Trusted Publisher 创建 `0.9.3-stage.0` 暂存引导版本；该版本未公开，不是稳定插件发行版。现有 0.9.2 及更早版本不追溯发布，首个启用该流程的新版本开始自动发布。

## [0.9.2] - 2026-11-14

### 新增

- 会话顶栏右侧新增“多 Agent 派发”小按钮，通过 `shell.overlay` 打开宽约 1180px、高约 85vh 的设置浮层，并带小屏尺寸约束。
- 面板按“全部”“模型与思考强度”“派发策略与规则”“运行参数”分组，集中管理 DSH、Codex、Kimi Code 和 Antigravity（agy）的模型、思考强度、路由、权限与运行配置。
- 支持未保存修改关闭确认、Escape 与遮罩关闭、焦点圈定和焦点恢复，并提供中英文界面。

### 变更

- 移除 DSH 设置页中的旧“多 Agent 派发”入口；保留四个 Config namespace 的已有配置值、独立 revision / CAS 保存及部分失败处理，无需迁移设置。
- 更新 README、安装与分享文档，统一说明新的顶栏入口。

### 修复

- 使用宿主实际提供的主题 token，以 `color-mix(...)` 和 `--dsw-alias-brand-primary` 替代不存在的 `--dsw-alias-brand-primary-soft`。

### 已知限制

- 主会话设为“不再询问”（`never`）时，走 `main-session` 的子代理审批会按 fail-closed 语义拒绝；当前审批结果未区分策略自动拒绝与用户主动拒绝，本版没有放宽权限或改变该语义。

### 测试

- 新增顶栏 Slot 注册、面板分组、焦点与关闭行为、主题约束及 CAS 保存等 Client 测试。
- `npm run check` 通过；`npm test` 共 371 项，370 通过、0 失败、1 项原有条件跳过；`npm run build` 与 `git diff --check` 通过。

## [0.9.1] - 2026-11-13

### 修复

- 子代理权限申请现在会显示**具体要做什么**：ACP `session/request_permission` 的命令（`command:`）、目标路径（`path:`）和内容预览（`content:`）都会被解析进审批卡片，不再只剩 `Write` / `Bash` 这类工具标题。
- 兼容不同 ACP 实现的信息位置：Kimi Code 只在 `toolCall.content` 的文本块里给出动作说明（没有 `kind`、`rawInput`、`locations`）；agy 则用 `kind`、`locations`、`diff` 内容块和 `rawInput`（`CommandLine` / `Path` / `Content`）。两种载荷都能还原出命令与文件路径。
- 缺少 `kind` 时按工具名或标题推断类别（`Bash` → 执行命令、`Write` → 写入文件等）；中文任务下审批标题显示中文类别（如“子代理权限请求（写入文件）”），不再出现“（unknown）”。

### 测试

- 新增 5 项权限详情测试，夹具取自 Kimi 与 agy 实际 ACP 会话捕获的原始载荷；`npm test` 共 366 项，365 通过、0 失败、1 项原有条件跳过。

## [0.9.0] - 2026-11-13

### 新增

- 为 Codex、Kimi Code 和 Antigravity（agy）分别提供子代理权限请求策略：主会话审批（默认）、人工审批、允许所有、拒绝所有及子代理控制。子代理控制支持 `auto`、`full-access`（完全访问）和 `ask-request`（逐次询问）三级。
- 主会话审批将申请送入派发任务的主会话审批链，在 Web 端显示原生审批面板；轮次已结束、无可用应答器或审批服务异常时，降级为交互式审批卡片。人工审批直接提供“允许一次”“始终允许”“拒绝”选项。
- Kimi 与 agy 的 ACP `session/request_permission` 按所选策略处理；子代理控制的 `auto` 接受其内部规则过滤后提出的单次申请，`ask-request` 将每次申请送主会话审批。Kimi 的 ACP 子命令没有公开的跳过权限参数，其 `full-access` 通过自动允许申请实现。
- Codex 在主会话审批、人工审批、允许所有及子代理控制的 `ask-request` 模式下使用 `approvalPolicy: on-request` 与 `sandbox: workspace-write`，不配置自动审查器，使真实升级请求可送审。子代理控制的 `auto` 沿用配置的原生权限模式，`full-access` 使用绕过审批的线程模式。
- 任务面板新增权限申请与处理结果的活动条目。

### 变更

- **破坏性变更：** 包名由 `@local/dsh-multi-agent` 改为 `dsh-multi-agent`。插件标识、Cordis 补丁组件名、Client 模块标识、设置存储键及任务面板标签页标识随之变化。从 `0.8.x` 升级时，先备份或记录现有设置，在 DSH 插件管理器卸载旧包，再安装新版 TGZ，按管理器提示应用或重启，并核对、按需重新填写设置；不要将新旧包同时安装，也不要假定旧设置键会自动迁移。
- 从 `0.8.x` 升级后，未改过策略的安装默认从 Kimi／agy 的 `reject` 或 Codex 的 `approve-for-me` 自动审查转为主会话审批。这是收紧交互而非放权：申请改由主会话决定；已保存的 `allow`／`reject` 值继续有效。包名迁移后仍需核对这些设置是否已恢复。
- `0.9.0` 为首个 GitHub 发布版本；此前的 `0.8.x` 仅通过本地 TGZ 分享。发布产物为 `dist/dsh-multi-agent-0.9.0.tgz` 及 SHA-256 校验文件，作为 GitHub Release 资产提供；保持 `private: true`，不执行 `npm publish`。

### 安全

- 所有未决路径均采用拒绝策略（`fail-closed`）：主会话审批与交互卡片均无人应答时拒绝，主会话审批策略为 `never` 时按其语义拒绝。
- ACP 一次授权只选择 `allow_once`；子代理未提供该选项时拒绝，绝不扩大为持续授权。持续授权仅在用户选择“始终允许”或使用 `full-access` 等级，且子代理提供 `allow_always` 时出现。
- 拒绝 ACP 请求时优先选择子代理提供的 `reject_once`，未提供时按取消返回；运行取消后迟到的批准一律作废。
- agy 的 `full-access` 使用原生 `--dangerously-skip-permissions`，会跳过其权限确认。批准类策略可能允许写文件和执行命令，不构成操作系统级沙箱，应仅在理解风险的受信任工作区使用。

### 测试

- 新增 20+ 权限场景测试，覆盖主会话审批、人工审批、允许所有、拒绝所有与子代理控制三级，以及 ACP 单次授权、拒绝回选与取消后迟到批准作废。
- 本版发布前验证：`npm run check` 通过；`npm test` 共 361 项，360 通过、0 失败、1 项原有条件跳过。

## [0.8.8]

### 新增

- 使用 DSH 原生右侧栏注册 Agent 任务面板，在开始页提供入口；仅为当前显示的主会话自动打开新外部任务。
- 报告与 Markdown 文件链接使用原生文件预览，支持绝对路径、相对路径、Windows 盘符、UNC、空格和文件 URL，相对路径按子任务工作区解析。

### 变更

- 移除 Better Sidebar 依赖及其页面、文件调用，保留任务列表、活动流水、历史、归档、恢复、清理、续接、Token 信息和完成卡片；面板隐藏时停止相应读取。

### 修复

- 通过原生导航参数传递父会话、子任务及工作区，避免后台会话误开面板；使用导航修订值修复再次打开同一任务时未重新选中的问题。

## [0.8.7]

### 变更

- 从生产依赖中移除三个 DSH Host Provider 包及 `dsh-sdk-protocol`，Cordis 改由宿主提供。
- ACP 直接使用 `@agentclientprotocol/sdk`；Codex 使用插件内的纯 Node JSON-RPC 传输与 `@openai/codex` 原生平台包，必要辅助代码保留在插件内部。

### 修复

- 修复全新配置环境中旧 Host 依赖遮蔽 DSH 自带实现，导致 `subagents` 服务、标准／PTC／创造模式及会话创建失败的问题。

## [0.8.6]

### 变更

- Codex 按“手动命令 → 检测到的原生命令 → 依赖包内原生二进制”选择，模型目录与 `app-server` 共用命令，并支持嵌套平台包解析；JavaScript 包装器兼容回退显式启用 Electron 的 Node 模式。
- 补齐跨平台测试脚本、CRLF 源码校验与 agy 冒烟脚本的平台处理，测试入口不再依赖 POSIX 通配符展开。

### 修复

- 处理 Windows 大小写环境键、重复 `Path`／`PATH` 与带引号的路径目录；启动前明确拒绝 `.cmd`、`.bat`、JavaScript 和 PowerShell 启动脚本。
- 修复 Kimi／agy 手动路径被自动检测门禁误拦、模型目录未继承 Provider 环境的问题，保留命令热更新；ACP 目录探测观察进程退出，启动失败及时返回并清理。
- 续接工作区按真实路径及设备／文件身份比较，避免等价路径被误判；任务 Markdown 与旧完成通知支持 Windows 报告路径，同时保留危险协议与协议相对链接拦截。

## [0.8.5]

### 新增

- 为 Codex、Kimi Code、agy 的统一设置页增加 CLI 路径输入：手动配置优先，留空或清空已保存覆盖可恢复自动检测。

### 变更

- 手动命令同时用于模型目录查询与实际任务；本版 Codex 缺省仍使用官方包内包装器，后续由 `0.8.6` 调整原生命令优先级。
- 未检测到 CLI 时可通过显式路径与配置重载启用 Provider；不可用时保留 DSH 回退。

## [0.8.4]

### 修复

- Windows CLI 检测支持分号分隔的 `PATH`、大小写不敏感环境键和原生 `.exe`／`.com` 候选，不再将 `.cmd`／`.bat` 视作可直接启动的原生程序。
- 补充 Codex、Kimi 与 agy 的 Windows 官方安装位置检测，保留 POSIX 路径规则。
- 三个 Provider 改为通过 Cordis 注入等待可用性服务，修复冷启动时动态禁用条件过早求值、导致组件未挂载的问题。

## [0.8.3]

### 修复

- 将 Codex 使用的五个进程辅助函数移入插件内仅依赖 Node 的辅助模块，保留官方 `rc.1` 实现与 MIT 许可。
- 移除 Codex 对 `subagent`、`timeout`、`brand` 入口的顶层导入，消除为辅助函数加载整套服务而引入的不必要宿主依赖链。

## [0.8.2]

### 新增

- 补充首次安装、前置依赖、CLI 检测、费用与安全说明，提供包含预构建 Client、Host 入口、语言资源、图标及第三方声明的 npm 格式 TGZ。

### 变更

- 移除打包者专用的 Kimi／agy 绝对路径，改用接收者本机检测结果；基于 `0.8.1` 保留 DSH `rc.1`／`rc.2` 双版本适配。
- Kimi／agy 新安装采用保守的 ACP `reject` 默认权限，明确报告写入可能因此被拒绝。
- 分享包不捆绑 `node_modules`、用户配置、账户凭据、会话、任务报告、备份、开发测试或本机日志。

## [0.8.0]

### 新增

- 任务与历史详情显示模型、思考强度及 Token 用量，区分后端确认值、请求配置与未提供数据。
- 按后端实际返回数据展示 Token，区分任务累计、会话及本轮口径；缓存和思考 Token 明细单列，避免重复计入总数。
- DSH 按事件序号去重真实用量，Codex 使用线程累计快照，Kimi／agy 仅在响应提供 `usage` 时显示消耗；上下文窗口占用不作为消耗。

## [0.7.0]

### 新增

- 接入 Antigravity（agy）ACP 后端，提供独立模型、思考强度与运行配置，可通过路由规则、默认 Agent 或 `dispatch_agent` 选择。
- 通过短暂 ACP 会话读取实际模型与支持的思考强度；续接使用 `session/load` 核验原历史，缺失能力或历史为空时拒绝，不静默新建会话。

### 变更

- 子任务正文改为连续消息流，相邻工具活动按顺序分组并默认折叠；与最后一条正文相同的最终结果不重复展示。

## [0.6.0]

### 新增

- 将任务摘要、归档状态、输出及真实外部会话引用持久化到 DSH 原生存储域 `multi_agent_task_history`；重启后将未结束任务标为已中断并归档，不自动重跑。
- 终态任务支持归档、恢复与清理；清理保留磁盘报告及底层会话，恢复标签本身不启动模型。
- 提供面板“继续指挥”与 `continue_agent`，复用原 DSH 子会话、Codex 持久线程或 Kimi 会话；仅允许所属父会话的终态任务续接，拒绝重复并发续接及无法可靠恢复的任务。

### 修复

- 修复历史存储单元名称不合规范及初始化拒绝未及时捕获导致的 Host 崩溃；初始化失败时明确报错并阻止任务操作，不自动删除或重置损坏数据。

## [0.5.1]

### 新增

- 提供按子任务区分的任务标签面板，展示任务正文与工具活动，完成通知可定位对应任务。
- 完成通知以任务卡片展示，提供任务面板、报告及原始通知全文入口。
- 主 Agent 可通过 `agent_tasks` 查询自己派发的任务状态与活动，查询范围限制在所属主会话。

## 支持边界

- DSH 仅支持 `0.2.2-rc.1`、`0.2.2-rc.2` 和 `0.2.2-rc.3`，以 `engines.dsh` 声明为准。
- 已在 macOS 上完成构建与回归；Linux／Windows 未经实机验证，模拟 Windows 路径测试不等同于 Windows 端到端验收。
- 外部 Agent 需自行安装相应 CLI 并登录；插件不携带模型服务或额度。
- 真实上游契约测试使用隔离边界替身，不代表完整 `rc.2` Desktop 或所有真实 CLI 场景已验收。
- 从 `0.8.8` 起，任务面板使用 DSH 原生右侧栏与文件预览，无需 Better Sidebar。

## 链接

- [0.9.2 发布页][0.9.2]
- [0.9.1 发布页][0.9.1]
- [0.9.0 发布页][0.9.0]
- [Keep a Changelog]
- [语义化版本]

[0.9.2]: https://github.com/kiritoko1029/dsh-multi-agent/releases/tag/v0.9.2
[0.9.1]: https://github.com/kiritoko1029/dsh-multi-agent/releases/tag/v0.9.1
[0.9.0]: https://github.com/kiritoko1029/dsh-multi-agent/releases/tag/v0.9.0
[Keep a Changelog]: https://keepachangelog.com/zh-CN/1.1.0/
[语义化版本]: https://semver.org/lang/zh-CN/
