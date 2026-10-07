# r19 当前画布结构混乱诊断

日期：2026-10-04  
范围：Agent Visual Canvas 的 notebook/organization 表达层，只读源码审查，并参考 root 提供的 r19 fresh screenshot；未自行操作浏览器或用户 UI。

## 结论先行

r19 当前画布的“混乱”主要来自多套投影、密度、展开和关系表达机制叠加在同一平面，而不是单一的碰撞算法故障。画布仍使用同一份图文数据，但 `overview / cluster / all` 改变可见对象，`essential / complete` 改变簇内对象，正文与卡片 disclosure 又改变内容高度，外部 SVG 关系层和卡片内关系还同时表达连接；其中 `overview` 还绕过 notebook layout solver，使用另一套固定二维坐标。这些机制叠加后，用户会看到“同一块内容在不同入口变成不同结构”，并难以判断当前看到的是总览、当前簇、完整正文还是展开后的细节。

第一段是机制性诊断：源码支持这些机制会造成层级和空间边界不稳定，但不等于已经证明所有具体视觉症状。本文同时参考 root 提供的新截图；没有自行操作浏览器或用户 UI，也没有取得该运行实例的 localStorage 或真实 DOM 测量值。因此截图之外的“某条线已经穿过某段文字”“某两个块已经重叠”等具体事实，仍须由 root 结合实际运行状态复核。

## 已确认的机制

### 1. 三个组织轴被压在同一组导航控件中

组织模型有三个独立轴：范围 `overview | cluster | all`、密度 `essential | complete`、意图 `understand | monitor`（`src/layout/organization.ts:14-19`）。在 cluster 范围内，`essential` 先放 anchor，再放 `essential` 或 members；`complete` 还追加 members、entry、exit（`src/layout/organization.ts:403-418`）。`overview` 显示 root 和各簇 anchor，`all` 直接显示图中的全部 live refs（`src/layout/organization.ts:673-686`）；monitor 意图还会追加异常任务表示（`src/layout/organization.ts:688-705`）。

App 的默认值是 cluster + essential，并从 localStorage 恢复每个图的上次选择（`src/ui/App.tsx:485-528`）。顶部却把“总览、分支选择、图解、正文、概念、整块、展开本块/只看重点、理解优先/监控优先、关联入口、全部”连续放在同一导航中（`src/ui/App.tsx:1714-1724`）。这使用户容易把“当前簇”“内容子集”“正文跳转”和“全图”误解为同一层级的前后关系，实际它们会同时改变可见 refs、密度或相机焦点。

### 2. overview 是固定投影，不是 notebook layout 的压缩结果

进入 overview 时，App 不调用 notebook layout solver，而是按 visible representation 的数组顺序直接生成坐标：root 使用 `x=200, y=-250, width=420, height=170`，其余表示使用两列、固定步长 `460 × 230`，统一高度 `170`（`src/ui/App.tsx:542-555`）。free element 在这段 overview geometry 中没有对应操作。

离开 overview 后，只有在收到当前 scope 的 DOM measurement 时，App 才调用 `proposeNotebookLayout` 并采用 `viewOperations`（`src/ui/App.tsx:556-562`）。因此同一批对象切换 overview 与 cluster/all 时，不只是隐藏或显示变化，位置和尺寸的计算来源也变了。root 的负 y、按数组顺序分行、正文块缺少 overview 位置以及 overview 固定高度与正文实际高度的脱节，都是源码可推导的风险；实际是否在 r19 截图中表现为空白、远离或遮挡，需要浏览器证据。

### 3. 展开、正文完整显示和组织密度不是同一个详情层

notebook block 通过 `expressionDisclosure(scopeKey)` 保存展开状态；notebook 点击展开只改变 disclosure state 并触发 `disclosureTick`，随后 `ResizeObserver/MutationObserver` 读取 block 的 `offsetWidth` 和 `scrollHeight`（`src/ui/ContentWorkspace.tsx:233-272`、`src/ui/ContentWorkspace.tsx:304-308`）。overview block 被明确跳过测量（`src/ui/ContentWorkspace.tsx:240-245`）。普通 card 的 details 展示由 `ExplanationCard` 的 `expanded` 控制（`src/ui/ExplanationCard.tsx:163-193`），而 notebook 正文本身始终允许自然增长。

