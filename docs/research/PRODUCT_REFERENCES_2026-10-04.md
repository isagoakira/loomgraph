# 多级空间知识产品研究：Heptabase、Obsidian Canvas、Milanote

研究日期：2026-10-04（Asia/Shanghai）  
研究范围：多级结构如何显式表达、详略如何分配、文本如何和空间共存、阅读/展开/跨图关系如何处理。  
资料策略：优先读取产品自己的帮助中心、公开 Wiki、官方源码和格式规范；没有猜测价格，也没有登录或修改任何产品数据。

## 结论先行：最值得借鉴的三个机制

1. **把“内容实体”和“空间投影”分开。** Heptabase 明确把 Card Library 作为卡片归属处，把 whiteboard 当作思考空间；同一张卡片可以出现在多个 whiteboard。这个边界能让一个概念在不同主题下复用，同时保留每个主题自己的空间上下文。
2. **用可折叠、可聚焦的局部视图分配详略。** Milanote 用 nested boards 表达大层级，用 columns 聚合同级内容并支持 collapse/expand，用 presentation mode 聚焦一张卡；Obsidian Canvas 用 group、zoom-to-selection、zoom-to-fit 和“跳到关系两端”管理无限画布的阅读密度。多级结构不能只靠把所有节点缩小到同一屏。
3. **跨空间导航必须指向稳定对象，而不是复制一份内容。** Heptabase 的 deep link 可以指向 card、block、whiteboard、section；Obsidian 的 edge 有稳定的 from/to node ID 和 label；Milanote 的 board link card 和 breadcrumb 让读者返回父级或进入子板。跨图入口应是可回溯的 reference，不能被误读为新实体或执行关系。

这三个机制对应当前 ForecastCompass notebook 的直接设计输入：保留 canonical entity 与 representation 的边界，用 cluster 的 essential/entry/exit 给默认视图限密度，用关系端点和稳定 ID 负责跨簇回读。它们是产品机制的迁移假设，不是三款产品之间的性能排名。

## 证据等级与本轮边界

- **D（文档/源码证据）**：下面的引号来自 2026-10-04 实际通过 HTTP 读取的官方页面、官方公开 Wiki、官方 GitHub 仓库或 JSON Canvas 规范；每条都给出链接。
- **U（真实 UI 体验）**：本轮没有登录 Heptabase、Obsidian 或 Milanote，也没有在用户画布上打开或点击它们。因此本文不把截图阅读冒充成亲自操作体验；“易读”“适合”等判断都标为推断，并尽量绑定公开示例的可见结构。
- **I（推断）**：基于 D 和公开示例提出的产品逻辑、可借鉴点与不适合照搬点。它们不是厂商原话。
- 当前文档没有价格、套餐或免费层结论。XMind 没有加入本轮，因为前三款已经覆盖本任务需要比较的“实体/空间、层级、聚焦、跨图关系”机制；若后续要比较树状编辑器的自动布局，再单独补充第一手资料。

## 1. Heptabase：Card Library 负责归属，Whiteboard 负责主题空间

### 1.1 产品逻辑（D）

**内容实体与空间投影是两层。** 官方 Fundamental Elements 写明：

> “A card is your note, as well as a container for knowledge and ideas.”

同一页又明确：

> “Whiteboards do not own cards. All cards belong to the Card Library.”

以及：

> “The same card can be placed on multiple whiteboards at the same time.”

来源：

