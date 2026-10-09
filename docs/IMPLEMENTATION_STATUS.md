# 实施与阶段验收记录

日期：2026-10-09。当前源码构建为 **`persistent-agent-20261009-r31.2`**：常驻可收起 Agent、受约束页面控制、跨图冻结选区和 SDK 访问隔离已实现。62 个测试文件、533 项测试、类型检查和生产构建在开发目录通过；真实 Codex 和本机安装后 stdio 分项验收见 [r31.2 验收记录](PERSISTENT_AGENT_ACCEPTANCE_2026-10-09.md)。Loomgraph 仓库副本另作发布前检查，结果记录在 [发布检查](LOOMGRAPH_PUBLICATION_2026-10-09.md)。

页面助手随当前图读取有界上下文，选区助手保持明确的编辑范围；预览、应用、撤销仍使用既有事务路径。Windows、实际 API 和本轮 Claude 页面控制未实机验收。安装、页面构建和活动 MCP 进程分别核对，不能把新安装等同于宿主已重载。完整 V1 继续分项验收。

## 2026-10-04 历史状态

当时 r20 核心改造及页面验收通过，r21 已安装，正式页面的窄窗口遮挡补修通过，正式图为 R159，MCP 未重载。部署与恢复见[部署说明](LOCAL_DEPLOYMENT.md)。

## r20 本轮实施

- 统一递归局部排版：实际正文测量、增高/收缩、组标题与留白避让、固定位置保护；卡片、native 图形、边界及关系端点使用同一结果。
- 结构展开、正文细则、选择与聚焦分开；多组同时展开；标题处收起细则。独立自由文本原位编辑、拖动、尺寸调整、删除和撤销；新插入内容自动显示，固定高度长文可在未激活时滚动。
- 任务状态显示来源/时间，实际执行回执独立显示；两条独立批注完成实际交接与响应，冻结观察不变。
- 类型检查、36 文件 276 测试、production build 通过；真实页面验收与失败修复见 [改造验收](STRUCTURED_NOTEBOOK_ACCEPTANCE_2026-10-04.md)。500 geometry 纯模块最终 median 10.601 ms、p95 12.451 ms，碰撞与固定位置违规均 0；不替代浏览器性能门槛。
- Harness 有界预算和未知字段保护通过；单条批注500 refs的极端上下文尚未实现 ref 级分片。分组整体拖动/宽度控制尚未实现；Windows/Claude/真人理解和完整浏览器性能未完成实际验收。
- r21 安装验证 931 个内容文件及 sidecar；安装版真实 stdio 30 项通过。当前正式页面已加载 r21，实测空底条收起/原生绘图控件恢复；正式内容仅作组织升级，原正文、对象、资源、几何及批注保持。原 MCP PID22479 继续运行，完整重启后再验新服务加载。

## r10 本机专项状态（历史）

日期：2026-10-03。计划 p1.3，程序 r10。本机栏位调节/收起、地图缩放、无点击正文预览及原位细则当时记录为已通过179项源码、31项实际UI及18项正式安装stdio检查；当时 stdio 保持旧进程、UI 使用 r10，下一次重启加载完整 r10。详见[本轮专项验收](WORKSPACE_CONTROLS_ACCEPTANCE_2026-10-03.md)。完整 V1 门槛继续分项验收。

## p1.2与更早实施记录（历史）

日期：2026-10-03。计划 p1.2。本机程序入口为 r9；当前 stdio 仍为 r1 进程，实时页面已使用 r9，重启加载完整 r9。源码类型检查、169/169 测试（18 个文件）、隔离生产构建及正式安装 Node 24.19.0 stdio 的18项检查通过。

本轮由三路 Luna Max 子代理负责讲解呈现、编辑控件和 Harness/Prompt，根代理负责共享契约、锚点校验、集成、部署和真实验收。默认卡片呈现核心结论、要点、输入输出和关系说明，点击标题/按钮或键盘展开细则；自由排版使用独立拖动手柄与聚焦阅读层。图主线、术语和路径、证据状态及真实进度均可编辑，独立文本框继续提供格式和原位编辑。

当前 MCP 已为 ForecastCompass 的19模块、26关系、五图补齐表达。真实页面完成一键/键盘展开、滚动/Esc、视图范围保持、文本框保存/取消/段落身份、Agent 更新时草稿保持与同字段冲突、关系/路径控件及局部任务组装。三条验收样例批注保留 R76/R78/R79，分别认领和响应，两条关联实际修改，冻结上下文未变。详细结果、项目包和已修缺陷见[本轮验收](EXPRESSION_ACCEPTANCE_2026-10-03.md)。

完整 V1 尚未验收。Windows、跨平台往返、Claude 实际宿主、Codex 原生标注、原生 Frame/跨类型层级及完整可见性能继续分项验收。富文本的 SVG/PNG 输出仍为纯文本投影，完整分页/文字环绕未实现。以下记录保留各版本的实际历史，不能把旧测试数或失败当作 r9 的最新状态。

## 早期证据（历史）

- 开始实施时插件只有领域和架构文档；目前已有独立源码、预构建服务 / 页面、样例和分项运行证据。
- 本次建立独立工程配置及共享类型契约；已有 AutoResearch 修改不属于本项目工作范围。
- 开发主机为 macOS；原生 Windows与真实宿主交接仍待验证，分项性能证据见下文。
- 首轮布局验收已执行：`tests/layout.test.ts` 五项通过，覆盖插入避让、固定位置保护、移动后旧预览拒绝、新障碍后旧预览拒绝和取消计算。此次结果只支持布局模块，不能作为 SDK 界面或整阶段通过证据。
- 布局计算改为按需 worker，并有两秒计算预算及终止清理；空闲时不会常驻该 worker。
- 独立依赖已安装，构建许可只启用必要的 esbuild；发布依赖使用固定版本及锁文件。

## 初期任务分配

| 子代理 | 模型与推理档 | 所有权 | 根代理验收重点 |
| --- | --- | --- | --- |
| `/root/canvas_core` | gpt-5.6-luna / max | `src/core`、`src/store`、`tests/core.test.ts` | 事务、幂等、冲突、历史、反馈快照及重启恢复 |
| `/root/canvas_service` | gpt-5.6-luna / max | `src/server`、`tests/server.test.ts` | stdio 协议、SSE、来源检查、单写服务及关闭 |
| `/root/canvas_ui` | gpt-5.6-luna / max | `src/ui`、`src/canvas`、`index.html` | 真数据交互、视口保护、子图、批注、自由绘图及撤销 |
| 根代理 | 统筹与集成 | 共享契约、配置、布局、证据及集成 | 直接运行测试和浏览器验证，复核实际覆盖范围 |

源码预审发现内核初稿按每修订保存完整快照，已改为每 100 个变更 / 4 MiB 增量的稀疏检查点和有界重放。测试覆盖第 1、99、100 和 105 修订重建；10,000 历史及重开的内核规模测量已完成，结果与最终构建的关系见后续验收记录。

## 第一轮根代理验收

- 全量 TypeScript 检查通过；真实依赖的生产构建通过，含本地字体。
- 根代理直接运行内核 7 项及服务 6 项测试，全部通过；先前布局 5 项通过。
- 生产服务真实启动在 `127.0.0.1`，隔离项目经本机 API 保存 18 对象、6 张图及 48 表示。未修改用户 MCP 配置。
- ego-browser TaskSpace 14 打开实际服务：项目侧栏与字体正常，但中央画布为空。此结果未通过 M0 / M2，界面代理正在修正。截图留在本次隔离运行的 `.runtime/evidence/01-initial-canvas.png` 与 `02-subgraph.png`。
- 源码复核发现实时订阅在连接完成前退出、撤销未保留原基线、HTTP 冲突被归为乐观离线成功等问题，已要求修正并安排交错更新验收。
- 当前 Codex 内置浏览器的本地页面没有 `document.oai.annotation` / `registerSurface` / `request`；专用原生标注未通过能力检查，通用批次引用为当前交接路径。
- 下一波内核负责项目包 / 资源 / 各条观察版本上下文；服务负责布局、反馈回执、执行队列及真实 stdio；界面负责上述缺陷、图交互与简便交接。注册扩展接口和固定验收样例由根代理建立。

