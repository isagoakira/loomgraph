# Agent Canvas 交互参考：选区上下文、增量预览与图上协作

日期：2026-10-07  
范围：tldraw Agent Starter Kit、Miro AI、n8n 及相近的流程画布机制；迁移到本地 stdio MCP 的交互边界。  
本报告是只读同行研究和产品分析，不修改源代码、共享 contracts、MCP 配置、正式画布或远端服务。

## 结论先行

Agent Canvas 的最短可读协作回路应当是：

**选择对象或区域 → 为每条意见保留独立批注 → 一次显式“交给 Agent” → Agent 读取冻结上下文并声明领取 → 例行局部改动走读/预检/提交，主线、归属、固定几何等高影响结构改动才生成可审阅候选 → 按现有授权提交或逐条处理 → 需要执行时再显示请求、回执和运行状态。**

这条回路有四个硬边界：

1. **选区是上下文入口，不是执行授权。** 选区、viewport 和 prompt 要把“看哪里、改什么、为什么改”组合成一份有版本的 context；点击选中或写下评论，都不等于 Agent 已收到或已经执行。
2. **增量是差异和阶段的连续呈现，不是整张图重画。** tldraw 的 Agent action 流和 Store `RecordsDiff` 提供了可借鉴的技术分层；本地产品应把预览差异、正式变更和运行结果分开。
3. **动态阶段必须有明确状态来源。** n8n 的 `Running`、`Waiting`、`Success`、`Failed` 和 dirty 输出说明，图上的颜色只能是运行事实的投影，不能替代运行记录；“请求已入队”也不能写成“已执行”。
4. **批注、Agent 回应、Canvas change、Run receipt 是四种不同事实。** 讨论可以独立存在；只有显式 handoff、claim、respond、apply 和 verified receipt 才能推进下一层状态。

以下先列官方资料确认的行为，再给出迁移推断，避免把同行产品能力误写成本地已有能力。

## 1. 已验证的官方机制

### 1.1 tldraw Agent Starter Kit：从选区和 viewport 组装 context

