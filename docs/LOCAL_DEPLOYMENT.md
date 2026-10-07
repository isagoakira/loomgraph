# 本机部署与重启后演示

## 2026-10-06 r22 选区控件交付

完整 r22 已安装，`current` 指向 `versions/0.1.0-local-20261006-r22`，buildId 为 `selection-controls-20261006-r22`。当前正式入口仍为 [ForecastCompass 空间笔记](http://127.0.0.1:59480/?graph=forecastcompass-spatial-notebook)。Codex 持有的 PID62637 仍运行 r21；其页面资源指针已切换至 r22，并实际刷新验收。没有重启该 MCP、修改接入配置或另启竞争正式数据目录的服务。

正式页面在实际 411×664 窗口、10% 总览验证了八组标题与问题摘要、Shift 选择两个组及唯一选区工具栏；批量菜单在画布内。手工具从“双记忆分工”标签开始拖动，标签屏幕位置完整移动 (-40,+40)，未被标题或展开入口截断。临时视口覆盖已复原、隔离测试页与服务已关闭。查看[总览截图](../.runtime/controls-redesign-20261006/live-r22-overview.jpg)、[多组菜单截图](../.runtime/controls-redesign-20261006/live-r22-group-controls.jpg)与[页面记录](../.runtime/controls-redesign-20261006/live-r22-ui-proof.json)。

重新调用当前会话的 `canvas_open`，正式项目及工作副本身份保持，R159 完整快照与本轮起点一致。正式数据未因选择、缩放、平移或页面升级产生修订；混合删除和多组解散及一次撤销均在隔离副本完成。源码类型检查、38 个测试文件 / 284 项测试与生产构建通过；本轮验收及范围见[选区控件改造](CONTROLS_REDESIGN_2026-10-06.md)。

**当前后台与界面版本边界：** r21 后台对 `display_facts` 的 `uiBuildId` 作严格一致校验，因此不能接收 r22 页面回执。当前读出的 r21 显示报告，即便 `status=current` 且修订为159，也不代表上述 r22 镜头；本轮页面证据使用实际 DOM 与截图。下一次完整重启 Codex 加载 r22 后，须实际重新调用 `canvas_open`，核对新入口、身份、修订，并重新验收 r22 `display_facts`；不能沿用59480或旧回执推断后台已经重载。此边界见[最终记录](../.runtime/controls-redesign-20261006/live-final-acceptance.json)。

安装验证了完整 ZIP 文件集与934个内容文件哈希。发行包 SHA-256 为 `1cebe62c0171a77ffce37636aa17d3498c42f8c20eef5455da177ff904c964bb`，见[安装记录](../.runtime/controls-redesign-20261006/installation.json)。旧 r21 页面保存在 `dist/ui-original-before-r22`，页面指针回退依据见[切换记录](../.runtime/controls-redesign-20261006/live-ui-switch.json)。已核验归档与安装文件不因后续文档更新被改写。

完整安装版 r22 还在独立临时数据目录通过真实 stdio 握手、一次 `canvas_open` 与一次 `canvas_read`；11 项检查通过，服务与安装清单 buildId 一致。transport、子进程、HTTP和数据锁均释放，临时dataRoot已删除，无残留r22服务。见[安装版启动检查](../.runtime/controls-redesign-20261006/installed-r22-smoke-result.json)。这不是当前Codex后台重载证据，也不冒充既往r21的30项断言重跑。

整组拖动与自由变形、任意密集标签避让以及 Windows / Claude Code 的宿主验收仍未完成；本次为经过验收的控件增量，不是完整 V1。

以下“重新接入”记录是本次控件交付前的 r21 状态。

## 2026-10-06 重新接入

当前 Codex 已通过实际 `canvas_open` 接入新进程 PID62637（北京时间14:18:12启动），正式项目及工作副本身份保持，仍为 R159。新入口为 [ForecastCompass 空间笔记](http://127.0.0.1:59480/?graph=forecastcompass-spatial-notebook)。已打开并保留浏览器页面；没有另外启动竞争数据目录的写服务，也没有修改内容。

实际 `display_facts` 返回 `status=current`，serverBuildId 与 uiBuildId 均为 `structured-notebook-20261004-r21-final`，diagnostics为空。此前“当前 MCP 未重载”的边界已在本次实际宿主调用中解除；完整 V1 的其他待验项保持。证据：[接入记录](../.runtime/service-reopen-20261006/result.json)、[页面截图](../.runtime/service-reopen-20261006/reopened.jpg)。

以下为2026-10-04交付时的部署快照；旧进程与端口不代表上面的当前运行状态。

更新日期：2026-10-04。**r21 已安装，当前页面资源已切换到 r21，正式论文图已从 R158 升级到 R159。**当前 Codex 持有的 MCP 服务进程未重启；下一次完整退出并重开 Codex 后才加载 r21 服务。下方 r10 及更早条目保留为历史记录，完整 V1 仍按功能与目标宿主分别验收。

## r21 当前部署状态

| 层次 | 已核实状态 |
| --- | --- |
| 源码与构建 | 最终 buildId 为 `structured-notebook-20261004-r21-final`；类型检查、36 个测试文件 / 276 项测试、生产构建通过。 |
| 安装入口 | `/Users/Zhuanz1/.local/share/agent-visual-canvas/current` 指向 `versions/0.1.0-local-20261004-r21`。 |
| 当前 MCP 服务 | PID `22479` 继续持有正式数据目录，未中断本对话、未重新加载程序；切换 `current` 不会替换该进程已加载的代码。 |
| 当前页面资源 | 该旧服务使用的 `versions/0.1.0-local-20261003-r10/dist/ui` 已指向 r21 的 `dist/ui`，浏览器刷新可取得新界面。 |
| 正式项目 | 项目 `cb904f16-a9ec-4a38-831c-d84d9a08df80`、工作副本 `bdc90254-57fe-4968-97a4-96473ca9868f`，当前 R159；论文图入口为 [ForecastCompass 空间笔记](http://127.0.0.1:58363/?graph=forecastcompass-spatial-notebook)。 |
| 接入与数据 | 原项目级 MCP 配置保持，数据目录仍为 `/Users/Zhuanz1/.local/share/agent-visual-canvas/projects/codex-session-demo`；本轮没有另启一个写服务占用该目录。 |

安装逐项核验了 ZIP sidecar、完整文件集合与 931 个内容文件的哈希；安装完成后又在独立临时数据目录运行正式 r21 的 stdio 检查，30 项断言通过，包括 MCP 握手、实际子进程停止后的 effective 回执，以及 EOF 后服务、HTTP 和数据锁释放。这证明新安装程序可运行；当前 Codex 对话尚未重新加载 r21 MCP，二者分别记录。

发布包为 [r21 安装包](../.runtime/structured-retrofit-20261004/release-r21/agent-visual-canvas-0.1.0.zip)，SHA-256 为 `ebb4dac2c38333df61c1c697655f642e3e883732fae6ab9c3bce4b86a1cfc184`。安装和当前指针证据见 [installation.json](../.runtime/structured-retrofit-20261004/installation.json)、[ui-pointer-final.json](../.runtime/structured-retrofit-20261004/ui-pointer-final.json)；正式程序检查见 [installed-stdio-smoke-r21.json](../.runtime/structured-retrofit-20261004/installed-stdio-smoke-r21.json)。发行包内文档是打包时的快照；本工作区说明与验收记录另行记录打包后的安装和正式项目操作，不回写已核验归档或安装目录。

## r21 正式图升级与恢复边界

root 重新读取正式 R158 后生成并预检候选，再由当前会话实际 `canvas_apply` 应用，得到 R159。变更只涉及 `forecastcompass-spatial-notebook` 的 `metadata.organization`：11 个组织分组、24 条组织联系、54 个唯一归属；索引、F 与 R 下级组归入 `two-memories`，F 与 R 保持并列。正文、实体与关系身份、原几何、自由元素、图片资源、批注、讨论及执行记录均未改动，其他图及目标图的非组织 metadata 也保持。实际差异检查见 [live-upgrade-applied.json](../.runtime/structured-retrofit-20261004/live-upgrade-applied.json)，页面操作和限制见[改造验收记录](STRUCTURED_NOTEBOOK_ACCEPTANCE_2026-10-04.md)。旧 `baseRevision=160` 候选保留作历史审计，不能用作当前项目的写入依据。

升级前导出的完整 [R158 项目包](../.runtime/structured-retrofit-20261004/live-r158.avcanvas)包含资源与历史，大小为 2,907,299 bytes，SHA-256 为 `9701f833ff15f2353c38b7a6eb65f2403f73b6929cc9cdf0aea250f1c3f88ad8`。程序 r20、r19、r10 等旧版本和项目数据均保留；r21 安装记录中的 `oldCurrent` 及当前页面指针的 `oldTarget` 都指向 r20，是本次程序与 UI 的直接回退依据，安装技能备份路径也记录在安装报告中。

程序指针、页面资源指针和项目内容分别恢复。切换程序入口只影响下次启动；当前服务生命周期由 Codex 持有，不能再启动一个竞争正式 dataRoot 的服务。项目回退应先在独立副本核对备份，再用版本化恢复形成新历史，不直接覆盖正式数据。不得用旧版本 writer 覆写尚含新组织结构的项目。以上是恢复依据，本轮没有执行回退。

下一次完整重启 Codex 后，必须由本对话实际调用 `canvas_open` 核对新服务版本、项目身份和修订，再打开它返回的入口；端口可能改变，不能沿用 `58363` 推断新服务已加载。Windows Codex、Claude Code 真实宿主接入及长时间运行中的实时监控仍待独立实机验收。本机隔离页面、正式图升级、安装 stdio 和当前宿主重载不合并成一项“全部完成”。

## r10 已安装入口（历史）

- 程序：`/Users/Zhuanz1/.local/share/agent-visual-canvas/current`，指向独立的 `versions/0.1.0-local-20261003-r10`。
- 项目数据：`/Users/Zhuanz1/.local/share/agent-visual-canvas/projects/codex-session-demo`。
- 最终 MCP 配置：`/Users/Zhuanz1/Desktop/file/AutoResearch/.codex/config.toml`，服务名 `agent_visual_canvas`，仅在此已信任项目生效。
- Node：`/opt/homebrew/bin/node`；启动参数为绝对脚本和数据路径，随机本机端口，不依赖工作目录。
- Agent 使用说明：`/Users/Zhuanz1/.codex/skills/agent-visual-canvas/SKILL.md`。
- 部署过程与检查：`.runtime/local-deploy-20261002-r1/`。

全局配置曾尝试新增入口，但后续读取未保留该项；原因未确认。最终改用项目配置，在独立的后续调用中 `codex mcp get agent_visual_canvas --json` 确认入口存在且启用。现有全局连接保持。不要把初次全局写入报告当作最终安装位置。

## p1.3 / r10 安装状态（历史）

r10 当时提供可调栏位、地图缩放、正文预览和原位细则；当时页面已更新，旧 stdio 继续运行，下一次重启加载完整 r10。r9 及原数据保留。安装清单和实际检查见[工作区验收](WORKSPACE_CONTROLS_ACCEPTANCE_2026-10-03.md)。

## r20 核心改造与 r21 补修

r20 的核心改造已通过统一源码检查和实际隔离页面操作，并先行安装；最终窄窗口检查发现绘图工具收起后仍有一个空的 Excalidraw mobile 底条遮挡正文，该补修进入 r21 独立版本。r21 安装和页面资源指针已核验，当前 MCP 未重启的边界见本页开头。

正式页面最终刷新后已实际复验 r21：默认626×692窗口、44%缩放下，收起绘图工具后空底条为 hidden；打开绘图工具后该条为 visible，原生选择、矩形、箭头、文字与插入图像等控件出现。复验后恢复阅读界面；当前项目仍为 R159。配套[截图](../.runtime/structured-retrofit-20261004/live-r21-narrow.jpg)及[DOM观察](../.runtime/structured-retrofit-20261004/live-r21-ui-proof.json)记录相同镜头，属于页面观察而非新服务 display_facts 回执。

expression 64 KiB 修复、500 geometry 纯模块基准和 annotation observation 极端预算基准保留于[改造验收记录](STRUCTURED_NOTEBOOK_ACCEPTANCE_2026-10-04.md)；纯模块结果不替代实际页面或宿主检查。ForecastCompass [组织生成器](examples/forecastcompass/upgrade-spatial-organization.mjs)仍只生成候选，正式应用由 root 在重新读取当前版本及预检后完成。多级展开、局部排版、自由文本编辑/拖动/变形/删除/撤销、两条独立批注回应等实际页面结果与未覆盖项均在验收记录逐项列出，不能据此声称完整 V1 或所有平台通过。

## p1.2 安装状态（历史）

r9 完整安装与清单复验见[本轮验收](EXPRESSION_ACCEPTANCE_2026-10-03.md)及 `evidence/expression-installation-final-r9.json`。当前端口为 `49786`，页面使用 r9；当前 stdio 进程仍运行旧 r1，未中断当前会话。下次完整退出/重开 Codex 后加载 r9 服务，端口可能改变，以 `canvas_open` 返回入口为准。

新服务的 `expression`、`expression_check`、`expression_prompt`、`expression_validate` 已在正式安装 Node 24.19.0 stdio 中验证。当前旧会话工具 schema 还没有这四种模式；可继续用已有读取/增量/反馈工具，实际页面的“讲解检查与 Agent 上下文”已可用。此次没有修改用户 MCP 配置、原 4317 演示或源 dist。

以下 r1/r2/r8 的部署过程是历史记录；它们不构成 r21 当前状态。

## r10 本轮实际验证（历史）

- 根代理类型检查和 136/136 全量测试通过。
- 在隔离源码工作区构建，未改原演示服务使用的 `dist`；字体 subset Worker 实际执行成功。
- 138 个保留依赖、140 份许可文本、未解决许可 0。
- 已解压安装并校验 733 个清单文件；日常运行无需依赖安装或开发服务器。
- 安装入口的真实 stdio、实际登记执行器停止和 EOF 释放 30 项通过；这是安装检查，不作为当前模型对话接入证据。
- 安装页面的混合组复制、绘制顺序、独立分组、重载零写入和延迟稳定性 16 项通过，见 [实际页面报告](evidence/native-mixed-copy-installed-r1.json)。
- [部署总览](evidence/local-deployment-overview-r1.json)显示配置完成、宿主加载待验证、批注未被预检客户端认领。

## r10 当前会话与论文演示（历史）

2026-10-02：重启后，当前 Codex 对话实际加载并调用 Canvas MCP，`host` 已通过真实 `canvas_open` 标记完成；读取、增量修改、独立反馈回应、临时展示、历史和项目包导出均由本对话执行。当前服务入口为 `http://127.0.0.1:49786/?graph=forecastcompass-architecture`，项目身份不变，最终内容为 R44。端口随下次 MCP 启动变化。

新安装入口 `current` 指向完整 r2；现有 stdio 服务仍是 r1 进程，当前静态页面已更新为经过构建验证的 r2 UI。未重启持有当前会话的服务，项目数据保持。旧 r1 页面保存在 `dist/ui-original-r1`，原 4317 演示使用的源 `dist` 未被本轮构建覆盖。

本轮类型检查、138 项源码测试及隔离生产构建通过；字体 subset Worker 实际返回 476 bytes。真实页面验证了右侧统一操作、工具栏移动、目标独立草稿、模块/关系/图片直接批注、记忆/修订子图及相机返回、原图刷新、局部布局预览和取消、历史。论文结构模块不冒充已运行预测；完成状态只记录真实演示工作。

详见[本轮操作与验收](CURRENT_SESSION_DEMO_2026-10-02.md)、[交互修订](INTERACTION_REVISION_2026-10-02.md)和[当前会话证据](evidence/current-session-paper-demo-final.json)。两条页面演示批注已各自关联修改；三条预置演示批注也已回应。原生 Codex 标注、Claude channels、Windows 和跨平台往返仍需独立验收。

## r10 重启演示步骤（历史）

1. 完全退出并重新打开 Codex，回到 AutoResearch 项目中的本对话。用户可发送“开始演示”。
2. 首先确认当前模型工具列表出现该服务器的九个 `canvas_*` 工具。读取已安装的 Agent 使用说明，并调用实际 MCP 工具 `canvas_open`；不得用独立脚本客户端替代这一宿主验收。
3. 当前项目应为 `cb904f16-a9ec-4a38-831c-d84d9a08df80`，工作副本为 `bdc90254-57fe-4968-97a4-96473ca9868f`。以后写入使用当次 `canvas_open` 返回的身份和版本。
4. 使用当次返回的 `connection.entrypoint` 在当前 Codex 对话的浏览器面板打开工作区。端口随服务启动变化；不要复用预检端口或原演示服务的 4317。
5. 实际工具可读取该项目后，再通过版本化操作将任务 `host` 标记完成，来源注明“当前 Codex 对话已实际调用 Canvas MCP”。

## r10 演示顺序（历史）

1. 展示“本机部署与演示”总览，进入“系统结构”和“安装与接入流程”；说明一个对象可有多张图上表示，切图返回保留视口。
2. 通过当前会话的 `canvas_apply` 更新任务 `demo-progress`，展示进度在流程图和反馈图同步；不移动节点或抢用户视口。实际演示完成后才标记完成。
3. 通过 `canvas_present` 高亮和定位相关对象，展示默认提示与“跟随 Agent”开关；临时高亮不生成内容修订。
4. 读取批次 `restart-demo-batch` 的完整清单与冻结上下文。三条预置意见均明确标为演示批注：`restart-demo-rename`、`restart-demo-explain`、`restart-demo-layout`。演示开始前都未认领、未回应。
5. 当前会话逐条认领、实际修改或回答，并关联变更：改名保留身份与位置；解释关联原连线；局部排版按批注要求先展示候选，保护固定位置。各条结果独立回写，不声称预览已经应用。
6. 展示批注回应与最近修改历史，按需导出 `.avcanvas` 项目包。用户也可选择另一对象或区域新增一条批注，沿同一批次引用交接路径处理。

预置批注是演示素材，不是用户已经提交的三条真实业务要求；安装预检也没有代表宿主模型回应它们。页面原生 Codex 标注 API 与 Claude channels 当前仍未接入，演示使用本地批注与 MCP 读取链路。

## r10 停止、更新与恢复（历史）

2026-10-02 元控件更新：当前 stdio 进程未重启，已加载的服务仍为 r1；其 UI 指针连接到 r8。摘要/分节、富文本及阅读顺序沿现有扩展路径事务保存，当前会话真实 MCP 已更新到 R73。下次启动使用完整 r8。r8 在独立数据目录的 Node 24.21.0 下通过真实 stdio、关闭重开和富内容项目包迁移检查；不以该客户端替代当前宿主验收。进入“ForecastCompass · 从问题到证据的完整讲解”，用“文档阅读”看完整内容，用“自由排版”拖动内容块；“＋ 文本框”插入即编辑，双击已有文字编辑。模块取景完整显示底部按钮，长文本编辑区可滚动。设计和分项限制见 `SEMANTIC_CONTROLS_2026-10-02.md`。旧 r1–r7 程序、原 4317 服务/数据及源码 `dist` 保留。

Codex 持有 stdio 服务生命周期；安装检查客户端结束后必须释放同一副本，避免两份写服务竞争。不要为正式演示另外启动占用该数据目录的 HTTP-only 服务。

程序版本与数据目录分离，原演示项目及 r4 归档保留。更新程序时保留上一版本和项目数据；移除接入只处理本项目配置中的 `mcp_servers.agent_visual_canvas`，不恢复整份旧全局配置覆盖后续更改。