## 阶段

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| M0 | 本机接口通过；跨平台待验 | 发布 SDK、选择、原生文字、受保护撤销、新图片快速放置 / 真实重载像素及 Node 24.21.0 stdio / SQLite 已实测；Windows 运行时待验证 |
| M1 | 本机主路径通过 | 事务、幂等、冲突、stdio、有序重连、拖动 / 状态 / 交错文字、快速切图保存及异步资源路径通过；宿主模型读取另属 M4 |
| M2 | 部分；原生组织与性能待验 | 慢拖、共享状态 / 父项摘要、固定位置、十次视口恢复、五层导航、局部布局、完整 SVG / PNG、新原生图片重载及 r16 实际复制稳定性通过；r21 反查发现受管 / 混合分组、受管 Frame 归属和跨类型绘制顺序的持久化缺口，正在补齐；操作性能预算未全部验证 |
| M3 | 本机交互和生产协议分项通过 | 跨图批次、30 条独立结果 / 重启恢复、输入恢复 / 原观察版本、区域、多选、连线、讨论范围 / 追问、删除实体 / 自由元素 / 连线历史及导入副本讨论查看通过；实际宿主交接另属 M4 |
| M4 | 当前 Codex 通用路径通过；专用渠道和 Windows 待验 | 当前对话 MCP 读取 → 修改 → 独立回应 → 页面关联已实测；登记执行器停止/EOF 有已有证据；Claude、Codex 原生标注与 Windows 仍未验收 |
| M5 | 部分通过 | 比较 / 恢复、原生项目包、独立副本、资源校验、正式 UI 校验失败提示及历史 / 冻结上下文原始字节保留通过；跨平台往返未验收 |
| M6 | 部分通过 | 三轮内核、空闲服务、r20 114/114 检查、离线页面 / 字体 Worker / 外网拒绝策略和固定规模 30 条上下文读取通过；r4 逐项归档 / 提取启动 / 30 条反馈恢复 / 配置解析 / 源构建比对通过，可见性能、实际宿主及双平台仍待验收 |

## 第二轮根代理验收

- 当前独立 TypeScript 检查通过，完整测试 **40/40 通过**，包含内核、项目包、布局、扩展、服务、宿主、执行协议及构建后的真实 stdio handshake。此结果不代表界面、真实宿主执行或 Windows 通过。
- 内核已补齐规范化 `appliedOperations`、逐条历史观察上下文、资源校验、一致 SQLite 项目包和独立导入副本；restore 保留真实运行记录，必要时为历史不存在的任务保留软删除身份。
- 空白画布已定位为 interactive canvas 的 CSS 背景遮住 static canvas。临时仅移除该背景即恢复显示，生产样式修正后重新加载也通过。复现前截图 `04-scene-retry.png`、单变量探针 `05-transparent-interactive-probe.png` 均保留在 `.runtime/evidence/`。回归入口为 `node scripts/check-browser.mjs 14`，复用当前 Ego TaskSpace；它检查实际像素及透明叠层，不以元素数量作为成功标准。
- 真实鼠标选择画布中的模块可定位稳定业务身份，详情显示跨图表示和子图入口。后续拖动、文字编辑、视口保护、跨图独立反馈和逐条回应仍待通过完整场景。
- 自有服务重启后发现页面仍显示连接成功，而保存实际遭到旧 runtime token 拒绝。重连状态、标识刷新和待确认操作恢复尚未通过；界面代理正在修正。

### 性能证据边界

| 样例 | 写入 p95 | 历史读取 p95 | 30 条上下文 p95 | 当前含义 |
| --- | --- | --- | --- | --- |
| core-r1 / 10,000 修订 | 18.21 ms | 96.19 ms | 26.98 ms | 不含自由图形和图片 |
| core-r2 / 10,000 修订 | 17.70 ms | 359.53 ms | 37.64 ms | 不含自由图形和图片 |
| core-r3 / 10,000 修订 | 15.40 ms | 88.25 ms | 24.75 ms | 不含自由图形和图片 |
| full-assets-r1 / 10,000 修订 | 17.13 ms | 104.57 ms | 24.47 ms | 含 500 对象、20 图、1,000 表示、1,200 关系、80 自由元素、2 图片资源和 30 批注 |
| full-assets-r2 / 10,000 修订 | 17.73 ms | 107.13 ms | 42.29 ms | 同完整样例，独立新项目目录 |
| full-assets-r3 / 10,000 修订 | 16.73 ms | 95.29 ms | 23.52 ms | 同完整样例，独立新项目目录 |

报告在 `docs/evidence/benchmark-*.json`。完整样例三轮内核测量均已完成。以上不含真实浏览器可见延迟、空闲服务 CPU、浏览器占用或宿主交接。全素材第一轮关闭后 RSS 为 182.09 MiB，峰值单列；空闲服务预算另由下文三个 60 秒窗口核对。后续新增依赖无环校验及资源包修复在这些内核性能测量之后完成，不能将旧测量解释成最终版本的完整性能结果。

### 第三轮验收发现与已通过子项

- 实际鼠标拖动任务 body 后画面移动，但十秒内未保存，原修订和位置保持不变；文字也停留在原位置。失败截图 `.runtime/evidence/08-drag-no-commit.png`。界面代理正在修复 SDK 原地变更与可变基线、表示整体拖动和自动固定；因此 M2 仍未通过。
- 真实 Agent API 更新任务状态后，直接读取 static canvas 像素观测到填充色由进行中变为完成，单样本可见延迟 **43.9 ms**，视图仍为 0.70×。仅为单样本，未形成 p95 验收。截图 `.runtime/evidence/09-visible-agent-update.png`。
- 空闲完整项目服务已完成三个独立 60 秒测量窗口，RSS 峰值分别 **123.77 / 85.64 / 86.13 MiB**，CPU 时间增量均低于 `ps` 百分之一秒的累计计时分辨率。三个窗口均通过单核心 1% 与服务 150 MiB 空闲预算；尚未测浏览器增量和导出峰值。报告 `docs/evidence/service-idle-macos-r*.json`。
- 根代理复跑 `scripts/execution-smoke.mjs`：构建后的真实 stdio handshake、明确登记执行器、请求入队、接收回执、实际 Node 子进程退出、verified effective 回执与 run 停止状态全部通过；另外实际 stdin EOF 后服务 / HTTP / 占用在三秒内释放。MCP SDK 先结束 stdin，等待两秒后才尝试信号 fallback；此次退出发生在此等待内。报告 `docs/evidence/execution-local-macos.json`。
- 上项只验证本机已登记执行器的停止链路；现有 Codex / Claude 整轮中断、继续 / 重试和 Windows 不由此证明。
- 补齐内建 `depends_on` 的无环执行语义；定向回归从失败转为通过，普通可视化 `sequence` 回路仍可保存。历史、图片资源和扩展记录的既有身份规则保持。
- 发布依赖清单现由实际 bundle 元数据生成 `dist/BUILD_DEPENDENCIES.json`；除直接包与字体外，传递依赖许可仍在核对。

## 第四轮真实交互及资源验收

- 根代理整合检查曾达到 **58/58 测试通过**、类型检查及构建通过；后续资源、反馈及界面修改继续进行，最终发布前需针对稳定版本重新检查。
- 独立下载并校验官方 Node **24.21.0** macOS ARM64 临时运行时，以实际启动包装在插件目录之外运行，真实 stdio、SQLite、执行回执和 EOF 释放通过。记录 `docs/evidence/execution-node24-macos.json`。此项验证具体补丁版本，不代表所有早期 Node 24 补丁或 Windows 已验证。
- 修复实际鼠标拖动后，服务从修订 2 变为 3，当前图表示位置持久化且 `pinned=true`；截图 `11-drag-fix-after.png`。标签可见性和移动后状态色尚未通过；纯几何移动曾固化派生状态样式，正在修正。
- 真实连续批注检查失败：在第一处保存意见后，到另一张图新建第二条，第一条被同 ID 覆盖，观察版本也沿用旧值。截图 `14-batch-second-draft.png`；批量主路径仍未通过。
- 500 对象完整项目的浏览器冷缓存首开测得 **1,486 ms**。随后持续更新探针失败：Agent-only 更新出现额外的 UI 表示修订并固化颜色，导致颜色不再跟随提交。失败记录 `docs/evidence/browser-visible-failure-macos-r1.json`；此轮没有可宣称通过的可见延迟 p95。
- 大资源压力样例包含 500 对象、20 图、1,000 表示、86 自由元素及 8 个资源，其中 6 张原始 1024×1024 PNG；资源共 **18,887,192 bytes**。本机导出约 **494 ms**，导入约 **112 ms**；导入建立独立副本并核对全部大小及 SHA-256。
- 上述压力测试先暴露了“恢复到插图前再导出时漏掉历史图片”。修复后包清单增加可选 `historicalResources`，在一致数据库中收集检查点、增量及冻结上下文的资源；根代理重跑通过。记录 `docs/evidence/resource-stress-macos-r1.json`。导出后 / 结束时 RSS 为 **256.63 / 296.25 MiB**，这是压力脚本采样，不能当作服务空闲或精确峰值。
- 实际发布依赖的许可清单已覆盖 **138/138** 个精确包版本，缺失文本为 0；原始许可与必要 NOTICE 保存于 `licenses/`。见 `docs/BUNDLED_DEPENDENCIES.md`。最终构建后仍需核对发布清单及归档内容一致。

### 后续验收入口