官方 Agent Starter Kit 的右侧 chat panel 支持对话、添加上下文和查看历史；默认 Agent 能创建、更新、删除形状，执行多对象对齐/分布等操作，移动 viewport，维护 todo，并在后续请求中继续工作。[tldraw Agent Starter Kit](https://tldraw.dev/starter-kits/agent)

官方列出的 Agent 输入不只有用户文字，还包括：

- 当前选中的 shapes；
- 用户当前可见的屏幕区域；
- 用户额外指定的 shape 或画布区域；
- 最近的用户操作；
- 当前 viewport 的截图；
- viewport 内 shape 的简化结构；
- viewport 外按区域聚合的 shape cluster；
- 当前会话历史与 shape lint。

这说明“当前画面”至少要拆成两种粒度：当前视口给出视觉和空间关系，选区/显式 context 给出模型需要精读的对象，远处 cluster 只承担存在感和导航线索。官方 AI 文档也给出 `agent.prompt({ message, bounds })` 的调用形态：prompt 可以附带一个明确的 bounds，而不是要求模型猜用户想改哪一块。[tldraw AI integrations](https://tldraw.dev/docs/ai)

**事实边界：** 官方文档确认了 selection、viewport、bounds、结构化 shape context 的组合，但没有规定本地项目必须照搬某个固定 prompt 文本，也没有证明“所有被选对象都自动进入完整细节模式”。Starter Kit 自己区分了 viewport 内的 `BlurryShape`、用户聚焦的 `FocusedShape` 和 viewport 外的 `PeripheralShapeCluster`。[Agent Starter Kit 的 shape formats](https://tldraw.dev/starter-kits/agent#send-shapes-to-the-model)

### 1.2 tldraw action、mode 与增量流

tldraw 将画布操作拆成 typed action schema 和 `AgentActionUtil`：每个 action 负责验证、清理、执行，并决定在 chat history 中如何显示；mode 决定当前 Agent 可以看哪些 prompt parts、可以调用哪些 actions。官方示例允许为同一 Agent 建立更窄的 critique 或 planning mode，而不是让每个请求永远拥有全量能力。[Action / mode architecture](https://tldraw.dev/starter-kits/agent#architecture)

Agent 响应会流式返回；官方说明 shape 的创建、更新、删除会随着 action 完成而增量体现，长任务期间画布保持响应。[Streaming system](https://tldraw.dev/starter-kits/agent#streaming-system-real-time-ai-responses) 这提供了一个重要的 UX 参考：用户可以看到 Agent 正在处理的阶段和已经产生的局部结果，不必等一段不可见的黑盒工作结束。

但“流式 action”不等于“自动提交正式项目变更”。Starter Kit 文档说明 action 会应用到 editor，并支持 `agent.cancel()`；它没有把一个通用的用户确认式变更预览当作 Starter Kit 的统一 primitive。当前本地产品对已获授权的例行局部内容修改可以直接走版本保护的 preflight → apply；是否先生成临时 preview、何时要求确认，应由宿主按影响范围和既有授权定义。

### 1.3 tldraw Store diff：为增量、撤销和可回看提供底层事实

tldraw Store 的官方 `RecordsDiff` 明确定义了三类变化：`added`、`updated`（每项含 `[from, to]`）和 `removed`。[RecordsDiff reference](https://tldraw.dev/reference/store/RecordsDiff) Store listener 可以收到 diff，并按 `source: 'user' | 'remote'`、`scope: 'document' | ...` 过滤；官方 Store 文档还说明 document scope 可与 camera、selection 等 session 状态分开。[Store](https://tldraw.dev/sdk-features/store)

这让两个需求可以分开实现：

- **上下文 diff**：用户写批注时冻结 `observedRevision`、目标身份和必要的局部快照；后续画布变化只报告当前 diff，不改写用户当时看到的事实。
- **变更 diff**：Agent 对高影响结构改动可以先生成针对目标的 added/updated/removed 候选，按现有授权决定是否接受后成为正式 change；例行局部改字或已明确交接的局部修改可以在 preflight 后直接 apply，并保留 change/revision 与逐条回执。

**事实边界：** `RecordsDiff` 是 tldraw Store 的记录差异结构，不能直接声称它就是 Agent Starter Kit 的“审阅 diff API”。迁移到本地时可复用“added / updated / removed + before/after + source”的思想，但本项目仍需将业务对象、表示、关系、批注和运行记录映射到自己的 revision/change contracts。

### 1.4 tldraw Workflow Starter Kit：同一画布上的节点、连接与执行阶段

tldraw 的 Workflow Starter Kit 把节点、连接和端口定义为可交互的图形对象；连接通过 binding 绑定到端口，移动节点时连接自动保持附着。它提供可替换的 execution engine，并在数据流动时更新节点结果。[Workflow Starter Kit](https://tldraw.dev/starter-kits/workflow)

这个参考适合本项目的“动态阶段呈现”：节点的结构位置保持稳定，当前执行结果、端口数据和阶段状态作为另一个投影层更新。官方实现没有替宿主决定业务状态词、失败是否可重试或父子运行如何归并；这些仍属于产品 contract。

### 1.5 Miro AI：selection-driven context 与显式迭代

Miro 的官方 Create with AI 文档确认：用户可以选中 board 上未隐藏的内容作为 prompt context；选择一组 Sticky notes 后，选区上方 toolbar 的 Miro AI 菜单可执行转换、聚类或生成 Doc/Prototype 等动作。生成后 prompting panel 保持打开，用户可以继续 refine prompt。[Create with AI](https://help.miro.com/hc/en-us/articles/20164358139794-Create-with-AI)

Miro AI overview 还明确列出：选中的 board objects 可以作为生成输入；选中的 sticky notes 可以被转成 table 或 presentation 等更结构化的形式；生成的 diagram 可以在 board 上手动编辑。[Miro AI overview](https://help.miro.com/hc/en-us/articles/28765406244498-Miro-AI-overview)

这验证了三个可迁移的交互事实：

1. 选区本身就是 prompt 的低成本参数，用户不必在聊天框重复描述目标。
2. “基于选区生成”与“对现有选区做批量动作”可以共用一个 context menu，但动作能力要根据对象类型判定。
3. refine 是同一目标上的连续操作，用户不应每次重新创建上下文。

Miro 对部分生成流提供了更明确的草稿/提交边界。Miro Slides 文档要求用户先审阅或迭代，再点击 **Add to canvas** 将结果提交；Miro Prototypes 文档还允许在多个 prototype version 间切换，选定版本后再 Add to canvas。[Miro Slides with AI](https://help.miro.com/hc/en-us/articles/30040238341906-Create-Miro-Slides-with-AI)、[Miro Prototypes](https://help.miro.com/hc/en-us/articles/26654269713682-Miro-Prototypes)

**事实边界：** “Add to canvas” 是 Slides/Prototypes 等明确流程的官方行为，不能扩大成 Miro 所有 Create with AI 功能都统一使用同一个提交按钮。对 Agent Canvas 的可迁移原则是“变更先可审阅、提交有明确动作”，而不是声称 Miro 的每个 AI 结果都具备本地式 diff preview。

### 1.6 n8n：执行状态、dirty 输出和可回到画布的运行记录

n8n 官方执行列表可以按 workflow、执行时间以及 `Failed`、`Running`、`Success`、`Waiting` 状态筛选；失败运行可以选择使用当前已保存 workflow 或原始 workflow 重试，也可以把之前运行的数据加载回当前画布。[All executions](https://docs.n8n.io/workflows/executions/all-executions/)

n8n 的运行状态不是一次静态“完成/失败”标签：等待中的执行仍是 `Waiting`，编辑已执行过的节点后，旧输出可能变成 dirty/stale，需要用户知道旧结果不能继续当成当前图的可靠结果。项目已有的流程图研究还核对了 n8n 子工作流的父子执行链接和等待子流程完成选项；本报告只借用其状态分层，不把 n8n 的执行引擎能力当作本地 Agent Canvas 已有实现。[Break workflows into smaller parts](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts/)、[Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/)

**迁移含义：** 图上节点的绿色/黄色/红色只能表达某个有身份的 Run 或 step 的状态；当图内容修订后，旧输出应显示 stale/dirty 或失效，而不是继续覆盖成“当前结果”。

## 2. 迁移到本地 stdio MCP 的选择与限制

### 2.1 官方传输事实

MCP 官方服务器规范把 Prompts、Resources、Tools 分成不同控制面：Prompts 由用户选择，Resources 由应用附加和管理，Tools 由模型调用执行。[MCP server overview](https://modelcontextprotocol.io/specification/draft/server/index) 这正适合把“用户选择/批注”“Agent 读取上下文”“Agent 提议或执行动作”拆成不同的入口。

官方 TypeScript SDK 的 stdio transport 由 host 启动一个本地子进程，通过 stdin/stdout 交换 JSON-RPC；该过程适合 local integration。[Serve over stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio)、[Stdio client transport](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/client/client/stdio.html)

本地 stdio 的直接限制是：

- 它提供 MCP 请求/响应和协议通知的进程通道，不自动理解浏览器里的当前选区、鼠标手势或 viewport 截图；这些必须由 UI/host 显式序列化为 context。
- 子进程的 stdout 是协议通道，调试日志必须写 stderr 或文件；不能让日志混入 MCP stdout。
- stdio 适合本机单 host/本地进程；多客户端共享、跨机器推送、认证和断线恢复属于另一层 transport/host 设计，不应由 prompt 文本假装解决。
- MCP Tool 返回“已接受”或“已入队”仍不代表宿主动作已完成；需要后续状态读取、事件通知或可信 receipt。

### 2.2 对当前本地插件的适配映射

当前插件 manifest 已采用 `type: "stdio"`，通过 `node .../scripts/start-canvas.mjs` 启动 bundled server；服务同时保留本地 UI 所需的 loopback HTTP/SSE 与 MCP stdio 边界。下表是基于现有代码和官方协议的迁移分析，不是新 contract：

| 用户/Agent 意图 | 本地 MCP 入口 | 需要在画布上显示的事实 | 不能从调用推出的事实 |
|---|---|---|---|
| 看当前局部 | `canvas_read` / expression context | 目标 IDs、`observedRevision`、视口/图路径、上下文预算和省略项 | Agent 已读完全部项目 |
| 选区/区域批注 | UI 生成独立 Annotation，必要时进入 `canvas_feedback` | 目标类型、目标身份、区域范围、每条原话 | 评论已发送给 Agent |
| 一次交接批次 | `canvas_feedback(action=handoff)` | batch identity、冻结 context、交接状态 `received` | Agent 已领取或已开始处理 |
| Agent 领取 | `canvas_feedback(action=claim)` | annotation 状态 `claimed`、批次进入 processing | Agent 已产生修改 |
| Agent 回复 | `canvas_feedback(action=respond)` | response 文本、`responded/needs_clarification/failed`、关联 change IDs | 关联 change 已成功执行；response 可能只是解释 |
| 临时强调/跟随阅读 | `canvas_present` | ephemeral highlight/focus、过期时间、目标身份 | 项目内容或 revision 已改变 |
| 请求继续/重试/停止 | `canvas_execution(action=request)` | executor、request ID、`queued`、`effective=false` | 主机已接受并生效；请求只在 receipt 验证后升级 |
| 运行结果 | `canvas_execution(action=receive/effective/fail)` | verified receipt、run ID、run status、来源和细节 | 只有 UI 颜色或 Agent 自述就足以证明真实运行 |
| 正式改图 | `canvas_apply` | base revision、已完成的只读 preflight、最终 change ID 和新 revision；高影响改动可另带候选 diff | 任何生成中的 action 都可以直接覆盖用户内容 |

这里最关键的是把 `canvas_present` 当成临时呈现层，把 `canvas_apply` 当成 version-protected durable change，把 `canvas_execution` 当成需要 executor receipt 的运行层。三者可以在同一张图上投影，但不能共享一个含糊的“完成”徽标。

### 2.3 选区、viewport、prompt 和 diff 的最小 context contract

为了让 harness/prompt 易读作图，建议每次局部 Agent 请求只输出下面五块，顺序固定：

```text
目标：<一句话动作，例如“修改所选 3 个节点的说明”>
范围：<selection | area | graph>；对象：<稳定 IDs 和人类可读标题>
观察：<observedRevision、graph path、viewport/bounds、当前状态>
要求：<保留/允许修改/禁止修改；每条独立意见对应一个 annotation>
交付：<例行改动为 preflight → apply；高影响结构改动可先给 preview diff，再按授权决定是否确认；若需要运行，另列 run/receipt>
```

其中：

- `selection` 优先传稳定目标身份；坐标只作为当时区域观察事实，不能替代 entity/representation/relation/element identity。
- `viewport` 只表达当前可见语境和阅读锚点；Agent 可以请求 focus/highlight，但不应默认抢走用户镜头。
- `observedRevision` 冻结用户写批注时所看到的版本；当前 revision 变化时显示差异和需要复核的目标。
- `diff` 按 `added / updated(from,to) / removed` 或业务等价结构表达；每一项绑定目标 ID 和原因，不能只返回一段“已修改”。
- `preview` 是临时投影，适合高影响结构候选；例行局部改动可在已有授权和 preflight 通过后直接由 `canvas_apply` 写入正式 revision。任何情况下都要保留 base revision、changeId 和可回退历史。

这些字段是产品建议，不是 tldraw、Miro 或 MCP 的现成联合协议；它们把同行已验证的 selection/context/action/diff 机制适配到本项目的稳定身份和版本模型。

## 3. 推荐的精简图上协作流程

目标是减少操作次数，同时保留独立批注和逐条决定能力。

### 第一步：一次选择，多条独立意见

用户点击单个对象或拖出一个区域；画布显示“已选 N 个对象”和范围摘要。用户在同一条选区工具栏中连续加入多条批注，每条批注保留：

- 原话和意图（修改、解释、审阅、进度核对等）；
- 一个或多个稳定 target refs；
- 形成批注时的 `observedRevision` 和图路径；
- 可选的区域坐标/viewport 观察信息。

区域可以减少选取动作，不能把多条意见合并成一条不可分辨的长评论。批量交接只打包这些独立 annotation IDs。

### 第二步：一个显式交接动作

选区工具栏只保留一个低频但明确的“交给 Agent”入口；普通“保存批注/继续浏览”不触发 Agent。交接后显示 batch ID 和冻结 context 摘要，状态从 draft/prepared/awaiting host 进入 `received`，并明确写出“已交接，等待 Agent 领取”。

### 第三步：Agent 领取后，先返回局部计划或必要预览

Agent 对批次执行 `claim` 后，画布在对应目标旁显示“已领取/处理中”。Agent 的第一份结果应包括：

1. 读取到的目标与观察版本；
2. 对每个 annotation 的简短回应或需澄清原因；
3. 对高影响结构改动返回原位 preview：以半透明或临时层显示拟改位置、文本、关系或状态；已明确授权的例行局部改动直接返回受保护的 apply 计划和回执边界；
4. 可展开的 diff：每项的 before/after、added/removed、风险/冲突和影响对象；
5. 预计是否需要真实 execution，若需要则单列执行阶段。

预览应保持用户原 viewport，除非用户显式点“定位到修改”；临时 focus 只用于帮助理解，过期后不写项目 revision。

### 第四步：按授权提交，或处理高影响候选

主操作栏只提供三种选择：

- **提交已授权局部项**：在显示目标和 base revision、完成 preflight 后一次 apply，保留每项 change/revision 记录；
- **接受选中项**：对高影响 preview diff 把选中的候选作为一个受保护 change 写入；
- **接受全部**：对高影响候选在显示影响对象和 base revision 后一次 apply；
- **要求澄清**：保留原批注和 preview，不写正式 change，把问题重新交给 Agent。

提交后画布显示 `changeId` 和新 revision；这只证明 Canvas change 已提交，不证明外部代码、训练或宿主进程已经运行。

### 第五步：有执行请求时再展开动态阶段

如果用户/Agent 进一步请求 `continue/retry/stop`，图上目标旁增加运行条：

`request queued → receipt received/rejected → run running/waiting → effective/completed/failed/stopped`

每一段必须有来源、request/run ID 和更新时间。等待状态可以保持选区高亮，但不能显示成成功；图内容变更后，旧输出要标 stale/dirty，不能继续伪装成当前运行结果。

## 4. “评论不等于 Agent 收到/执行”的状态语言

建议在产品文案中固定下面的词义：

| 画面文案 | 证明了什么 | 仍未证明什么 |
|---|---|---|
| `已保存批注` | 批注已写入本地项目/版本历史 | Agent 已看到或领取 |
| `待交接` | 批注在本地等待一次 handoff | 任何远端/宿主处理 |
| `已交接` | batch 已进入 `received`，有冻结上下文 | Agent 已开始工作 |
| `Agent 已领取` | 该 annotation 进入 `claimed`，批次可进入 processing | 已生成、已应用或已执行 |
| `处理中` | 批次/Agent 有进行中的状态投影 | 项目内容已改变，或外部进程还在运行 |
| `预览待确认` | 有一份未提交的拟议 diff | 正式 revision 已更新 |
| `已应用 R<N>` | `canvas_apply` 接受了版本保护的 change | 外部 executor 已生效 |
| `请求已入队` | `canvas_execution(request)` 记录了 Control Request，`effective=false` | executor 已收到或真实运行 |
| `已收到回执` | executor 返回的 receipt 通过了接收阶段校验 | 运行已经生效/完成 |
| `已生效` / `已失败` | verified receipt 推进了 run/request 状态 | 失败原因之外的产品结论 |
| `需要澄清` | Agent 明确无法安全处理该条批注 | 该条批注已被忽略或完成 |

因此，评论气泡旁应避免使用“已完成”“已执行”这类宽泛词。只有对应的状态和来源同时存在时才使用“已领取”“已应用”“已生效”。

## 5. 本项目应采用的选择与取舍

### 推荐采用

- **selection-first context**：选区工具栏负责对象数、范围摘要、批注和一次交接；不要求用户复制标题或路径到 prompt。
- **独立 annotation + 批量 handoff**：少一次次点击，但保留逐条响应、逐条澄清和逐条结果；是否逐条确认由影响范围与既有授权决定。
- **revision-bound prompt**：每份 prompt 带 `observedRevision`、目标 IDs、图路径和省略原因；上下文预算不足时明确告诉 Agent。
- **preview/apply 分层**：对高影响结构先显示原位拟议改动；例行局部改动完成 preflight 后直接用 `canvas_apply` 写正式 change；批注、preview 和 change 各有自己的身份。
- **动态阶段独立投影**：用临时 highlight/focus、feedback 状态和 execution receipt 分别表达阅读引导、Agent 协作和真实运行。
- **局部增量维护**：只更新被选目标、相邻关系和受影响状态；视口、用户固定位置和无关图形保持稳定。
- **明确取消**：高影响 preview 或 Agent 处理中允许取消；取消清理临时 preview/高亮，但不删除用户原批注和已落盘 change。

### 暂不承诺

- 不把 tldraw Agent Starter Kit 的 streaming 直接当成本地稳定 diff preview；需要本地 preview 层和接受边界。
- 不把 Miro 的某个生成流程的 Add to canvas 扩大成所有 AI 动作都具备统一 review/commit 语义。
- 不把 n8n 的状态颜色、执行历史或子工作流链接当作本地 execution engine 已经存在的证据。
- 不让 prompt 直接改变结构语义、批注观察版本或运行事实；这些必须通过有版本的 MCP change/receipt。
- 不让 viewport 自动跳转覆盖用户阅读位置；Agent 的 focus 是临时提示，除非用户明确要求导航。

## 6. 事实、推断与验证边界

### 官方事实

- tldraw Agent Starter Kit 将选区、当前 viewport、截图、结构化 shape summaries、最近操作和会话历史组装为 Agent context；提供 typed action、mode、流式 action 和 programmatic prompt。
- tldraw Store `RecordsDiff` 用 added/updated/removed 表达记录变化，并保留 updated 的 before/after；listener 可按 source/scope 过滤。
- tldraw Workflow Starter Kit 有节点、端口、绑定和可替换的 execution engine/data flow。
- Miro AI 使用选中的 board content 作为上下文，并支持选区上方 context menu 与 prompt refinement；部分 Slides/Prototypes 流程要求用户审阅版本后 Add to canvas。
- n8n 执行列表支持 Failed/Running/Success/Waiting，支持不同 workflow 版本重试和将历史数据加载回画布；旧输出可能因图修改而失效。
- MCP 服务器可暴露 prompts/resources/tools；官方 stdio SDK 以本地子进程 stdin/stdout 承载协议。

### 本地项目事实

- `plugins/agent-visual-canvas/.mcp.json` 当前声明 stdio MCP server，启动 `scripts/start-canvas.mjs`。
- `src/ui/ExpressionHarnessPanel.tsx` 当前在复制局部任务后提示“已复制……尚未发送给 Agent”，已经把“生成 prompt”和“发送 prompt”区分开。
- `src/server/index.ts` 的 feedback 协议区分 handoff、claim、respond，并以 batch/annotation 状态推进；execution 协议区分 request、receive、effective、failed，要求 receipt 验证。
- `canvas_present` 的服务描述是临时 highlight/focus；它不应被解读为正式内容变更。

### 推断与下一步建议

- 在现有 harness 上增加一个可见的“范围/观察版本/预计动作/提交边界”摘要，比继续堆长 prompt 文本更能降低误操作。
- 将 preview diff 作为 UI/服务内的临时 projection，并让高影响结构的 `canvas_apply` 只接受带 base revision、目标 IDs 和适用授权的 change；例行局部修改可沿现有 expression_validate → canvas_apply 路径提交。这是迁移建议，通用 diff preview 仍不是当前实现已具备的能力声明。
- 把 feedback 状态与 execution 状态画成两条相邻但独立的阶段带；一条回答“Agent 是否收到/回复”，另一条回答“执行器是否真实生效”。
- 以“一个选区、若干独立批注、一次交接、例行局部项读/预检/提交，高影响项 preview/accept”作为最小验收场景，再扩展到跨图、子流程和长时间运行。

## 7. 最小验收场景

1. 选择三个对象，添加两条不同意图的批注；确认每条 annotation 有稳定 target 和同一个 observed revision。
2. 不点击交接，只刷新画布；确认画布仍显示“已保存/待交接”，没有“Agent 已收到”。
3. 执行一次 handoff；确认 batch 进入 received，Agent 未 claim 前不显示处理中。
4. claim 后对一条例行局部项完成 preflight 并提交，对另一条高影响项返回 preview 和一条 needs clarification；确认 preview 未改变正式 revision，澄清项仍可单独追问。
5. 提交已授权局部项并接受高影响 preview；确认 change ID、新 revision 和未修改的第二个对象清楚可查。
6. 发起一次 execution request；确认先显示 queued/effective=false；没有 verified receipt 时不显示已生效。
7. 在处理中移动无关节点或改变 viewport；确认临时状态仍绑定原对象身份，固定位置和用户镜头不被重排覆盖。
8. 改动已执行对象后重新读状态；确认旧输出显示 stale/dirty 或需要复核，而不是继续显示当前成功。

## 资料入口

- [tldraw Agent Starter Kit](https://tldraw.dev/starter-kits/agent)
- [tldraw AI integrations](https://tldraw.dev/docs/ai)
- [tldraw RecordsDiff](https://tldraw.dev/reference/store/RecordsDiff)
- [tldraw Store](https://tldraw.dev/sdk-features/store)
- [tldraw Workflow Starter Kit](https://tldraw.dev/starter-kits/workflow)
- [Miro Create with AI](https://help.miro.com/hc/en-us/articles/20164358139794-Create-with-AI)
- [Miro AI overview](https://help.miro.com/hc/en-us/articles/28765406244498-Miro-AI-overview)
- [Miro Slides with AI](https://help.miro.com/hc/en-us/articles/30040238341906-Create-Miro-Slides-with-AI)
- [Miro Prototypes](https://help.miro.com/hc/en-us/articles/26654269713682-Miro-Prototypes)
- [n8n All executions](https://docs.n8n.io/workflows/executions/all-executions/)
- [n8n Break workflows into smaller parts](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts/)
- [MCP server overview](https://modelcontextprotocol.io/specification/draft/server/index)
- [MCP TypeScript SDK: Serve over stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio)

本报告未注册第三方账号、未进行付费/远端调用、未写入 MCP 配置，也未把网页文档中的机制当作本项目已经通过验收的实现。
