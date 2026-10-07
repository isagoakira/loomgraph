# Agent Harness 架构与分层实施路线

日期：2026-10-07。范围：独立 Agent Visual Canvas 插件。本文区分已存在的源码能力、本次契约修复和下一阶段方案；源码检查、安装构建、当前宿主工具、浏览器呈现与真人理解分别验收。

本轮实施及安装/浏览器验收已补充到 [实施与验收记录](AGENT_HARNESS_IMPLEMENTATION_2026-10-07.md)。下面的分层事实与后续边界继续适用；live UI 与当前宿主 MCP 的版本差异以该记录为准。

核心判断：当前系统是一组可追踪的表达与编辑工具，宿主 Agent 负责选择和调用这些工具。插件没有自动调用模型的 planner，也没有已经接通的宿主收件桥。应先把既有读取、预检、事务和回执串成有界局部流程，再扩展表达策划和增量维护，避免每次重写整图。

## 1. 已实现的基础

| 层 | 当前入口与责任 | 实际边界 |
| --- | --- | --- |
| Host skill | `.codex-plugin/plugin.json` 声明 skills 与 MCP；`skills/agent-visual-canvas/SKILL.md` 提供使用契约 | 技能可被宿主发现，不等于每轮已加载或已执行。`defaultPrompt` 只是入口提示 |
| 有界读取 | `canvas_read(mode="expression")` → `buildExpressionContext` | 明确目标及一跳邻域，保留版本、稳定身份、组织路径和 omissions；读取不会修改项目 |
| 表达 prompt | `expression_prompt` → `buildExpressionPrompt` | 返回当前 Agent 可使用的任务文本；不发送给模型、不自动注入宿主 |
| 有界 recipe | `expression_recipe` → `buildExpressionAuthoringRecipe` / `compactAuthoringRecipe` | 本轮已接入源码；返回 recipe 与有界 context，属于当前 Agent 主动使用的工作说明，安装/live 验收另记 |
| 确定性预检 | `expression_check` / `expression_validate` | 检查表达字段、局部修改范围、动作、组织和几何约束；不证明事实或执行 |
| 事务 | `canvas_apply` → `CanvasProtocolService.apply` → `CanvasStore.apply` | 身份、版本冲突、幂等操作 ID、引用与事务持久化；表达预检目前仍是调用者主动使用的步骤 |
| 布局 | MCP 通用 `proposeLayout`；笔记 `maintainNotebookFromSnapshot` → `maintainNotebook` | 通用 MCP 候选只移动 representation。笔记维护可用真实测量与组织层级，临时维护不写源几何 |
| 显示回报 | 浏览器捕获 DOM/Excalidraw 事实 → `/api/display-facts` → `display_facts` | 报告当前版本、build、可见 refs、几何、展开与诊断；与内容事务分开 |
| 反馈回执 | 冻结批次 → handoff → claim → respond | 每条批注独立保留目标、原话、观察版本与 changeIds；冻结观察和当前处理状态分开 |
| 运行记录 | `RunRecord`、executor、control request 与验证 receipt | 任务标签、请求排队、收到消息、内容保存均不能代替执行观察 |

关键实现见 [`src/server/index.ts`](../src/server/index.ts)、[`src/expression/context.ts`](../src/expression/context.ts)、[`src/expression/checks.ts`](../src/expression/checks.ts)、[`src/store/canvas-store.ts`](../src/store/canvas-store.ts) 和 [`src/hosts/index.ts`](../src/hosts/index.ts)。这些函数具有确定的数据入口；原有 prompt 中的叙事要求属于指导，不能写成已经自动运行的策划器。

## 2. 本次契约修复

本节记录已落地源码；安装构建、当前宿主、真实页面与收件验收由 root 单独记录，以下接入不表示 live 验收通过。