布局 solver 在没有真实测量时才使用文本估算；有测量时使用测量值，并在 planned size 中取 source geometry 与 measured size 的逐项最大值（`src/layout/notebook.ts:379-423`、`src/layout/notebook.ts:400-407`）。展开后的新高度要经过 observer、React 更新和下一次 layout proposal 才会参与邻居排布；这是异步两阶段过程。尺寸只取不小于 source/measured 的值，也意味着内容曾经变长后再收起，可能保留较大的临时占位。这些行为可以解释“点击后位置跳动”或“收起后留下空隙”的可能性，但不能代替实际截图证明这些现象已经发生。

CSS 又把 notebook block、正文、card 和 details 都设为 `height:auto; overflow:visible`（`src/ui/content.css:169-237`），并按 root、heading、普通卡片和概念使用不同字号、padding、边框和阴影（`src/ui/content.css:197-207`、`src/ui/content.css:311-330`）。solver 的 rectangle 因而要和浏览器真实内容边界、details 状态、padding/border 以及 block transform 一起才能等同于用户看到的边界；仅看 source geometry 不能确认像素级碰撞。

### 3a. 来源几何、DOM 测量和碰撞体积不是同一个矩形

当前链路可以明确拆成四层：

1. **来源几何**：representation 使用 `x/y/width/height/rotation`，free element 使用 Excalidraw element 的几何字段；`ContentWorkspace` 先从 source 或 `geometryOverrides` 选出 `visualGeometry`（`src/ui/content-geometry.ts:3-16`、`src/ui/ContentWorkspace.tsx:346-355`）。
2. **浏览器投影**：block 的 `left/top/width` 使用投影 geometry，notebook 的 CSS `height` 改为 `auto`，并以 `minHeight`、camera scale 和 rotation 生成实际样式（`src/ui/ContentWorkspace.tsx:367-383`）。因此 source 的 height 不是 notebook block 的最终 CSS 高度。
3. **DOM 测量**：只有非-overview block 才进入测量，读的是 `offsetWidth` 和 `scrollHeight`（`src/ui/ContentWorkspace.tsx:233-245`）。测量经过 observer 回传后，`plannedSize` 对 source 和 measured 的宽高各取最大值（`src/layout/notebook.ts:379-423`）。
4. **碰撞体积**：solver 用这些 axis-aligned 的 `x/y/width/height` 盒子，以 `GAP=32` 判断重叠；fixed obstacles 与 moving boxes 最后分别做碰撞检查（`src/layout/notebook.ts:485-523`、`src/layout/notebook.ts:948-1075`）。`viewOperations` 可以暂时带宽高，但持久化 `operations` 只写位置变化（`src/layout/notebook.ts:554-604`、`src/layout/notebook.ts:1077-1089`）；`projectNotebookView` 也明确把 disclosure reflow 保留在 view，不写回 source（`src/layout/notebook-view.ts:20-63`）。

这条链路是“用 DOM 尺寸近似碰撞盒”，不是让三种矩形永久相等。notebook block 的 CSS padding、border、自动高度和 details 展开会改变视觉边界；CSS 还会旋转 block，而 solver 的 `overlaps` 仍按轴对齐盒子判断。因此源码能解释“屏幕上看似有空隙或擦边、solver 却认为安全”的可能性，具体是否发生及发生在哪个 block 仍要以截图和实际 DOM 为准。

### 4. 关系至少有三种同时存在的表达层

organization plan 会根据端点可见性和跨簇状态把 relation 作为直接 relation 或 portal 计算（`src/layout/organization.ts:487-528`、`src/layout/organization.ts:708-739`）。但 native scene 中的关系元素仍保留，只在 organization view 里设为 `opacity: 0` 并锁定（`src/canvas/organization-scene.ts:13-21`）。同时，`NotebookRelations` 读取真实 snapshot relations，在独立 SVG 层按同一 camera 绘制路径、箭头和标签，并为每条线设置至少 14px 的透明点击路径（`src/ui/NotebookRelations.tsx:82-160`）。card 内的 explanation relations 仍保留前两条，第三条以后由 CSS 隐藏（`src/ui/content.css:150-156`）。