1. 修复重连和提交回执与 SSE 的交错更新，然后验证不丢内容、不覆盖较新修订。
2. 图与局部布局、图片持久化、批量独立反馈、讨论逐条回应、历史比较 / 恢复和迁移界面继续集成。
3. 真实已登记执行器的请求、接收、实际子进程退出和回执链路；stdio EOF 释放独立验证。
4. 完整样例负载、发布包 / 许可与干净提取运行。原生 Windows 实机仍不可达，保持待验证。

## 第五轮根代理验收

- 根代理全量检查：TypeScript 通过、**71/71 测试通过**、生产构建成功。最终依赖清单仍为 **138 个精确包版本**，许可缺失 0；保留 140 份原始许可 / NOTICE 文件及字体许可。
- 真实跨三张图连续保存 A/B/C 批注，三条 ID、图目标和观察修订分别保留。编辑 A 保留原 ID 与观察修订，取消勾选旧意见后只交接选中的三条。记录 `docs/evidence/batch-real-macos-r1.json`，截图 `16-batch-abc.png`。
- 经真实本机服务反馈入口接收、逐条认领和答复后，两条 responded、一条 needs_clarification；批次 partial，冻结上下文字段前后完全相同。记录 `docs/evidence/batch-responses-macos-r1.json`。此证据是本机服务 / UI 链路，不是既有 Codex / Claude 对话交接。发现上下文汇总误读冻结状态，UI 已修正为读取单独的 liveProgress，仍待实际重看。
- 新一轮实际拖动保留标签、固定标记及原样式，视口未变；截图 `18-drag-label.png`。一次慢拖曾产生三条修订，现已改用公开 onPointerUp 合并手势；单次修订数尚待实际重验。记录 `docs/evidence/drag-real-macos-r2.json`。
- 实际关闭并重启自有服务，断连时界面显示服务中断和待确认批注。控制网络阻断与放行保持在同一次浏览器调用内：服务 REV 22 → Agent 先提交 REV 23 → 旧基线批注重试成为 REV 24。原观察修订 22、原话和图目标保留，只提交一次，Agent doing 状态未被覆盖。`docs/evidence/reconnect-real-macos-r2.json` 四项断言均通过。
- Claude manifest 和专用路径已补齐，实际 `claude plugin validate` 通过，只有缺少作者资料的提示。Codex 兼容 manifest 单独引用便携 mcp.json，不使用 Claude 专用变量。实际安装、模型会话工具交接及原生 Windows 仍未验证。
- 历史面板已接入，支持最近 50 条、指定修订、只读比较、恢复新修订、项目包下载与稳定操作 ID 的上传重试。源码和构建已检查，实际浏览器路径仍待验收。
- 发布样例为全新干净项目：18 对象、6 图、48 表示、42 关系，无测试批注与运行记录；完整包 `examples/collaboration-demo.avcanvas` 已从构建后服务导出。
- 三个已有可见浏览器空闲窗口的 renderer CPU 为 **0.97558% / 0.19695% / 0.17684%**。原全浏览器 RSS 增量受其他页面释放影响，不用于证明页面内存预算；原报告保留采样并将该断言标为 null。
- 持续可见更新采样改用公开 SDK 的对象坐标及 camera；前两次静态采样因初次 fit 和 camera 时序失配失败，动态定位后一次探针超过工具单次 evaluate 的 15 秒期限且发生了延迟提交，已重载终止。当前改为可追踪的分段采样；尚无最终通过的可见 p95 报告。

## 第六轮专项交互与发行候选验收

- 整合期间全套 **75/75** 测试、类型检查和生产构建通过。随后根代理修复 SDK `text` 的视觉折行被写入业务标题：映射优先使用 `originalText`，保留用户主动换行；画布定向检查 **25/25**、类型检查及构建通过。新增测试后的最终全套数量与结果另行记录。
- 真实慢拖修订 25 → 26，仅形成一次修改；位置和固定约束保存，标签、样式与相机保持。解除 / 恢复固定各形成一条修订且几何不变。随后 Agent 状态修订 28 → 29，实际像素由绿色变为橙色，没有额外 UI 修订。证据：`drag-real-macos-r3.json`、`pins-real-macos-r1.json`、`status-after-drag-macos-r1.json`。
- 批次摘要复验显示“部分完成 / 已完成 2 / 已响应 2 / 需澄清 1 / 待处理 0”。真实区域、多选及连线批注分别保留独立 ID、精确目标和观察版本，原批注保持不变。用户追问与 Agent 回复保留同一批注 scope 和 parent，双方内容实际可见。证据：`batch-live-summary-macos-r1.json`、`region-real-macos-r1.json`、`multiselect-real-macos-r1.json`、`relation-feedback-real-macos-r1.json`、`discussion-real-macos-r1.json`。这些仍是本机服务 / 界面交互，不代表既有宿主对话交接已通过。
- 历史界面从当前 24 只读查看 20，再恢复为新修订 25；状态由 doing 恢复 done，六条批注保留。原生项目包下载 / 上传在同机创建独立副本，项目及内容身份保留，原服务继续附着原副本。证据：`history-real-macos-r1.json`、`package-ui-real-macos-r1.json`。尚未完成 Mac → 原生 Windows → Mac。
- 原生椭圆和自由文字创建为独立自由元素，业务对象不变。旧图片验收发现界面可见而存储为 0×0，失败记录 `free-image-failure-macos-r1.json`。修复后新图片保存为 160×96，资源可读取，重新加载后自由元素、资源及项目 / 副本身份全部一致，重载无新修订：`free-image-real-macos-r2.json`。上传使用 Excalidraw 的原生 HTML 文件选择器兼容路径；自动化工具不支持浏览器 File System Access 专用选择器，该专用路径未验收。
- 图片历史复核发现修订 44 → 45 提交了同内容 `free.put`，后者 `appliedOperations=[]`。另外原生标题在 46 正确保存，但 Agent 47 改名后，旧标题回声被当作用户修改提交为 48；工作区撤销撤回 48 成为 49，不能据此宣称受保护撤销通过。失败证据：`protected-undo-failure-macos-r1.json`。画布代理正在修复两类回声，必须再次实际交错验收。
- 原生缩放 / 平移后进入子图并返回，十次循环均恢复父图 0.9× 与子图 0.7× 的各自相机；每步等待实际填充像素，项目修订、批注和自由元素不变。证据：`camera-roundtrip-real-macos-r1.json`。
- 沿总览 → 结构 → 流程 → 混合 → 细节 → 运行逐次实际进入，五层面包屑完整；点击项目入口返回总览，相机恢复且没有新修订。证据：`deep-navigation-real-macos-r1.json`。
- 局部整理只生成六个临时布局表示，不提交内容。Agent 状态修订 49 → 50 使旧候选禁用，原布局保留；重新计算并实际应用为 51，仅移动六个当前图未固定表示，固定位置、自由文字 / 形状 / 图片、相机均保持，并满足障碍间距。证据：`layout-preview-real-macos-r1.json`。
- 在修订 51 的真实 UI 下载 / 上传完整项目包后，独立副本保留全部业务 / 几何、三项自由元素、两项资源、批注和讨论；资源大小与 SHA-256 核对通过，原服务和原项目不变。进一步核对发现导入函数重写了旧历史与冻结上下文的 `workCopyId`，违反原始来源 / 上下文冻结要求。`package-ui-free-assets-macos-r2.json` 将此项明确标为失败，核心代理正在修正；增加新副本的重建检查点本身是允许行为，不要求检查点数量完全相同。
- r1 发行包已有 561 项，560 项内容哈希核对通过，无 `node_modules`；从中文 / 空格提取路径且插件目录外，用官方 Node 24.21.0 完成真实 stdio、登记执行器停止回执和 EOF 释放。客户端配置生成结果已解析且路径存在，未写入用户配置。证据：`execution-release-node24-macos-r1.json`、`config-release-macos-r1.json`。r1 早于本轮交互修复，最终候选须重新打包。
- 新可见探针冷打开 2,568.66 ms、状态可见 p95 973.3 ms、100 项更新 902.6 ms，额外 UI 修订为 0、相机不变。独立无更新探针显示可见且聚焦页面的 rAF 仍约 1,000 ms；串行 30 次更新耗时 29.77 秒，并非真正 5 Hz 持续负载。此自动化调度环境下的数字不作为性能通过，也不能据此断言产品瓶颈；可见 300 ms 预算和真实 5 Hz 验收仍待验证。证据：`browser-visible-macos-failure-r2.json`、`browser-frame-boundary-macos-r1.json`。

### 第六轮收尾分工（已结束）

- `/root/canvas_camera`：画布生命周期、异步图片和旧文字回声、相关定向回归。
- `/root/canvas_preview`：完整 SVG / PNG、真实资源状态、悬停 / 聚焦按需预览与有界缓存；实现与定向检查已完成，等待根代理实际验收。
- `/root/canvas_core`：导入保留旧变更来源及冻结上下文，新提交使用新副本身份。
- 根代理：五层导航、真实交错 / 撤销、完整预览、最终全套检查和 r2 干净提取验证；保留未验证的宿主和 Windows 边界。