1. **统一排版 owner。** `buildExpressionContext` 现在复用布局层的 `organizationLayoutOwner`，输出 canonical `layoutOwnerByRef`。输入只有旧 `ownerByRef` 时可兼容读取；存在 canonical map 时优先使用它。多 membership 没有有效显式 owner 时保留缺口，不默选第一簇。单个 entity 的多个 representation 仍是独立 placement。
2. **统一动作接口。** `canvas_read.action` 可为动作字符串或 `{kind, reason, instruction, targetIds}`，补齐 `organize/move/reuse/restore`。组织删除的 `reparent/unassign` 策略可通过 `reason` 到达预检；HTTP 支持 JSON 编码对象 action。
3. **保留模式回执提示。** MCP 注册包装器合并原 hint，保留 `quotedContext`、`contentRevisionChanged`、page 与 next。prompt 指向后续预检，不因包装器覆盖而丢失模式语义。
4. **拆开内容澄清与显示验收。** stale/missing browser facts 仍使上下文标记为 partial，并列出显示缺口；仅这一原因不再设置 `needsClarification`。Agent 可以继续有界语义编辑，结果注明显示尚未核验。材料不足、最低结构缺失或 canonical reconciliation 仍有自己的澄清条件。
5. **明确宿主行为。** `canvas_read` 描述推荐有界上下文 → prompt/支持的 recipe → operation preflight → apply → display read。描述明确任务文本不会自动注入宿主或发送给模型。
6. **限制邻域写入。** prompt 现在明确：自动收集的一跳邻域是只读承接背景，只有明确 targets 默认可修改。必要范围扩展先声明 additional stable target IDs/reason，再补读和预检；已获任务授权的例行扩展不重复要求用户确认。
7. **局部请求源码接入。** selection toolbar 的“让 Agent 处理”接到 inline `AgentRequestComposer`，冻结当前目标与观察范围。独立请求可分项保存，再以一个事务创建独立 annotations 和 `awaiting_host` batch；本机入队不冒充宿主收件。见 [`src/ui/SelectionToolbar.tsx`](../src/ui/SelectionToolbar.tsx)、[`src/ui/AgentRequestComposer.tsx`](../src/ui/AgentRequestComposer.tsx)、[`src/ui/agent-request.ts`](../src/ui/agent-request.ts) 与 `App.beginAgentRequest/submitAgentRequest`。
8. **执行态显示源码接入。** `ExecutionBadge` 使用 `deriveExecutionPresentation` 的运行观察投影；只有 verified、在线 executor 与新鲜 running 才产生动效。可见页面用 10 秒本地时钟刷新过期状态，默认 120 秒 stale；页面隐藏时停止刷新/动效，reduced motion 保留静态状态表达。见 [`src/ui/ExecutionPresentation.tsx`](../src/ui/ExecutionPresentation.tsx)、[`src/ui/execution-presentation.ts`](../src/ui/execution-presentation.ts) 与 [`src/ui/execution-presentation.css`](../src/ui/execution-presentation.css)。这些不是向执行器发送的 heartbeat。
9. **recipe 与主动技能入口接入。** `canvas_read` schema、模式分支与工具描述已经接入 `expression_recipe`；返回 compact recipe、同一版本的 bounded context、omissions 及 `hostAutoInjection:false`。`expression_prompt` 将 recipe 工作说明与表达 task text 合并。新技能入口要求先 `canvas_open` 核对当前 schema，再主动执行 **read → plan → preflight → apply → display**；没有支持模式的旧进程继续用已有读取或 UI 任务复制。见 [`skills/agent-visual-canvas/SKILL.md`](../skills/agent-visual-canvas/SKILL.md)、[`src/server/index.ts`](../src/server/index.ts) 与 [`src/expression/authoring.ts`](../src/expression/authoring.ts)。recipe 服务接线已经完成；installed/live、显示与真实 Agent 流程分别验收，不把源码接线宣称为自动 planner 已执行。
10. **请求恢复与传输回执。** scoped drafts 使用独立的 workspace 存储键，身份指纹由稳定 targets/content anchors 组成，不包括 revision；恢复保留最初冻结的 scope、observedRevision、组织与视图。最多持久化 30 条非空或 pending 记录，pending payload IDs 不为容量限制而静默删除。App 和 API 按工作副本保留页面内缓存，实际存储失败通过草稿 boolean 与 `pendingDurable:false` 报告。pending 状态冻结文本/类型并阻止重提；ACK 后才清除对应 draft。批次 ACK 优先读取 canonical snapshot，旧 replay 不覆盖已经 responded 的记录或降低版本，读取失败时缺省 `submittedRevision` 使用实际 ACK revision。见 [`src/ui/agent-request-drafts.ts`](../src/ui/agent-request-drafts.ts) 与 [`src/ui/api.ts`](../src/ui/api.ts)。

