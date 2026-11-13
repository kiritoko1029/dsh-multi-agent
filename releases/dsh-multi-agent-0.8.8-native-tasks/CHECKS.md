# DSH 多 Agent 派发 0.8.8 — 原生 Agent 任务面板

## 改动

- 移除 Better Sidebar 的 Client 注入与 `registerTab/openTab/openFile/isTabEnabled` 调用。
- 使用 DSH 原生 `sidebarRightTabs` 注册 `multi-agent:tasks` 页面，正文注册到 `sidebar.right.pane.tab`，实现 id 为 `@local/dsh-multi-agent/tasks`。
- 开始页新增“Agent 任务”入口；新外部任务在当前 on-screen 主会话中打开面板，后台或无当前会话时不误开。
- 原生 `navigation.params` 传递父会话、子任务和 cwd；`navigation.revision` 支持重复打开同一任务，不会停留在用户手动切换后的其它任务。
- 报告和 Markdown 文件链接改用 DSH 原生文件资源预览；支持绝对/相对路径、Windows 盘符、UNC、空格与 file URL，相对路径按子任务 cwd 解析。
- 保留任务列表、活动流水、历史、归档/恢复/清理、续接、Token 信息和完成卡片；隐藏时停止相应读取。
- 保留 0.8.7 的 Host 依赖隔离与 0.8.6 的 Windows 运行修复。

## 验证

- `npm run check`：通过。
- `npm test`：**335 项，334 通过、0 失败、1 项原有条件跳过**。
- 原生任务面板定向测试：**56/56 通过**。
- `npm run build`：通过，最新 Client bundle 已生成。
- 独立 UI/集成审查发现并关闭了“再次打开同一任务时未重新选中”的重复导航缺陷；终审无其它明确阻断。
- 当前 DSH 链接安装已通过插件管理器重载；`sidebar.right.pane.tab` 中 `@local/dsh-multi-agent/tasks` 为活动注册。
- 最终 TGZ 共 53 个文件，不包含 Better Sidebar 或 DSH Host 运行时生产依赖。

## 使用与验证边界

1. 用本 TGZ 替换旧版；若管理器提示 already-installed，备份设置后只移除旧的本插件 bundle，再安装新版。
2. 替换后完全退出并重启 DSH，或在支持热重载的环境中按提示应用，然后刷新页面。
3. 在右侧开始页选择“Agent 任务”，或从任务完成卡片选择“打开任务面板”。面板加载前的已有任务可手动打开，不保证补弹。
4. 不需要安装或启用 Better Sidebar。已安装它的用户也不需要在其中另外开启本插件页面。
5. 本轮没有浏览器视觉截图或 Windows 实机面板验收；请在 Windows 上确认开始页入口、任务详情、续接、报告预览和不同窗口尺寸。真实 CLI 与进程树回收仍按各 Provider 环境验证。