## 第七轮增量验收

- 本轮初次整合 TypeScript 检查和生产构建通过，全套 **82/82** 测试通过；日志为 `.runtime/test-final-r3.log` 与 `.runtime/build-final-r3.log`。完成长标题 / 图 scope 修复后的稳定 r5 检查为 TypeScript、生产构建及 **85/85** 测试通过；日志 `.runtime/typecheck-final-r5.log`、`.runtime/build-final-r5.log`、`.runtime/test-final-r5.log`。下轮新图片修复后需重做稳定检查。
- 实际换图复验曾将旧总览场景回调提交为新子图编辑，修订 51 → 52 删除了新图表示及自由元素。失败记录 `graph-switch-scope-failure-macos-r1.json` 保留完整内容与历史；页面脱离后通过历史 51 恢复为新修订 53，表示、自由元素、批注和讨论恢复核对通过：`graph-switch-recovery-macos-r1.json`。回调 scope 修复后，实际切换进入子图保留八个表示和三个自由元素；更多往返回归在最终构建上继续执行。
- 修订 55 → 56 的真实原生键盘改名保留主动换行；Agent 56 → 57 更新同字段后，工作区撤销返回冲突，不覆盖新标题也不增加修订；用户主动改回旧标题 57 → 58 正常保存一次。批注、自由元素和相机保持。`protected-undo-real-macos-r4.json` 全部断言通过。此前 r3 探针在首次 fit 前取坐标，误选空白位置并创建空文字；失败证据保留，该空文字已明确移除，未作为产品文字编辑通过证据。
- 修复迁移来源后，真实 UI 在修订 53 导出并导入独立副本。53 条历史变更、53 条幂等记录及冻结反馈上下文原始 JSON 字节完全相同；当前内容和历史检查点仅使用新副本视图身份，两个资源大小和 SHA-256 精确一致。新副本服务提交 53 → 54 使用新 `workCopyId`，原服务快照未变；测试服务关闭后占用释放。`package-ui-free-assets-macos-r3.json` 全部断言通过。该结果是同机迁移，不代表原生 Windows 往返。
- 完整 SVG / PNG 实际预览包含自由文字、形状和嵌入图片，悬停 / 聚焦不导航；混合中英文长标题显示省略，原生编辑器能读出完整 170 字符。然而只进入编辑器查看后 Escape，SDK 将受管节点高度 78 → 218 并提交额外布局修订，`long-label-full-preview-macos-r1.json` 明确保留这两项失败。高度及固定状态已恢复为原布局；画布代理继续修复文字编辑期的自动容器增长，并复核快速编辑后切图不丢待保存内容。
- 首次文字几何保护随后触发 React #185 更新深度错误，界面为空而存储仍为修订 61；`long-label-editor-crash-macos-r1.json` 与 `long-label-full-preview-macos-r2.json` 保留失败。最终改为编辑结束后的可取消单帧修复，文字编辑期不同步 `updateScene`。真实 r3 复验 61 → 61：完整 170 字符原文、三行省略显示、几何 / 自由元素 / 批注 / 相机不变，悬停 / 聚焦不导航，完整 SVG / PNG 含文字、形状和嵌入图片；所有断言通过，浏览器错误数组为空。证据 `long-label-full-preview-macos-r3.json`，截图 `50-long-label-display-r3.png` 与 PNG `52-full-preview-r3.png` 已实际查看。
- 原生编辑后立即切图，不等待存储回执，修订 61 → 62 只产生一条原对象 `entity.patch`；新图实际显示，原图标题保存，几何、自由元素和批注保持：`quick-graph-save-macos-r1.json` 全部断言通过。
- 最终 r5 构建再次完成十次原生缩放 / 平移后的子图往返，各图相机独立恢复、无内容修订、批注和自由元素保持；五层实际进入与项目入口返回同样通过。证据 `camera-roundtrip-real-macos-r2.json`、`deep-navigation-real-macos-r2.json`。
- 最新文字保护上的真实交错撤销复验 62 → 63 用户原生输入 → 64 Agent 同字段更新，工作区撤销被明确拒绝且不生成修订，用户主动回到旧内容成为 65。新标题、几何、批注、自由元素及相机均正确，浏览器错误为空；`protected-undo-real-macos-r5.json` 全部断言通过。

## 第八轮新图片回归与发行收尾

- 在稳定 r5 页面通过原生 HTML chooser 上传一个全新 160×96 SVG，放置后等待 15 秒，修订 65 → 66 登记真实资源、67 保存新自由图片，但图片仍为 0×0；新图片未显示，原有自由素材和业务内容保留。`free-image-real-macos-r3.json`、`free-image-r3-storage-failure-macos.json` 及截图 `54-native-image-r3-timeout.png` 保留失败证据。此结果说明早先旧图片重载通过不能覆盖新 fileId 的快速放置路径。
- `/root/canvas_image_final`（gpt-5.6-luna / max）负责 SDK 图片异步初始化、投影 / 保存交错及定向回归；根代理负责真实新 fileId 复验、最终全套检查、许可清单、r2 发行包提取及独立 Node 24 启动验证。
- 需求审计更新为 r1.2，仅同步当前实施状态，已确认的 D001–D012 与计划 p1.0 保持。宿主兼容性文档同步 Claude manifest 和脚本占位符的实际修复结果；实际用户配置尚未应用。
- 修复采用同作用域待保存元素合并、公开文件数据解码和最新 pending diff；未完成尺寸的新图片暂不提交。后续缩窄为仅合并相对原基线发生修改的字段，保留 Agent 较新标题 / 状态和用户随后移动的旧图片；异步旧图不修改当前 SDK 场景。
- r4 新图片 68 → 69 资源 → 70 图形，正确保存 160×96，仅一条有效 `free.put`，重载无修订。原脚本把 GET 的 JSON envelope 当原始资源 bytes，`free-image-real-macos-r4.json` 中该断言为测量错误；独立按 `data` 的 base64 解码后，352 bytes 与 SHA-256 精确一致：`free-image-r4-resource-audit-macos.json`。同浏览器独立 `Image.decode` 和临时 Canvas 像素核对通过：`free-image-r4-browser-decode-macos.json`。
- r4 重载的原生画布仍显示灰色占位符，截图 `57-native-image-r4-reloaded.png` 和 `58-native-image-r4-settled.png` 留存。根因来自发布版 SDK 的公开 `addFiles()`：它扫描调用当下的 scene，原顺序 files → elements 在空场景时漏建图片缓存。改为 elements → files，通过 SDK 自身渲染完成，不强改存储的 `status`，不使用私有 API。
- 最终新 r5 SVG / fileId 从修订 70 → 71 资源 → 72 图片：实际画布在放置和重载后都读到正确背景像素，160×96 保存、资源大小 / SHA-256 正确、旧素材 / 业务 / 几何 / 批注 / 相机保持，历史无 no-op，重载 72 → 72、浏览器错误为空。`free-image-real-macos-r5.json` 全部断言通过；截图 `60-native-image-r5-reloaded.png` 已实际查看。
- 最终代码的原生用户编辑 72 → 73、Agent 同字段更新 74、撤销明确拒绝且不增加修订、用户主动返回旧内容成为 75；几何、自由素材、批注与视口保持，浏览器错误为空：`protected-undo-real-macos-r6.json` 全部断言通过。随后原生编辑后立即切图成为 76，仅一条 `entity.patch`，原图修改保留、新图呈现且几何 / 自由素材 / 批注不变：`quick-graph-save-macos-r2.json`。
- 根代理稳定源码检查：**89/89** 测试、TypeScript、生产构建全部通过；日志 `.runtime/test-final-r8.log`、`.runtime/typecheck-final-r8.log`、`.runtime/build-final-r8.log`。实际构建清单与许可表逐项匹配 **138** 精确包版本、保留 **140** 份原始文本、未解决项为 0；清单生成于 `2026-10-02T02:20:24.655Z`。此后没有源码变更。
- r2 发行候选 `agent-visual-canvas-0.1.0.zip` 共 **17,974,188 bytes / 606 entries**，其中 **605** 个内容文件 SHA-256 逐项匹配；归档 SHA-256 为 `a04f7e6f361f3ae52bab7461497b7f919b4e98f692e6aae93447e25db091c0c4`。包内无 `node_modules`、运行目录和用户项目数据库；字体、原始许可、工具说明与干净样例齐全。证据 `release-archive-macos-r2.json`。
- 将 r2 提取到中文 / 空格目录，从插件与提取目录之外用官方 Node **24.21.0 macOS ARM64** 运行真正发行入口：stdio handshake / 工具读取、登记执行器、请求接收、真实子进程退出、生效回执以及 stdin EOF 后服务 / HTTP / 占用释放全部通过。证据 `execution-release-node24-macos-r2.json`。该项是本机通用 MCP / 已登记执行器，不是现有模型对话控制。
- 使用提取包的配置生成器产生本机绝对路径的 Codex TOML / Claude JSON，实际解析及 Node / 入口路径核对通过，未应用到用户配置：`config-release-macos-r2.json`。发行 ZIP 内记录打包时的状态；以上最终提取验收证据在源仓库和发行包旁置的 `ACCEPTANCE.md` 中，避免把候选包的自身验收结果递归写回归档。
- r8 本机发行候选已交付。后续按完整 18 项矩阵补齐正确性、既有宿主、原生 Windows 和可确认浏览器调度条件下的性能验收；已通过路径不反复复跑，新的改动只补验实际影响范围。当前 Windows 问题仍等待可用原生机器信息，不能用 WSL 或同机迁移代替。r9 后续发现的缺陷与候选状态见下一轮记录。