回归覆盖 canonical/legacy owner 优先级、多 membership 无 owner、只读投影、显示 stale/missing、组织动作和 reason、真实服务 HTTP 读取与 MCP handler hint。见 [`tests/expression-organization.test.ts`](../tests/expression-organization.test.ts) 与 [`tests/server-read-contracts.test.ts`](../tests/server-read-contracts.test.ts)。此前相关的 7 个定向文件共 37 项通过；新增邻域只读 prompt 回归单独记录，不将这个数字扩展为 inline request、ExecutionBadge 或真人交互的验收。运行中的旧 MCP 进程和浏览器不因源码修改自动升级。

最后一次请求/反馈定向回归为 5 个文件 26 项通过，类型检查通过。其中 [`tests/agent-request-drafts.test.ts`](../tests/agent-request-drafts.test.ts) 9 项覆盖冻结范围、工作副本隔离、损坏数据与 pending 保留；[`tests/agent-request-transport.test.ts`](../tests/agent-request-transport.test.ts) 5 项覆盖非乐观入队、ACK 丢失、真实 batch revision、session-only 存储、已响应 replay 与迟到请求的工作副本隔离。这些是源码与本地真实服务回归，不代表当前安装或浏览器交互已验收。

## 3. 字段责任与写入规则

| 数据位置 | 谁负责、修改什么 | 必须保留的边界 |
| --- | --- | --- |
| `entity.metadata.semanticContent` | 内容编辑维护共享摘要、分节、正文、来源 | 不复制成每张图各自的正文；section/paragraph ID 不能按新坐标或临时顺序重造 |
| `entity.metadata.expression` | 表达编辑维护 takeaway、keyPoints、input/output、terms、evidence、progress | 不把 expression 完成度写成执行状态；合并其他 metadata namespace 和未知字段 |
| `relation.kind/from/to` | 业务或知识语义维护规范关系 | 不因画成树、流程或反馈线而改写关系含义；仅 `depends_on` 受执行 DAG 约束 |
| `relation.metadata.expression/presentation` | 解释连接理由、传递内容和视觉 notation | 解释、视觉语法与业务 kind 分开；原生 `canvasByGraph` 是另一项 graph-scoped 展示数据 |
| `graph.metadata.expression` | 维护读者问题、主线、术语表与阅读路线 | 阅读顺序不由坐标、线方向或层级推断 |
| `graph.metadata.organization` | 维护 cluster 身份、parentId/order、members、entry/exit、links 与 `layoutOwnerByRef` | 组织层级不是业务父项、另一张 graph 或执行依赖；owner 决定位置责任，复用 membership 不复制 placement |
| `representation` / `freeElement` | 几何编辑维护一次图上表示、文本框或图解部件的位置与大小 | 稳定 ID、pinned、native group/Frame/sceneOrder、未知 customData 保留；内容修改不自动移动对象 |
| view / measurement / selection | 浏览器维护本次展开、选择、焦点、视口、实际测量与 display facts | 属于临时观察，不能写回 canonical organization、内容或原生绘制顺序 |
| annotation / batch | 用户形成冻结观察，Agent 增加独立响应 | 原话、stable targets、observedRevision、组织 membership 与 content anchor 不覆盖；处理结果独立累计 |
| run / executor / request / receipt | 实际执行器报告来源、时间、能力、运行状态和控制结果 | 没有真实观察就保留未知；有效 stop 必须有已终止的验证 receipt |

字段责任是修改权限和协作责任，`layoutOwnerByRef` 只表达 placement 的排版责任，不授予执行权限。

存储冲突粒度目前为对象的顶层字段，例如 `entity.<id>.metadata`、`graph.<id>.metadata`；不是每个 metadata 子字段都能独立自动合并。Agent 必须读基线、生成局部 patch，写 metadata 时显式合并当前其他 namespace。不同顶层字段可以在旧基线上无冲突合并；同一字段冲突后，重读相关对象，比较原意与新值，再生成新操作。不能只换一个新 baseRevision，把旧整对象再次提交。