因此关系同时具有隐藏的 native baseline、可见的 SVG 线、卡片内的局部文字三种表达。源码可以证明它们的存在和筛选规则，不能证明当前 r19 是否出现重复线、断线、线穿字或点击区域盖住正文。plan 中的 portal 数据也不能直接当作已经显示的独立门户；是否有清晰的 portal 视觉出口要看实际渲染和截图。

### 4a. 图解、概念卡和长正文确实可能重复同一解释

指定的 fresh screenshot `plugins/agent-visual-canvas/docs/research/evidence/current-canvas-20261004.png` 显示：同一 viewport 里左侧有流程/图解卡，图解下方紧接着有“两份手册分别有什么？”等解释段落，右侧又有一张纵向延伸的“层级预测分类法”长卡；工具栏下方到内容卡之间留有大块空白，右侧长卡在 viewport 边缘被截断，底部相机显示为 50%。这已经证明当前视口同时承担图解、局部说明和长正文的空间竞争。截图能证明视觉并置与重复阅读负担，不能单独证明两段文字逐字相同。

源码提供了重复路径：free text 作为 `rich-prose` 单独渲染，representation 则在同一 `ContentWorkspace` 中渲染为 `NotebookNode + ExplanationCard`（`src/ui/ContentWorkspace.tsx:404-405`）。notebook representation 强制 `bodyMode: "complete"`（`src/ui/NotebookNode.tsx:19-28`、`src/ui/NotebookNode.tsx:65-83`），所以概念卡默认保留完整表达，而不是只保留标题。

对 entity card，`ExplanationCard` 默认渲染“定义 / 核心结论”和 takeaway；有 key points 才渲染“关键要点”，有 input/output 才渲染 I/O，有 evidence 才渲染“证据状态”，details 则只在 expanded 时展开（`src/ui/ExplanationCard.tsx:162-197`）。所以“所有卡默认重复核心结论/要点/证据状态”的准确判断是：

- **核心结论**对每个 entity card 都是默认字段；缺失时仍显示占位结论（`src/ui/expression-view.ts:145-149`）。
- **关键要点**不是每张卡都有；没有显式 keyPoints 时，代码会从前 3 个正文 sections 抽取，恰好可能把长正文的开头再复制进卡片（`src/ui/expression-view.ts:151-159`）。
- **证据状态**只在该 entity 存在 evidence 时显示，不能断言每张卡都有，但同一 evidence 会随该 card 的各个投影重复出现（`src/ui/ExplanationCard.tsx:183-190`）。

因此当前视觉重复不是“每张卡固定显示三栏”这么简单，而是完整 entity card、section-derived key points、free long prose 和独立 diagram 同时可见；overview CSS 还会隐藏 points、evidence、details，却保留 takeaway 的三行摘要（`src/ui/content.css:333-343`），进一步造成不同入口的信息粒度不一致。

### 5. harness 是上下文检查器，不是画布结构导航器

`ExpressionHarnessPanel` 默认范围是 selection；没有选择时实际传入空 targets。它只在点击“检查讲解”或“复制局部任务”时构造上下文，固定使用 `maxBytes:48000`、`maxItems:48`、`maxNodes:24`、`maxRelations:28` 等预算（`src/ui/ExpressionHarnessPanel.tsx:7-31`）。检查结果中的按钮只调用 `onSelect(item.target)`，不会驱动 organization scope、cluster 或 density 切换。

所以 harness 的“当前目标/邻域/省略说明”和画布的“当前簇/全部/关联入口”不是同一导航状态。用户可能在画布上已切簇，但 harness 仍按选择范围组装；也可能 harness 指向一个目标，却没有把画布切换到该目标所属的 organization cluster。

## 最可能造成混乱的因果链