## 第九与第十轮：完整矩阵反查及最小修复

- r9 补验真实提交后零响应断开、同操作重试、提交前断开、第二写者拒绝、实际 SIGKILL、陈旧占用归档及精确重启恢复，27 项断言通过：`postcommit-crash-release-macos-r9.json`。仅终止隔离探针自己的服务，原演示数据保持。
- r9 的 30 条探针在处理前 15 条后发现冻结上下文的原始 JSON 被后续修改改写；未执行中途重启或后 15 条。失败保留于 `batch30-stdio-release-macos-r9.json` 及 `batch30-frozen-context-failure-detail-macos-r9.json`，不能把其分页成功当成整批通过。
- 修复批次上下文首次持久化后不再重写；列表、claim、respond 统一接受批次清单中的合法成员，即使未带反向 `annotation.batchId`，并拒绝歧义关联。r10 整合 **102/102**、类型检查和生产构建通过，日志 `.runtime/test-final-r10.log`、`.runtime/typecheck-final-r10.log`、`.runtime/build-final-r10.log`。
- r10 真正生产入口和 Node 24.21.0 stdio 完成三图、两个观察版本、30 条批注，最后五条仅由批次清单关联；7 条分页完整无重复，28 条响应、1 条澄清和1条失败独立保留。第15条后EOF退出并重启，继续剩余条目，响应重试去重，同ID异内容拒绝，冻结JSON的SHA-256全程相同；37项断言通过：`batch30-stdio-release-macos-r10.json`。该次上下文计时只是样本，不代表三轮性能预算。
- 隔离图形项目实际完成 A → B → C → A 回路、逐层返回和另一 A 入口进入同一 B，各图相机恢复且修订7不变；反馈输入期间 Agent 更新7 → 8、切图均保留文字。然而刷新后保存的进行中 composer 隐藏在总览，原批注导航会覆盖其内容。`navigation-composer-real-macos-r10.json` 保存上述通过项和刷新失败，原R7、A/B/C路径及文本仍在本地存储，未提交批注。
- 实际原生 Cmd+D 将左入口复制为同对象的新表示，子图关联、原表示及实体保持，仅修订8 → 9的一次提交通过。随后App为空，后续自由元素复制未执行：`native-copy-macos-r10.json`、`71-native-copy-blank-r10.png`。右入口复验的早期采样是9，稍后提交为10；`native-copy-crash-detail-macos-r10.json` 的9 → 9不能解释为动作未执行。只读冷载10最终页面可见，加载前错误监听确认字体Worker错误来自生产主bundle：`native-copy-cold-crash-macos-r10.json`。目前没有证据将全部空白归因于字体Worker。
- 正式历史UI上传损坏资源checksum包并重试，工作副本修订8和全部内容保持，保留重试入口，但仅显示“400 Bad Request”：`corrupt-package-ui-macos-r10.json`。服务对Error子类直接序列化，导致非枚举message缺失；HTTP与MCP显式序列化修复和真实资源校验回归14/14已通过，新生产服务/UI待复验。
- r11 UI修复已恢复进行中composer的面板可达性及导航返回，保留原观察版本和路径；补齐项目及父任务的唯一有效叶子完成/取消摘要。定向检查通过，真实UI尚未验证。
- 离线验收代理已实际逐字节校验首页、主JS、本地字体、连接描述和SSE首帧，限定CSP资源来源；这些是传输证据，尚未证明浏览器字体、图像及预览在阻断外网后正常。代理未修改原demo。
- 公开 `Browser.getWindowForTarget` 返回“No web contents in the target”，未执行后续前台化和新rAF测量：`browser-foreground-frame-boundary-macos-r10.json`。不据此放宽既定性能预算。


## 第十一至第十六轮：图形、批注和迁移补验

- r11–r16 稳定源码的最终整合结果为 **110/110 测试、TypeScript、生产构建全部通过**；对应日志 `.runtime/test-final-r16.log`、`.runtime/typecheck-final-r16.log`、`.runtime/build-final-r16.log`。生产构建实际执行独立 Excalidraw subset Worker 并得到 476 bytes，不能仅用 Worker 文件存在代替执行。
- r11 实际刷新恢复进行中输入，原话、目标、R7 观察版本及 A → B → C 路径保持；删除 C 中表示后仍可查看原版本并返回批注，14 项断言通过：`composer-observed-history-macos-r11.json`。原 r10 输入不可达失败继续保留。
- 正式 UI 损坏包补验显示具体的“项目包导入失败：资源 SHA-256 校验失败”，既有内容完全不变，保留重试入口：`corrupt-package-ui-macos-r11.json`。服务端明确序列化 Error 的 message 与代码，MCP 错误同样携带具体原因。
- 实际共享任务在 A / B 的失败状态像素均为 `[245,216,212,255]`；父项按唯一有效叶子计算，取消单列，失败 / 阻塞可见，父项自身 doing 保持：`multigraph-parent-summary-resumed-macos-r11.json`。
- 固定规模的 Node 24 生产 stdio 读取含 500 对象、20 图、1,000 表示、1,200 关系、80 自由元素、2 资源、10,000 历史和 30 条批注。三次完整读取为 **161.685 / 97.176 / 111.859 ms**，p95 不超过 1 秒，条目完整、冻结原始字节保持：`context-performance-macos-r11.json`。这是结构化上下文读取证据，图像和可见更新另验。
- r12 / r13 实际离线页面显示本地中文 / 英文字体、图片及画布，SVG / PNG 预览可用；浏览器内 subset Worker 真正返回 476 bytes。r14b 使用与上游逐字节一致的首页和强制 CSP：外部 fetch 被拒绝，230 次外部字体尝试的响应状态、body / transfer 都为零，均关联明确拒绝；本地字体和真实画布保持，重载 R22 → R22。证据 `offline-policy-macos-r14b.json`。原 r14 把 ResourceTiming.responseEnd 当成功的测量错误保留，修正按响应 / 传输及 CSP 拒绝共同判断。测试策略允许 SDK Emscripten Worker 的内部 eval，不放开外网来源。
- 实际高亮已覆盖缩放 / 平移、图范围隔离、自由元素 / 连线及 TTL。r14 只将目标从 `(80,270)` 移到 `(700,200)`，铜色高亮像素从旧位置 2,670 变为新位置 2,653、旧位置 0；仅主动位置变更 R22 → R23，五秒无额外修订，TTL 清除不写历史：`highlight-move-resumed-macos-r14.json`。最初清除探针传空 targets 被拒绝，续验使用有效短 TTL，未重复移动。
- r14 实际在三张图核对项目讨论共用、图 B 讨论仅 B 可见、批注 A 讨论仅 A 可见，原有讨论保持。只有建立隔离验收素材的一次提交 R26 → R27，导航只读：`discussion-scope-macos-r14.json`。
- 实体、自由椭圆、连线素材建立于 R28，批注 R29，删除 R30。实际依次点击三条“查看观察版本”，看到原 R28 的实体文字 / 椭圆 / 连线，返回恢复各条意见，实时数据 R30 → R30、相机不变：`deleted-targets-ui-corrected-macos-r14.json`。历史 UI 使用概览，不绘制连线文字；原说明在相同 R28 的结构化历史中精确保留。最初不支持的复合定位器和误把概览当全文预览的失败记录保留。
- 通过正式历史 UI 下载并上传 `.avcanvas`，在新独立工作副本的真实服务中查看三类讨论，原记录 / 批注精确保持，范围过滤一致，R30 → R30：`discussion-package-transfer-macos-r14.json`、`discussion-import-view-macos-r14.json`。后者的 SHA-256 按真实包 bytes 计算，并说明前者误对 Buffer JSON 哈希的测量修正。此项为同机迁移。
- 原生复制曾先后暴露 React #185、null / [] 的绑定表示差异、SDK 全局 fractional index 重编号及受管元素缺少 index 导致自由图层排序回退。修复仅规范化等价绑定和自由元素相对顺序，不忽略实际用户内容变更；r15 的自由复制 R32 → R33 七条幻影 `free.put` 已用于定向回归。
- r16 实际原生 Cmd+D 先复制业务入口，再复制自由椭圆：R33 → R34 → R35，各一次内容提交，各自五秒采样无延迟修订。新业务表示保留原实体 / 子图元数据；自由图形及内部元素均用新身份，形状保持，原表示 / 实体 / 批注不变，页面存活且浏览器错误为空。**16 项断言全部通过**：`native-copy-macos-r16.json`，已查看截图 `85-native-copy-r16.png`。r11–r15 原失败不删除。当前排序证据限于自由元素层内，任意自由元素与受管表示的跨层顺序尚未验证 / 持久化。
- r3 打包脚本携带 p1.0 实施计划和 r1.2 需求审计的便携快照，重写包内相对链接，RELEASE 清单记录计划版本。新候选须在最终构建后重新生成许可、逐项核对归档、中文 / 空格目录提取、官方 Node 24 启动和 30 条生产反馈恢复；打包后的结果存于源证据与包旁验收单，避免递归改写已校验归档。
- 本轮所有交互只使用隔离项目，原演示服务未写入。既有 Codex / Claude 模型对话的实际读取 → 回应 / 修改 → UI 关联、原生 Windows 往返及可确认调度条件下的完整可见性能仍未通过；不修改用户配置、不创建模型对话，不重复沉重探针或降低预算。