同一次请求的 `operationId`、actor、reason 和 operations 必须稳定。丢失响应时使用相同 ID 与相同内容重试；同 ID 改内容产生冲突。获得 apply 回执后记录真实 `changeId/revision/affectedIds`，不把准备好的 operations 当作已经保存。

## 4. 已接入的有界 recipe 与后续语义策划

本轮 `expression_recipe` 已在服务源码提供可检查的局部工作说明，由宿主 Agent 主动读取和执行。recipe 先说明修改范围、可读背景、预检与验收步骤，不承担自动调用模型的职责。技能写明 read → plan → preflight → apply → display；服务返回文本/结构后，每一步是否执行仍依赖实际 Agent 工具调用及其回执。后续语义方案可以作为独立候选数据加入，而不替换事务存储。

建议候选只包含：

- 项目/工作副本身份、graph、baseline revision、稳定目标 ID 与 action/reason。
- 读者当前问题和主线结论；本轮新增或修订的原子支线及必要旧概念的一行复述。
- 每个内容块、关系与图解的表达责任，来源与 evidence kind，以及哪些邻域只供理解。
- 需要写入的局部 operations；需要布局时另列几何候选及测量版本，不混成正文修改。
- 预检问题、未读材料与 omissions；预期受影响 refs 和保存后验收要求。

图解责任应回答“哪个内部关系必须通过图形解释”，例如概率分配、分类分工、时间边界或反馈机制。图解部件用稳定 figure/part 身份引用知识中心，注明来源与示意边界。装饰图标、顺序卡片或框线数量不能作为语义方案通过的依据。

预检仍先调用现有 `expression_validate`。下一阶段可以让候选在隔离的投影 snapshot 上检查协同操作，例如先替换 cluster anchor 再删除旧 anchor；当前逐项针对基线的检查不能被当作这类候选已经通过。技能和 recipe 的 preflight 是调用者遵循的工作契约；当前通用 `canvas_apply` 不要求 expression validation token，也不自动强制运行这项表达预检。

## 5. 增量 dirty scope

“看过”与“可以改”必须分别记录。明确选区是写入种子；一跳邻域是只读背景。`graphId` 只提供共享主线与组织背景，不把单个目标升级为整图授权。

建议局部流程按下列顺序派生范围：

1. 冻结用户实际选中的 stable targets、观察版本、graphPath、content anchor、organization anchor 与 observedView。
2. 将 targets 解析成内容 dirty IDs：entity、relation、representation、free element；别名解析保留同一 entity 的多个 placement。
3. 从冻结种子扩一次邻域，受 maxNeighbors、items 和 bytes 限制；将这些 IDs 标为只读 support refs。需要改变某个背景对象时，明确增加写入目标并再次预检。
4. 从变更字段推导检查范围：正文只检查相关知识中心及必要承接；关系端点/含义变化检查对应端点；术语定义变化检查实际引用它的目标；parent/owner 改动检查相关簇及层级约束。
5. 从实际测量变化推导 layout dirty refs：尺寸变化涉及当前 owner、可见局部邻居和对应连接。普通状态或来源文字更新不触发全图重排。pinned、locked、未受影响的可见对象保持固定。
6. 浏览维护可临时调整受影响对象并补偿阅读锚点；变更归属、顺序、方向或固定对象几何时生成显式 candidate。隐藏对象不因当前视图整理而被移动。
7. 保存后用 `affectedIds` 与本轮 ID 映射恢复具体 refs，重新读取局部范围并请求显示验收。`affectedIds` 是事务对象集合，不能直接当作所有图的全部 placement 都应移动。

候选至少绑定 source revision、organization token、measurement epoch/scope、geometry baseline、target IDs 和固定约束。任一前提变化就废弃旧候选，不应用迟到测量或旧几何。布局已具备部分这些输入，见 [`src/layout/notebook-maintainer.ts`](../src/layout/notebook-maintainer.ts) 及 [`src/layout/notebook-maintainer-adapter.ts`](../src/layout/notebook-maintainer-adapter.ts)；目前并无覆盖所有表达变化的统一 dirty planner。

## 6. 可读性与显示验收