1. **模式边界不清**：同一表面同时呈现 scope、density、intent、正文跳转和 disclosure，用户无法从画面直接判断当前状态。
2. **overview 与其余视图的布局基准不同**：固定坐标和固定高度会让模式切换看起来像结构重排，而不是同一图的缩放。
3. **内容高度是动态且异步的**：展开改变真实 DOM 高度，observer 之后才触发布局；曾经测得的更大尺寸还可能继续占位。
4. **几何基准并未完全对齐**：碰撞检查的是带 margin 的轴对齐盒子，视觉 block 却有 auto height、padding/border 和 rotation；临时 view geometry 还会改变占位但不写回 source。
5. **同一解释被多个载体承载**：完整概念卡、从 sections 抽出的要点、独立图解和长正文都能同时出现；核心结论默认存在，证据状态按数据重复。
6. **关系信息重复但粒度不一致**：SVG 线、卡片内前两条关系和隐藏 native baseline 共同存在，跨簇 portal 的可见出口又未由该源码片段直接证明。
7. **上下文检查与视口导航脱节**：harness 生成局部任务，但不负责把画布切到相同组织范围。

这些机制共同作用时，“乱”更像是用户看到的层级语义不稳定，而不只是某个节点没有避让成功。

## 当前依赖版本边界

当前插件把 `@excalidraw/excalidraw` 固定为 **0.18.1**，把 `elkjs` 固定为 **0.12.0**（`plugins/agent-visual-canvas/package.json:15-23`；lockfile 的 importer 和完整解析项也保持这两个版本：`plugins/agent-visual-canvas/pnpm-lock.yaml:7-22`、`:489-493`、`:1446-1447`）。本诊断依据这些仓库内版本和现有源码，不依据 online latest 推断 API 或安装能力。

notebook 的上述碰撞与 disclosure 布局来自 `src/layout/notebook.ts` 自身；ELK 是另一个按需 worker 的依赖（`src/layout/worker.ts:1-7`），不能把 ELK 的默认布局行为当作本 notebook 画布的实际碰撞规则。Excalidraw 0.18.1 负责 native canvas 与元素几何，organization scene 对其元素做隐藏/锁定投影；这也不改变 notebook HTML/SVG 层的测量和布局链路。

## 当前源码不能证明的项目

- 用户当前 localStorage 中到底保存了哪个 scope、cluster、density 和 intent。
- r19 当前 viewport、zoom、浏览器字体、DOM 实际测量值和 observer 完成时序。
- overview 是否出现大块空白、root 是否真的跑到可视区域外。
- 展开/收起后哪些邻近 block 实际跳动、重叠或留下空位。
- relation path 是否穿过文字、是否重复/断裂，以及透明 hit path 是否实际拦截正文点击。
- `organizationView.portals` 是否在当前 CanvasWorkspace 中以用户可见的门户控件或线段呈现。
- selection/focus 后最终 zoom 是否达到可读比例。
- 截图中相邻图解、卡片和长正文的段落是否来自同一 entity/section，还是只是主题相近的不同内容。

## 给 root 的浏览器验收顺序

按同一图、同一 viewport 逐步截图并记录当前按钮状态：

1. 默认 `cluster + essential + understand`：记录 active cluster、可见 block、关系线和正文边界。
2. 点击“总览”：比较同一对象的坐标、root 位置、空白区域和关系线端点。
3. 回到一个 cluster，点击“展开本块”；再对一个 block 展开详情，等待一次 observer/layout 更新后截图。
4. 收起详情和本块，检查邻近 block 是否恢复、是否留下过大占位。
5. 点击“全部”：检查完整成员、entry/exit、关系密度和可读性。
6. 使用“关联入口”跳转，再点击一条 SVG relation：检查是否同时高亮卡片文字、SVG 线和 native 关系残影。
7. 分别在无 selection、有 selection、graph 范围下运行 harness：比较它的目标、omissions 和画布当前 cluster 是否一致。

每一步只记录可见事实：块的实际边界、线与文字的交叉、重复信息、空白、跳动和最终缩放。若截图证实这些症状，再决定是收窄入口、统一布局基准、统一详情层，还是调整关系呈现；在截图之前不应把任何一个源码风险写成已确认的 r19 视觉 bug。