- r3 首次归档预检的内容哈希、许可覆盖和计划快照全部匹配，但许可文档生成时间仍为旧构建，预检拒绝且未提取。失败包及 SHA 保留于 `.runtime/release-candidate-r3-inventory-stale/`，原因记录 `release-archive-macos-r3-preflight-failure.json`。收集脚本现在逐项核对文档中的包名 / 版本 / 模块数，仅精确匹配且许可齐全时同步当前构建时间；重新运行通过，未改生产 bundle。


## r3 提取与 r16 页面交错：分项结果及恢复缺陷

- r3 正式归档为 20,590,621 bytes / 672 条目，671 个内容文件逐项 SHA-256 匹配；SHA-256 `5f133158a42a9357f6cf209da5fe72a27d386c039ac7c0107c97abf863af70f7`。138 项精确许可、当前构建时间、p1.0 / r1.2 便携快照及文档链接 11 项通过：`release-archive-macos-r3.json`。
- 中文 / 空格路径提取并从插件目录外用官方 Node 24.21.0 启动，stdio、已登记实际子进程停止、verified effective、EOF 服务 / HTTP / 占用释放 30 项通过：`execution-release-node24-macos-r3.json`。通用生产 MCP 的 30 条反馈恢复 37 项通过，三图 / 两个观察版本、清单独立关联、分页、28 回应 / 1 澄清 / 1 失败及中途 EOF 重启全部保持：`batch30-stdio-release-macos-r3.json`。配置生成与实际解析 9 项通过：`config-release-macos-r3.json`；验证使用本机 Python 3.11，默认 Python 缺少 tomllib 的辅助脚本启动失败不属于客户端配置失败。未应用用户配置。
- r16 原生页面交错探针初次在首次 fit 与画布像素未对齐时误选空白，创建空文字 R35 → R36，SDK 随后移除为 R37；原业务数据未改变，该失败不作产品编辑成功。保留 `interleaved-edit-macos-r16.json`、`86-interleave-target-diagnostic-r16.png`。续验先核对实际填充像素及原生编辑目标。
- 暂扣实际原生 UI 标题 POST，Agent 先提交另一状态字段 R37 → R38，再放行原 base37，请求 HTTP 200 成为 R39，用户标题及 Agent 状态都保留。再暂扣原生同字段请求，Agent 新标题 R39 → R40，放行 base39 得 HTTP409，明确显示冲突且不写新修订；几何 / 自由元素 / 批注 / 相机保持、三秒无延迟修订，22 项通过：`interleaved-edit-resumed-macos-r16.json`。
- 后续直接打开原生画布编辑器确认显示内容，R40 Agent 标题在数据中正确，但 editor 仍读到 R39 的旧标题；只读打开 / 关闭保持 R40 和完整数据。`interleaved-edit-displayed-title-macos-r16.json` 明确记录失败。该结果阻止将场景4标为整体通过，r3 归档不递归重写、保留原分项结果，后续候选需包含恢复修复。
- 根代理已要求原 canvas 修复代理仅处理冲突清理后的当前正式场景投影，避免恢复旧 pending.previous；保留相机、几何、自由元素和回声抑制。源码修复、定向检查、真实原生标题核对及 r4 提取包由后续记录承接。


- r17 第一次恢复修复的类型检查、构建及 **111/111** 通过；但真实续验 `interleaved-edit-macos-r17.json` 仍失败。不同字段的原生标题及数据均正确；同字段原请求虽 HTTP409，但三秒内 UI 以新操作 / 新 base43 自动提交旧标题，R43 → R44，原生 editor 随后显示该旧标题。完整真实历史保留在 `interleaved-edit-late-commit-detail-macos-r17.json`。仅纯投影恢复回归不足以证明拒绝后的迟到回调安全，正在补处理中的 pending 身份及回声归属；未生成 r4。

## 第十八轮：实际冲突与探针测量校正

- 第二次恢复修复增加被拒绝场景回声的语义识别；r18 类型检查、**112/112** 测试和生产构建通过，日志为 `.runtime/typecheck-final-r18.log`、`.runtime/test-final-r18.log`、`.runtime/build-final-r18.log`。构建实际执行 Excalidraw subset Worker，返回 476 bytes；构建后许可核对为 138 个精确包、140 份原始许可 / NOTICE、未解决项 0。
- 原 `interleaved-edit-macos-r18.json` 的不同字段数据及原生标题通过，但相机比较基线取于用户进入编辑之前。用户编辑引起的视口调整不能算作 Agent 更新破坏相机；后续分列进入编辑前、Agent 提交前和提交后相机。
- `interleaved-edit-macos-r18b.json` 缓存的 viewport 坐标落后于当前相机，误选空白并创建 / 移除自由文字 R46 → R47。实际查看 `87-interleave-target-r18b.png` 后，探针改用公开场景点及当前 `data-camera` 换算位置，并先确认真实填充像素和原生输入原文；原失败保留。
- 修正探针 `interleaved-edit-macos-r18c.json` 的不同字段交错 R47 → R48 → R49 全部通过，含原生标题、几何、批注、自由元素、Agent 更新期相机及三秒稳定。真实同字段交错则为 R49 → Agent R50，原 UI 请求 HTTP409 后短时保留新标题，约半秒后 UI 以新操作 ID / 新 base50 自动提交旧标题成为 R51；实际原生 editor 也读到该旧标题。`noDelayedCommit`、`nativeEditorDisplaysFinalTitle`、`nativeTitleReadDoesNotCommit` 明确失败。
- 两次源码恢复修复都未通过实际同字段链路；正在审计已排队或被替换的待提交意图。r4 尚未生成，不以自动检查或 HTTP409 单项代替拒绝后的稳定画布恢复。

## 第十九轮：待提交身份修复尚未通过真实链路

- 在冲突路径增加同 scope / graph 的待提交 scene 语义归属判断，以覆盖 in-flight A 被 callback B 替换的情况；独立内容仍保留。根代理全量 TypeScript、**113/113** 测试和构建通过，实际 subset Worker 返回 476 bytes；许可再次逐项核对，138 包 / 140 文本 / 未解决 0。
- `interleaved-edit-macos-r19.json` 的不同字段 R51 → R52 → R53 完整通过；同字段原 base53 用户标题请求被 Agent R54 抢先更新，HTTP409 / VERSION_CONFLICT 正确。约 1.5 秒后 UI 用新操作 ID / base54 重提完全相同旧标题成为 R55；原生 editor 显示用户旧标题。三个稳定 / 显示断言仍失败，几何、批注、自由元素和 Agent 更新期相机保持。
- 原生请求与 phantom 历史均只包含同一 `entity.patch.title`。父回调明确返回 `conflict`；后续需取得拒绝分支与已排队场景投影 frame 的实际顺序证据。不得把只覆盖纯函数的 113 项检查解释为此次竞态已修复。

## 第二十轮诊断：被拒绝意图由排队画面刷新重新引入

- 临时 opt-in `DEBUG-avc-r20` 仅记录 pending / 提交 / projection frame 的边界；最小探针删除不同字段案例，仅同字段也稳定复现 R55 → Agent R56 → phantom R57。原始顺序在 `interleaved-edit-macos-r20diag.json` 的 `pendingDebug`，提炼证据见 `interleaved-edit-root-cause-macos-r20.json`。诊断构建不作为发行版本。
- seq17 的 projection effect 在 R56 捕获 pending4；seq18 实际返回字符串 `conflict`；seq19 对象与 scene 归属均匹配；seq20 确实清空 pending，seq21 没有重新调度 flush。约 0.93 秒后 seq22 的已排队 frame 仍应用捕获的 pending4，而当前 pending 已为 null。seq23 因此创建 base56、`userEdit=false` 的 pending5；seq25–28 再次提交旧标题。
- 证据排除了“409 未传递”及“归属比较未命中”作为本次直接原因。实际问题是 effect 提前合成了含待提交内容的画面，清理旧意图后，迟到 frame 仍可重放旧 overlay。修复应在 frame 执行时读取当前有效投影与待提交意图，并用实际应用 scene 同步基线 / 回声；临时诊断清除后重新运行最小及原始两案例循环。