| 表达要求 | 自动检查能确认什么 | 实际验收需要什么 |
| --- | --- | --- |
| 问题主线 | objective/thesis、路线身份与必需字段存在 | 读者能指出当前问题、结论和下一步为什么承接 |
| 原子支线 | 一个知识中心有 takeaway/keyPoints、明确关系解释 | 支线可独立理解，必要分工/依据/反馈没有被压成顺序箭头 |
| 局部复述 | 术语定义、输入输出与阅读上下文有数据 | 长分支、主题切换和远距复用处，定义与本步用途在现场可读 |
| 图解责任 | 来源、evidence、caption、稳定 part 映射可检查 | 图形内部实际解释机制；示意数字不会被误读为实验结果 |
| 文字与关系 | DOM/scene 尺寸、可见 refs 和部分维护诊断 | 截图核对裁切、遮挡、字体、图像加载、图例、关系标签和层级 |
| 阅读稳定 | 固定几何、view epoch、reading anchor 与 viewport 可比较 | 保存、展开和局部整理后，阅读位置保持；无需反复跳转才能理解 |

`display_facts.status=current` 表示服务最近接受了一份同项目、工作副本、图、当前修订及匹配 build 的浏览器报告；不是真人验收。`measured=true` 表示报告中的几何已被测量，也不能保证文字没有裁切、图片已经解码或图形含义正确。

当前 `visibleRefs` 由组织过滤后的 DOM/scene 渲染身份派生，不是逐项与屏幕视口相交后的清单。报告附带 viewport，但“已渲染”“实际在视口内”“没有被遮挡”“读者理解了”仍是四个不同判断。下一阶段显示回执应增加实际 viewport intersection、裁切/溢出、资源加载与测量来源，再用截图核对视觉结果；理解验收需独立的小问题或回述任务。

推荐的保存后回执分开列出：事务已保存及 changeId/revision；表达预检与复查结果；显示 current/stale/missing；ui/server build、受影响 refs、测量质量与诊断；截图或真人理解检查是否完成。显示缺失应报告“已保存，显示未验收”，不把它转换成用户意图缺失。

## 7. 反馈与宿主桥

[`src/hosts/index.ts`](../src/hosts/index.ts) 当前声明 generic text handoff 可用，Codex 原生 annotation 与 Claude channels 不可用。复制批次引用、保存 batch、工具入队或 UI 动画均不能证明宿主 Agent 收到。没有桥时保留 `awaiting_host`，提供可复制引用；实际 Agent 接到引用并读取冻结批次后才 handoff、claim 和 respond。

[`src/ui/agent-request.ts`](../src/ui/agent-request.ts) 中的局部请求 helper 冻结每条 annotation 的观察，将独立草稿放进 `awaiting_host` 批次。selection toolbar → inline scoped composer → 原子创建独立批次已经在源码接入；当前安装是否加载、页面实际交互、宿主是否收件仍待 root 验收。源码接入只证明路径存在，不能替代这些实际观察。

传输 pending 和服务 queued/`awaiting_host` 分别表达两个阶段。前者只保存原始 request payload，不将未确认 annotation/batch 乐观投影为已保存内容，也不为这类 pending 请求登记可撤销的实际修改；后者有服务事务 ACK，仍不等于 Agent 收件。持久化成功才能声明本机恢复；`pendingDurable:false` 或草稿保存失败表示仅当前页面保留，刷新或关闭页面可能丢失。关闭 composer 保留同 scope 草稿，工作副本切换不借用另一份 scope；迟到回执按原工作副本处理。

每项响应保留自己的 annotationId、status、文本和真实 changeIds。局部澄清不会阻塞其他独立事项。组织 membership 使用冻结 clusters/ancestor paths/selected refs 解释原意，当前 diff 单独报告；不能把后来扩大或改变的选区冒充原批注范围。相关实现见 [`src/core/organization-feedback.ts`](../src/core/organization-feedback.ts) 与 `CanvasProtocolService.feedbackClaim/feedbackRespond/feedbackHandoff`。

## 8. 阶段动态与证据驱动更新