- [Fundamental Elements — Card / Whiteboard](https://wiki.heptabase.com/fundamental-elements)

这不是简单的“白板里放便签”：Card 是可持续编辑的知识实体，Whiteboard 是把实体放入某个主题上下文的空间投影。官方还说明，卡片编辑器支持标题、列表、toggle、表格、图片、音视频、文件、PDF、代码和公式等 block；卡片之间可以通过 `@` mention，Info 中可见 block-level backlinks。也就是说，**纵向详略在 Card 内处理，横向关系和主题布局在 Whiteboard 处理**。

**层级通过 sub-whiteboard，而不是把所有内容堆在一张画布。** 同一页写道：

> “When you have many cards on a whiteboard, you can create sub-whiteboards for researching subtopics under the main topic.”

官方列出的 whiteboard 对象还包括 Text、Mindmap、Section 和 sub-whiteboard；工具栏提供 Search，且搜索可以限定在当前 whiteboard。

来源：

- [Fundamental Elements — Whiteboard](https://wiki.heptabase.com/fundamental-elements)

**产品导航模型接近浏览器，而不是文件夹。** Getting Started 页面把所有 cards、whiteboards 和 tags 称作一个 “knowledge network”，并说 Heptabase 是这个网络的 “browser”；左侧栏是 tabs/bookmarks，全局工具是 search。

来源：

- [Getting started with Heptabase](https://wiki.heptabase.com/getting-started-with-heptabase)

**跨空间跳转有稳定 deep link。** 官方帮助中心说明 deep link 可以指向 card、block、whiteboard 或 section；点击 card link 会打开 card，block link 会直接跳到 block，section link 会打开 whiteboard 并定位 section。它还明确写道：

> “A deeplink opens content that you or the recipient already have access to; it does not grant access or make private content public.”

来源：

- [Use deep links](https://support.heptabase.com/en/articles/11176386-use-deep-links)

**阅读/分享有两种层级。** Publish a whiteboard 的官方说明写道，公开只读链接会把 nested sub-whiteboards 一起发布；live link 刷新后看到最新内容，snapshot 则是固定版本。这把“当前可读结构”和“固定交付版本”分开。

来源：

- [Publish a whiteboard](https://support.heptabase.com/en/articles/12121546-publish-a-whiteboard)

### 1.2 公开结构示例（D + 公开图示观察）

下面两张图来自 Heptabase 官方 Public Wiki 的 Fundamental Elements 页面。我实际下载并查看了图片像素；这属于**官方公开图示观察**，不是登录后的 U 类操作体验。

1. [Whiteboard 中按主题 section 分组的公开示例图](https://wiki.heptabase.com/assets/images/fundamental-elements-05-09bdcef0387e799f8ca0ded0d6599e19.png)（页面：[Fundamental Elements](https://wiki.heptabase.com/fundamental-elements)）。左侧大空间用一个有标题的彩色 section 收住一组相关卡片，卡片之间用箭头表达局部关系；右侧仍能看到 Card Library 的卡片列。可读性来自**标题化的区域边界 + 区域内关系 + 右侧独立的实体库**，而不是来自把所有卡片放进同一条树。
2. [同一张 Card 同时出现在多个 Whiteboard 的公开结构图](https://wiki.heptabase.com/assets/images/fundamental-elements-06-b566b3fb7036472c703adfbe5b417419.png)（同一页面）。图中 Card Library 的 “Card 1” 用虚线分别连到 Whiteboard 1 和 Whiteboard 2；两个 whiteboard 内部又有各自不同的箭头关系。这个示例直接展示了“实体只保留一份，空间关系按主题分别表达”的层次。

### 1.3 可借鉴与不适合照搬（I）

**可借鉴：**

- 将 `entity` / canonical content 与 `representation` / cluster placement 分离；同一概念可以成为多个阅读簇的成员，但每个簇保留自己的 diagram、entry、exit 和局部关系。
- 用 sub-whiteboard/section 的思路表达“先看主题框架，再进入子主题”，而不是把跨簇关系全部拉成一个横跨全图的 overlay。
- 给 card、block、section 提供稳定的 deep link 语义，使跨簇 link 回到原对象和上下文。

**不适合照搬：**

- Heptabase 的产品边界是 Card Library + Whiteboard；ForecastCompass 还有论文关系、evidence、annotation 和 revision 等机器可验证语义，不能把所有内容都降成可自由拖动的卡片。
- “Whiteboard 不拥有 card”可以迁移成投影/实体分离原则，但不能据此允许删除或重建 canonical entity；当前 notebook 的 `members` 和 relation endpoint 必须继续受 revision/identity 保护。
- 官方页面说明了产品结构，但本轮没有验证协作权限、同步延迟或公开链接在实际账户中的行为；这些不作为本研究结论。

## 2. Obsidian Canvas：开放节点/边格式，空间组织主要是视觉容器

### 2.1 产品逻辑（D）

官方 Canvas 文档把 Canvas 定义为：

> “It gives you infinite space to lay out notes and connect them to other notes, attachments, and web pages.”

并明确说明 `.canvas` 使用开放的 JSON Canvas 格式。文本卡片可以使用 Markdown、links 和 code blocks；文件卡片可以指向 vault 中的文档、图片、音频或 PDF。关系线可以有颜色和 label；远距离关系线可以右键 “Go to target” 或 “Go to source”。

来源：

- [Obsidian Help — Canvas](https://help.obsidian.md/plugins/canvas)
- [Obsidian Help 官方源码（Canvas.md）](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)

**Group 是视觉容器。** 官方文档的操作是选中相关 cards 后 “Create group”，再给 group 改名。JSON Canvas 1.0 规范把 group 定义为：

> “Group type nodes are used as a visual container for nodes within it.”

这说明 group 的语义首先是可见的空间容器；规范没有把它定义成知识实体、语义 cluster 或权限边界。

来源：

- [JSON Canvas Specification 1.0 — Group type nodes](https://jsoncanvas.org/spec/1.0/)

**格式把结构边界写得很清楚。** 官方 JSON Canvas 规范规定顶层只有 `nodes` 和 `edges` 两个数组；节点有稳定 `id`、`type`、`x/y/width/height`，edge 有 `fromNode`、`toNode` 和可选 `label`。官方 API 源码的 `CanvasData` 也声明 `nodes`、`edges`，并保留任意扩展键以支持 forward compatibility。

来源：

- [JSON Canvas Specification 1.0](https://jsoncanvas.org/spec/1.0/)
- [obsidian-api/canvas.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts)

**详略靠视口和卡片类型管理。** 官方 Canvas 文档提供 Zoom to fit 和 Zoom to selection；也允许把 Canvas embed 到 note 中。它没有在 Canvas 文档中声明“overview/local/complete”这类语义投影层，因此这里的层级主要由 group、节点位置、链接和跳转操作共同形成。

### 2.2 公开结构示例与边界（D + I）

本轮没有找到 Obsidian 官方文档中可稳定引用、专门展示多级知识结构的静态截图；官方主证据是上述帮助文档、官方 `canvas.d.ts` 和 JSON Canvas 规范。可直接打开：

- [Obsidian Canvas 官方帮助页](https://help.obsidian.md/plugins/canvas)
- [JSON Canvas 官方规范示例页](https://jsoncanvas.org/spec/1.0/)
- [官方 API 类型源码](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts)

从格式层面可以明确读出一条可复用规则：group 提供**几何上的 containment**，edge 提供**稳定端点之间的 relation**，node 的 `text`/`file`/`link` 提供**局部内容**。但“某个 group 是问题簇、某个 edge 是 evidence relation”需要上层应用自己定义，不能从 JSON Canvas 自动推出。

### 2.3 可借鉴与不适合照搬（I）

**可借鉴：**

- 保持每条关系的稳定 `from` / `to` 端点和可读 label；跨簇聚合展示时仍保留真实 relation ID，类似 Canvas 的 edge 不因移动视口而改变端点。
- 采用开放、可扩展的节点/边快照思路；未知字段保留，避免把表达层操作误写成业务语义。
- 对窄视口提供 Zoom to selection/fit 或 local projection，让读者先看局部，再回到完整画布。

**不适合照搬：**

- JSON Canvas group 只是 visual container；不能把它直接当成 ForecastCompass 的 organization cluster，更不能用几何包含代替 `question/purpose/entry/exit`。
- Canvas 的文件节点假设本地 vault 文件路径；ForecastCompass 的实体、representation、annotation、evidence 和 relation 有不同生命周期，不能全压成 `file` 或 `text` node。
- Obsidian 的开放格式支持扩展不等于它自动提供多级语义、证据边界或阅读状态；这些需要本项目的 metadata 和 validation 维护。

## 3. Milanote：Board 树负责层级，Column/Presentation 负责同屏密度

### 3.1 产品逻辑（D）

**Board 可以嵌套形成显式父子层级。** 官方帮助中心写道：

> “Just like folders on your computer, boards can be placed inside of one another.”

它给出的工作流是创建子 board，或把一个 board 拖进另一个 board；桌面端左上角的 board navigation 显示从父级到当前 board 的路径。分享父 board 时，nested sub-boards 也会获得访问权限。

来源：

- [Nesting boards](https://help.milanote.com/en/articles/9860073-nesting-boards)

**同一 board 内用 Column 做局部分组和收缩。** 官方 Columns 页面说明 column 可以接收现有/新卡片、重排卡片、整体移动、调整宽度，并可以：

> “tap the small dash in the top right of a column to collapse and expand it.”

它还明确说 column 不能再嵌套 column，但 board 或 document 可以放进 column。这是一个很清楚的层级限制：**Board 是跨屏父子层级，Column 是单板内的同级组织容器**。

来源：

- [Columns](https://help.milanote.com/en/articles/10478526-columns)

**跨 board 关系用 shortcut、breadcrumb 和 search。** Link card 可以保存网页、媒体，也可以把目标 board 的 URL 转成 board shortcut；Move content 页面说明可通过左上 breadcrumb 把内容拖到父 board，或拖到 board tile 打开后放置。Search 页面说明搜索当前 board 和所有其他 board，并可按 Last viewed/Last modified 排序。

来源：

- [Links](https://help.milanote.com/en/articles/1722065-links)
- [Moving content between boards](https://help.milanote.com/en/articles/491831-moving-content-between-boards)
- [Search](https://help.milanote.com/en/articles/1116205-search)

**阅读模式把编辑层暂时隐藏。** Presentation mode 官方页面写道，它会隐藏编辑工具并全屏显示内容；还可隐藏 comments、禁止编辑、点击卡片进行 focus。这个机制解决的是“同一结构在讲解时需要减少操作噪声”，不是新建一份内容副本。

来源：

- [Presentation mode](https://help.milanote.com/en/articles/6815489-presentation-mode)

### 3.2 公开结构示例（D + 公开图示观察）

1. [Nested boards 官方页面及公开截图/GIF](https://help.milanote.com/en/articles/9860073-nesting-boards)。页面中的静态层级图把父 board “Design Project” 放在上层，并在其下列出 Client brief、Moodboard、Concepts 等子 board；动态示例显示顶部 breadcrumb 从 `Home / Client Projects / Branding Design` 进入当前板。可读性来自**父级路径 + 子板标题 + 每板卡片/文件计数**，读者不用在一张无限画布上同时承载所有细节。
2. [Columns 官方页面及 collapse/reorder 公开示例](https://help.milanote.com/en/articles/10478526-columns)。页面展示带标题和卡片计数的 column，并用 collapse 动画说明怎样收起内容、只保留 section 标题。这里的详略分配是**同板内先看 column 标题，展开后看卡片**；它和 nested board 的跨屏层级互补。

这两组图来自 Milanote 官方帮助页，实际读取了页面中的图示资源；本轮仍未登录或操作 Milanote UI。

### 3.3 可借鉴与不适合照搬（I）

**可借鉴：**

- 用明确的父级路径和 child cluster 表达多级结构；overview 只放簇标题/计数/入口，local 再展开概念和证据。
- 给组织簇增加 collapse/expand 的表达状态，保证窄屏默认只展示少量入口，完整成员仍可回读。
- 借鉴 presentation mode 的“同一数据、另一种阅读密度”：讲解/审阅时隐藏编辑噪声，点击或选择后聚焦目标对象。
- 用稳定 link card/deep link 作为跨簇入口，并提供全局 search；不要把跨簇对象复制成新的知识实体。

**不适合照搬：**

- Milanote 的 board nested 权限和内容移动是产品级 board ownership 语义；ForecastCompass 的 cluster 是表达层组织，不应因为移动 cluster 就移动实体、改变 relation endpoint 或改变证据归属。
- Column 是自由布局容器，适合标题—卡片列表，但不能替代有问题、目的、输入/输出和证据边界的语义 cluster。
- 公开页面证明了产品设计意图和图示结构；本轮没有实测拖拽、折叠、演示模式在当前版本的键鼠细节、性能或协作延迟。

## 4. 三款产品的机制对照

| 维度 | Heptabase | Obsidian Canvas | Milanote | 对 ForecastCompass 的含义 |
|---|---|---|---|---|
| 多级结构的承载物 | Card Library → Whiteboard → sub-whiteboard/section | Canvas → group/node/edge；group 首先是视觉容器 | Board → nested board；Column 是板内分组 | 需要同时保留语义 cluster 和空间/元素投影，不能只靠坐标或只靠树 |
| 详略分配 | Card 内 rich blocks；whiteboard 以 section/mindmap 组织 | text/file/link node；zoom selection/fit | child board 分屏；column collapse；presentation focus | 默认视图应是 essential + diagram，展开时再给 members/relations |
| 文本与空间 | 卡片是长期内容，whiteboard 是上下文 | text card/file node 与空间布局同存 | card/document/column/board 同屏 | 正文不应伪装成流程端点；文本和图解要有独立 stable ref |
| 跨图/跨板关系 | same card 多 whiteboards；deep links 指向 card/block/section | edge from/to ID、label、Go to source/target | board shortcut、breadcrumb、search | link 应回到稳定 relation/representation；聚合展示不能吞掉原边 |
| 阅读模式 | whiteboard / sub-whiteboard / published read-only link | zoom / selection / embed | presentation mode、focus、collapse | 需要 overview/local/complete 的可逆投影，不能把全图强行塞进一个窄 viewport |

## 5. 对当前 ForecastCompass notebook 的直接设计建议（I；内部上下文，不是产品证据）

本轮任务上下文记录：当前用户画布约为 `626×692`；左侧图解清楚，但右侧概念列会被裁切，底部正文会被宽工具栏遮挡。这个观察来自项目内部当前画布，不是三款产品的官方证据。

据此，三款产品共同支持以下小步设计：

1. **默认焦点只展示一个簇的 essential。** 关键概念和本簇 diagram 必须同时出现；其余成员通过 local/complete 展开。把多个屏幕上的旧表示再拼成一个 overlay，会破坏“当前簇”的阅读边界。
2. **把层级和空间分开。** 用稳定 cluster ID 表示组织语义，用 representation/element 的真实引用表示画面对象；不要用 group/section 的几何包含来推断 evidence 或 causal relation。
3. **入口/出口只指向可回读对象。** `entry`/`exit` 应指向概念表示或 anchor；跨簇 link 用 `relationIds` 回到真实论文边，正文只作为说明材料。
4. **提供显式的局部展开和回到 overview。** 参考 Heptabase 的 sub-whiteboard/deep link、Milanote 的 breadcrumb/nested board、Obsidian 的 zoom-to-selection/Go to source/target；保留“当前阅读位置”而不是复制内容。
5. **继续保持证据边界。** 这些产品展示了组织和阅读机制，不能证明 ForecastCompass 的论文数据、实验结果或用户理解质量。实施前仍需用当前 canvas revision、expression validation 和端点存在性做独立核验。

## 6. 来源索引（官方第一手）

### Heptabase

- [Fundamental Elements](https://wiki.heptabase.com/fundamental-elements) — Card、Whiteboard、sub-whiteboard、section、同一卡片多 whiteboards、Card Library 与 block 内容。
- [Getting started with Heptabase](https://wiki.heptabase.com/getting-started-with-heptabase) — knowledge network 与 browser-like UI logic。
- [Use deep links](https://support.heptabase.com/en/articles/11176386-use-deep-links) — card/block/whiteboard/section 定位与访问边界。
- [Publish a whiteboard](https://support.heptabase.com/en/articles/12121546-publish-a-whiteboard) — nested whiteboards、read-only link、live update 与 snapshot。
- [官方 Whiteboard 示例图 1](https://wiki.heptabase.com/assets/images/fundamental-elements-05-09bdcef0387e799f8ca0ded0d6599e19.png)。
- [官方 Whiteboard 示例图 2](https://wiki.heptabase.com/assets/images/fundamental-elements-06-b566b3fb7036472c703adfbe5b417419.png)。

### Obsidian / JSON Canvas

- [Obsidian Help — Canvas](https://help.obsidian.md/plugins/canvas) — infinite space、cards、groups、connections、Go to source/target、zoom、embed。
- [Obsidian Help 官方源码 Canvas.md](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md) — 官方文档源文件；本轮读取的版本提交为 [`44b1224d`](https://github.com/obsidianmd/obsidian-help/commit/44b1224d33df77d2b8e7821ac73d92096d92f406)。
- [JSON Canvas Specification 1.0](https://jsoncanvas.org/spec/1.0/) — nodes/edges、group visual container、edge endpoint/label。
- [obsidian-api/canvas.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts) — 官方 `CanvasData`、node/edge 类型；本轮读取的版本提交为 [`9ad9c0b8`](https://github.com/obsidianmd/obsidian-api/commit/9ad9c0b89a878a96da2a127bd35e6864f0ab87aa)。

### Milanote

- [Nesting boards](https://help.milanote.com/en/articles/9860073-nesting-boards) — board 父子层级、breadcrumb、nested sharing；含公开层级图示。
- [Columns](https://help.milanote.com/en/articles/10478526-columns) — 板内分组、排序、collapse/expand；含公开 GIF/截图。
- [Links](https://help.milanote.com/en/articles/1722065-links) — link card 与 board shortcut。
- [Moving content between boards](https://help.milanote.com/en/articles/491831-moving-content-between-boards) — breadcrumb、board tile、copy/paste 的跨板操作。
- [Search](https://help.milanote.com/en/articles/1116205-search) — 当前 board 与全局 board 搜索及排序。
- [Presentation mode](https://help.milanote.com/en/articles/6815489-presentation-mode) — 隐藏编辑工具、focus、禁止编辑、全屏阅读。

## 7. 未验证项与停止边界

- 没有登录或实际操作三款产品，因此不报告真实 UI 的点击路径、响应速度、当前版本差异或协作冲突行为。
- 本轮通过 shell HTTP 读取公开页面；没有可用的 in-app browser tab，也没有对用户画布或任何第三方账户执行浏览器操作。
- 没有比较价格、套餐、免费额度或商业许可。
- Heptabase 页面中“知识网络/浏览器”是厂商产品模型；本文把它用于机制分析，不把它当作用户认知效果的实验证明。
- Obsidian JSON Canvas 规范明确 group 是 visual container，但没有规定上层语义 cluster；ForecastCompass 的 organization schema 仍需自行验证。
- Milanote 官方截图/GIF 只证明公开示例中存在父子 board、column 和 focus 视觉结构，不能证明所有复杂 board 都能在窄屏上保持可读。
- 研究结束时再次逐项 HTTP 核验了文中主要页面与两张 Heptabase 图片，均返回 200；Obsidian 的官方帮助页和官方 GitHub 源码也都可读取。此前一次请求曾得到临时 403，但不构成当前证据缺口。