## 第二十轮稳定修复与实际复验

- `sceneForProjectionFrame` 在 frame 执行时重新组合当前正式 projection 与当前同 scope 的 pending；不再应用 effect 提前捕获的 overlay。实际应用前同步 persisted scene 基线与 programmatic echo；scope 已切换时旧 frame 放弃，同 scope 的独立新编辑继续保留。
- 根代理 TypeScript、**114/114** 全套及生产构建通过，日志 `.runtime/typecheck-final-r20.log`、`.runtime/test-final-r20.log`、`.runtime/build-final-r20.log`。构建真实 subset Worker 返回 476 bytes。`src` / `tests` 中 `DEBUG-avc-r20`、`avcDebug` 及临时诊断字段检查为空；构建后许可精确核对 138 包 / 140 份文本 / 未解决 0，清单时间 `2026-10-02T07:41:42.253Z`。
- 最小同字段复验 R57 → Agent R58，原生旧请求 HTTP409 后 R58 保持；当前正式标题在实际 native editor 中可读，打开 / 关闭不增加修订，三秒采样稳定且无浏览器错误，14 项断言通过：`interleaved-edit-macos-r20minimal.json`。
- 原始双案例及主动重写复验 **34 项全部通过**：不同字段 R58 → Agent 状态 R59 → 旧 base58 原生标题合并 R60；同字段 R60 → Agent 标题 R61，旧 base60 请求 HTTP409，实际画布显示 R61 正式标题，前后两组三秒采样无新修订。随后用户主动重开原生编辑器并重写被拒绝的原文，R61 → R62 只留一条 title 修改，再三秒无延迟提交。几何、批注、自由元素和 Agent 更新期间相机保持，无浏览器错误：`interleaved-edit-macos-r20.json`。
- 原 r16–r19 和诊断失败均保留；本次用真实原生输入及实际 HTTP 交错证明恢复链路，不以单元检查代替。当前生成 r4，本轮没有修改 AutoResearch 既有源码、原演示项目或用户 MCP 配置，也没有提交 / 发布。

## r4 本机发行候选提取验收

- 归档 `.runtime/release-candidate-r4/agent-visual-canvas-0.1.0.zip` 为 **20,945,346 bytes / 694 条目**，其中 **693** 个内容文件逐项 SHA-256 匹配；归档 SHA-256 `c7eb683cbb58989a56d655588405b921544405fd93d2a3ab3dbe72a17cff0722`。没有运行数据 / node_modules；138 项许可、当前生成时间、p1.0 / r1.2 便携快照及文档链接 11 项通过：`release-archive-macos-r4.json`。
- 提取到中文 / 空格目录，从插件目录外使用官方 **Node 24.21.0 macOS ARM64** 的真实发行入口；stdio 握手、登记执行器、实际子进程停止、verified effective 和 EOF 后服务 / HTTP / 占用释放 **30 项通过**：`execution-release-node24-macos-r4.json`。
- 提取包生产 MCP 完成三图 / 两个观察版本 / 30 条独立反馈；处理中途 EOF 重启，28 条回应、1 条澄清、1 条失败、分页完整、冻结原始字节、同 ID 重试和异内容拒绝 **37 项通过**：`batch30-stdio-release-macos-r4.json`。
- 使用提取包配置生成器生成并实际解析 Codex TOML / Claude JSON，绝对 Node 与入口、项目路径、stdio 及随机端口 **9 项通过**：`config-release-macos-r4.json`。仅保存测试配置，没有应用到用户配置。
- `release-bundle-match-macos-r4.json` 核对源 `dist`、提取文件和归档清单，**370 个生产文件完全一致**，ZIP 字节保持。打包后证据及真实 UI 的 34 项结果复制到包旁 `evidence/`；旁置验收单位于 `.runtime/release-candidate-r4/ACCEPTANCE.md`，记录全部结果。源记录包含提取后的结果，已验证 ZIP 不递归重打包。
- r4 是本机分项候选。完整交付仍需既有 Codex / Claude 模型对话读取 → 回应 / 修改 → UI 关联、原生 Windows 及 Mac → Windows → Mac、符合前台调度条件的完整可见性能；当前缺实际环境，维持待验，不用通用客户端或同机迁移代替。

## r20 收尾与 r21 完成审计

- 原演示只读返回 R76 → R76，完整快照 SHA-256 保持 `17a1938c28e6f675689b994991f5b1544ac6d4f66234a56d707808b9b88ba14b`，实际画布可见且加载期间零写入尝试：`original-demo-final-return-macos-r20.json`。
- 按端口和命令同时复核后，仅终止本轮已拥有的三个服务：64581 / PID25692、50785 / PID34822、61730 / PID43043；全部端口关闭，两个项目服务的 lock 释放。原 4317 / PID82445、R76 和快照均保持，项目 / 证据 / ZIP 未删除：`owned-service-cleanup-macos-r20.json`。
- 上一目标轮取得稳定冲突修复、114 项检查、实际 UI、r4 提取和打包证据，判为进展。当前按 p1.0 完成要求反查，发现本地可继续项：App SSE 只设置高亮，未处理 `presentation.action=focus`，未提供跟随开关或跨图定位入口。该项属于 p1.0 第 6 节及正确性场景 2，不能把既有“不抢视图”证据解释为完整跟随交互通过。
- 已交由原 gpt-5.6-luna / max 界面代理补齐默认关闭的跟随、focus 提示 / 手动查看、开启后真实场景就绪再定位、关闭恢复保护视图；保留进行中批注和原观察版本。另一个同模型只读代理核对原生分组 / Frame / 绘制顺序的已计划持久化边界。r4 保持原 hash，不因下一轮源码修改重写；下一候选在新的稳定检查后生成。

### r21 原生组织审计与补齐

- 只读源码审计和当时 52 项 canvas 检查确认：纯自由元素保留原生 groupIds / frameId，自由层内部顺序已有实现；非空分组 / Frame 的真实重载尚缺证据。受管表示仅保存几何、样式和标题，其用户外层分组 / Frame 不会持久化；投影固定先受管再自由，跨类型绘制顺序缺实现。这些属于原 p1.0 范围，不转为后续需求。
- 根代理补齐兼容可选契约：Representation.canvas、按图隔离的 Relation.canvasByGraph、Graph.sceneOrder；增加 graph.patch / relation.patch 并贯通存储、归一化事件、本地 UI 更新与受保护撤销。首次组织变更的逆操作使用明确默认前值，避免 undefined 经 JSON 丢失导致撤销为空；复制按钮分离用户组身份。[架构记录](adr/0002-native-organization-and-scene-order.md)保存决定。
- `tests/native-organization-store.test.ts` 三项实际 SQLite 检查通过：历史 / 重启 / 幂等、旧基线无关字段合并和同排序冲突、非法组织信息原子拒绝。最初检查中归一化操作的数组顺序和错误类型断言与现有协议不一致，修正为精确字段集合及现有错误码后通过；未改存储语义来迎合断言。
- 原界面代理完成跟随开关、提示、手动查看、场景就绪后 focus 和身份解析的源码实现，七项 presentation 策略检查通过，尚待实际浏览器验收。原生组织代理仅拥有 scene.ts / canvas.test.ts，继续补齐投影 / 差异路径；根代理待稳定后统一构建和实际验收。用户 MCP 配置、原演示项目及 r4 ZIP 均保持。

## r21 实际跟随失败与 r22 修复检查

- r21 源码稳定检查：TypeScript、生产构建及 **131/131** 测试通过，实际字体 subset Worker 返回 476 bytes；许可 138 包 / 140 文本 / 未解决 0。真实跟随首轮 27/28 断言通过：默认关闭、提示 / 查看、自动跨图、相机返回、草稿和原观察版本都保持，但 R63 → R64 出现历史空文本的 free.remove，完整记录保留在 [首轮失败](evidence/follow-agent-macos-r21.json)及 [实际历史](evidence/follow-phantom-history-macos-r21.json)。
- 最小加载和选择 → 批注 → 手动查看 B → 返回 A 均未复现；旧 build 完整复跑 **28/28** 通过，R66 → R66，见 [r21b 完整复跑](evidence/follow-agent-macos-r21b.json)。SDK 源码审计确认 initialData restore 会把空文本变为 deleted tombstone，现有差异路径可据此产生删除。修复仅在投影跳过 type=text 且 text 为空的自由元素，保留历史原记录；先跑红灯、再修复，双向差异 / 回声检查及非空文本正常删除回归通过。
- [新目标立即 focus](evidence/fresh-target-focus-macos-r21.json)实际失败：Agent 新表示在 R65 出现，定位却报告“不存在或已删除”，目标仍在视口外。读取 snapshot 的 ref 原先只在 React updater 执行时更新；画布就绪又只标识项目 / 副本 / 图，缺 revision。r22 同步更新 ref，并要求实际 settled scene 的版本不低于当前 snapshot / 请求版本；手动切图清除旧 pending，内部跨图定位保留匹配请求。实际复验另记录，不能以类型检查代替。
- r22 全量 TypeScript、**133/133** 测试及生产构建通过，实际 subset Worker 返回 476 bytes；日志 .runtime/typecheck-final-r22.log、.runtime/test-final-r22.log、.runtime/build-final-r22.log。仅核验并重启自有 64581 服务，旧 PID90787 已停，现 PID95814 / 官方 Node24.21.0 恢复 R66；原 4317 / PID82445 的 R76 和完整快照 SHA-256 保持。