| 状态 | 可用事实 | 应如何显示 |
| --- | --- | --- |
| 内容准备 | 表达候选、已保存正文、artifact 等 | 显示准备/保存状态，不制造运行进度 |
| 等待宿主 | `awaiting_host` 与批次引用 | 明确等待接收；复制按钮或动画不转成 received |
| Agent 处理 | 实际 handoff/claim/逐项回应与 changeIds | 显示对应事项的处理状态，保持独立结果 |
| 执行请求 | control request 的 awaiting_delivery/received | 显示请求状态，不转成运行已生效 |
| 已观察运行 | 真实 run、executor、source、updatedAt 与 verified receipt | 动态应绑定 runId 和最后观察时间；状态文字和来源始终可读 |
| 执行结束 | completed/failed/stopped 及对应真实 receipt | 展示结果与检查依据；stop 有 terminated 验证后才生效 |
| 观察过期 | 按执行器/任务协议计算的 heartbeat 或 lastObservedAt 超时 | 显示 stale/未知，并保留最后事实；不擅自改为失败或已停止 |

当前已有运行与控制 receipt 的数据结构、验证流程及来源/时间展示；`OrganizationActivityPanel` 可以区分任务标签和 run 来源。本次新接入的 `ExecutionBadge` 使用严格 `verified === true`、executor 在线及 120 秒内观察来驱动运行动态，10 秒本地时钟只刷新显示 expiry；hidden page 不持续动画，reduced motion 改为静态显示。源码路径已接入，installed/live 尚待 root 验收。

既有组织摘要的 `taskSummary.executionObserved` 仍使用 `verified !== false` 的兼容规则；它不等于 `ExecutionBadge` 的新鲜运行判定。执行器 heartbeat 的频率、允许延迟和主动探测尚未成为完整协议。不能据旧 running 记录推断此刻仍在运行，也不能把浏览器 20 秒 display 上报或 10 秒本地 expiry 时钟当成执行器 heartbeat。

下一阶段每个 executor 明确 heartbeat 频率、允许延迟、来源和 stale 判定；运行派生状态依赖真实观察而非动画计时。动效只帮助识别已观察的活动或局部更新，不能模拟进度百分比。`prefers-reduced-motion` 下停止脉冲、移动与循环动效，仍用状态文字、时间与来源完成同一表达；浏览器失焦或观察 stale 后也停止“正在运行”的持续动效。

## 9. 分层落地与验收顺序

1. **契约对齐：本次完成。** owner、string/object action、模式 hint、显示未验收与澄清分离。先通过模块、协议与 HTTP 回归，再核验新构建及当前宿主 schema。
2. **有界 recipe：源码已接入、实际流程待验收。** 服务和技能提供目标/只读 support refs、字段责任、预算与建议流程；宿主 Agent 主动调用。后续验收局部目标不会扩散、omissions 可追踪、旧 schema 能明确报告能力差异，以及一次真实 read → plan → preflight → apply → display 的独立回执。
3. **局部语义候选：后续。** 给问题主线、原子支线、图解责任与结构化 operations 一个可读候选；加入投影后协同预检，保留当前通用事务接口。以两个实际局部案例验证保持身份、固定位置与其他 metadata。
4. **布局与显示回执：后续。** 把现有 notebook maintainer 作为支持测量的 MCP candidate 通道；记录保存版本与显示版本的对应关系，增加视口、裁切和资源加载检查。验收 stale candidate 被拒绝、受影响对象可见、阅读锚点保持。
5. **增量调度与运行动态：部分源码接入、继续验收。** inline 请求与 ExecutionBadge 的 local expiry/hidden/reduced-motion 已接入，installed/live 待 root。后续根据字段和测量产生有界 dirty scope，补 executor heartbeat 协议。验收延迟回调、同字段冲突、幂等重试与真实运行/停止回执。
6. **宿主桥：独立接入。** 先检测实际渠道及能力，再验证准备、发送、宿主 ACK、Agent 读取和逐项响应。桥不存在时继续使用短引用交接，状态保持等待，不伪造收件。

完整交付需要逐层证据，不能由一个全量测试数字或一份 current browser report 代替。现有工作流细节见 [`EXPRESSION_AGENT_WORKFLOW.md`](EXPRESSION_AGENT_WORKFLOW.md)；控件和外部产品研究另见 [`research/AGENT_CANVAS_INTERACTION_REFERENCES_2026-10-07.md`](research/AGENT_CANVAS_INTERACTION_REFERENCES_2026-10-07.md)，本文件不重复其交互分析。