## r22 实际通过与 r23 混合复制缺陷

- 固定 r22 生产页面的[完整跟随](evidence/follow-agent-macos-r22.json) **28/28** 通过，R66 → R66；[新节点立即定位](evidence/fresh-target-focus-macos-r22.json) **6/6** 通过，R66 → R67 仅新表示一条修订，目标原先在视口外，最终真实可见且缩放保持；[手动覆盖待执行导航](evidence/follow-manual-override-macos-r22.json) **7/7** 通过，R67 → R68 仅 fixture 修改，公开浏览器帧门延迟投影后用户选择 C 生效，回 B 恢复相机，旧 focus 不重放，原批注上下文保持。帧门不用于性能结论。
- [原生受管分组](evidence/native-managed-group-initial-macos-r22.json)保存 R68 → R69，两表示共享外组、业务对象 / 自由元素保持；[重载、解除和受保护撤销](evidence/native-managed-group-reload-undo-macos-r22.json) **8/8** 通过，重载不写，原生解除只选一个成员即可影响两成员，R69 → R70；撤销 R70 → R71 恢复精确组织字段。
- 混合绘图最初直接点击隐藏 radio 被图标命中阻挡，随后未等实际缩放稳定导致绘制点落在工具面板，属于探针失败。[校正后的原生自由矩形](evidence/native-free-draw-macos-r22b.json)在实际缩放、公开诊断与 canvas 命中一致后 R71 → R72 保存。混合分组 / 复制随后实际保存至 R74，但页面无响应；[失败现场](evidence/native-mixed-copy-timeout-macos-r22b.json)保留。验收期间只读代理越界执行构建，根代理叫停，未将混用构建的结果计为通过。
- 发现混合复制虽新增跨类型成员，旧成员相对顺序不变，缺 graph.patch；新增受管 ID 也需映射到重投影 canonical ID。根代理在临时去掉新检测分支时两项回归红灯，恢复后绿灯，日志 .runtime/test-mixed-order-old-r23.log 和 .runtime/test-mixed-order-fixed-r23.log。固定 r23 类型检查、**134/134** 与生产构建通过，实际 subset Worker 476 bytes，138 包 / 140 许可文本 / 未解决 0。
- 普通重载及 Runtime.terminateExecution 都不能恢复旧无响应页，根代理仅关闭本任务管理的 p1，在同一 TaskSpace14 建立 p3，保留 p2，无新增空间或配置。通过一条版本化 graph.patch 将 owned R74 的旧混合复制顺序恢复至 R75，保留四个表示、两个自由元素及全部业务实体；[该修复](evidence/native-mixed-owned-fixture-repair-macos-r23.json)不作新复制通过证据。
- r23 实际重新打开混合图即持续产生内容修订，[native-mixed-copy-macos-r23.json](evidence/native-mixed-copy-macos-r23.json)在复制动作之前的 start 稳定等待失败；[完整重复写入现场](evidence/native-mixed-echo-loop-macos-r23.json)记录 R75 → R303，最后每条均只 free.put 同一个已复制自由矩形，其 groupId 不断重复添加 canvas-group-copy 前缀，copiedFromFreeElementId 仍保留。根代理核验并停止 owned 64581 / PID2473，p3 置 about:blank 停止页面运行。原 4317 / PID82445 的 R76 及已确认 SHA-256 保持；r4 ZIP 未改。
- 直接机制是复制组映射仅按 copiedFrom 标记识别，没有限定本次新引入身份；保存过的复制自由元素在后续投影回声中再次被映射。已授权 scene.ts / canvas.test.ts 定向修复，要求先以首次保存后双向 diff=0、已有复制元素参与后续复制但旧组不变建立红灯，再限定新身份；禁止并发构建或服务操作。Frame、跨类型层级与 r5 仍待这一实际缺陷修复后的固定版本验收，未生成新发行候选。

## 实施基线确认与暂停状态

- 本次读取实施目标返回 `paused`。完整计划 p1.0 与需求审计 r1.2 保持；只确认文档，不启动实施、构建、服务或浏览器验收。
- 原生持久化工作代理已停笔，仅报告修改 `src/canvas/scene.ts` 与 `tests/canvas.test.ts`：复制组映射、自由元素组映射及复制自由元素集合均限定本次新身份；新增保存后零操作回声及再次复制时旧组保护回归。代理报告先有 2 项失败，修复及补强后专项 64/64 通过。此为代理自报，未升级为根代理或产品通过证据。
- 恢复实施后的第一项仍是复核该修复与红绿回归，再由根代理顺序进行全量检查、固定构建、隔离数据修复及真实混合复制稳定性复验；随后补 Frame / 跨类型层级、相关回归与发行提取验收。原失败证据与 r4 候选继续保留。

## 本机部署 r1 与重启后演示准备

- 用户明确要求“直接本地部署然后接到当前 codex 会话里，重启后……做演示”，授权安装与客户端配置，前一暂停状态不再阻止该范围的工作。未启动新的模型对话或后台自动任务。
- 根代理复核新身份组映射与旧复制保护，实际运行类型检查、136/136 全量测试。日志：`.runtime/typecheck-local-deploy-r1.log`、`.runtime/test-local-deploy-r1.log`。
- 在 `.runtime/local-deploy-20261002-r1/workspace/` 中构建独立源码副本，未改变原 4317 服务使用的源 `dist`；真实 subset Worker 返回 476 bytes。138 个依赖 / 140 许可 / 未解决 0。安装解压校验 733 个清单文件，本机预览版本为 `0.1.0-local-20261002-r1`，不冒充完整 r5 发行验收。
- 安装入口经实际 stdio 检查 30 项通过，记录 `.runtime/local-deploy-20261002-r1/execution-installed.json`。[安装页面混合组检查](evidence/native-mixed-copy-installed-r1.json) 16 项通过：R2 → R3 仅真实复制，重载及延迟窗口零写入，独立解除复制组 R3 → R4，原组 / 自由图形 / 实体 / 批注保持。尚未补齐 Frame、跨类型层级和全部相关 UI 回归。
- 独立项目有 18 个对象、6 张图及三条预置演示批注，原观察版本与原话保留，预检客户端未认领或回应。最终项目级配置由实际 CLI 在后续独立调用中确认启用；最初全局写入没有保留，未将其报告当最终配置。正式宿主模型接入和图上回应仍待重启后的本对话验证。
- 固定安装路径、数据身份、最终配置和演示步骤见[本机部署记录](LOCAL_DEPLOYMENT.md)。现有全局连接、原演示项目和 r4 ZIP 保留。

## 当前会话论文演示与交互修订

本轮完成与遗留项见 [CURRENT_SESSION_DEMO_2026-10-02.md](CURRENT_SESSION_DEMO_2026-10-02.md)。源码和构建在独立 `.runtime/canvas-ux-20261002-r2/source` 中验证，当前 UI 静态资产已更新，现有 stdio 进程保持。R36/R39 是两条独立演示批注的内容修改，R37/R40 是各自回应，批次状态 responded。R44 只将已经实测的演示任务标记完成，未修改论文结构模块的执行状态。

复验发现并修复三个问题：SDK 默认图片 crop 补全造成额外修订；子图父节点在 React 延迟 updater 中读取了已切换的图；只有自由图片的图误显示空图提示。前者有实际失败和红绿回归，后两者经真实页面父面包屑/相机与原图验证。浏览器探针的一次误点在 R42 留下零尺寸椭圆，R43 仅移除该探针；历史保留，不计入产品能力通过证据。

## 2026-10-06 r22 选区控件增量

同行研究与改造合同见 [控件改造](CONTROLS_REDESIGN_2026-10-06.md)。新增独立混合框选、Shift 增减、集中选区工具条、多组结构动作、明确的成员范围与批量位置操作。284项测试及独立副本的删除/解散/撤销通过；正式内容不因观看与UI更新改写。完整V1其他待验项保持，任意密集概览标签避让、整组拖动及自由变形仍需后续验收。实际部署版本以LOCAL_DEPLOYMENT与运行display_facts为准。
