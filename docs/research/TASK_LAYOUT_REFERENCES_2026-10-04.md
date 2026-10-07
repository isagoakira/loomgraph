# 任务图谱的子流程、运行状态与稳定布局：一手资料研究

日期：2026-10-04  
范围：只读调研 n8n、Node-RED、React Flow、ELK 与 yFiles 的子流程/运行状态/复合层级/真实尺寸/增量布局/跨层连接机制。  
目标：把成熟产品真正使用的产品机制，与布局引擎只提供的技术能力分开，为任务图谱的多级展开、碰撞避免和跨屏关系设计提供依据。

## 结论先行

成熟产品解决“多级任务图谱变乱”的核心不是把所有子节点一次性塞进同一张无限画布，而是把五个边界做成一等概念：

1. **子流程是独立可运行的边界**：父图只显示一个可进入的代理节点，子图在独立工作区展开；运行时用 parent/child execution lineage 连接两边。
2. **折叠是视图投影，不是删除结构**：图模型保留完整层级，当前视图只暴露可见层级；复合布局需要知道哪些层级一起算、哪些层级分开算。
3. **布局输入必须是真实可见几何**：节点尺寸来自已测量的内容，父容器 bounds 由子节点和 padding 向上汇总；固定节点、端口和关系标签也必须进入障碍/路由模型。
4. **增量变化只重排受影响子集**：新增节点、移动节点、重路由边和展开子图要有独立的 incremental scope，旧节点保留相对顺序或锚点；整图重排应是显式动作。
5. **跨层关系必须有边界语义和出口**：跨子流程的边连接到父层的入口/出口/状态端口，点击后可沿 lineage 进入另一层；布局引擎可以画跨层线，但不会替产品决定关系语义、可见性和导航。

因此，React Flow 的 `parentId`、ELK 的 compound/cross-hierarchy、yFiles 的 `fromSketchMode` 都只是不同层次的技术支持。它们不会自动提供任务图谱需要的“何时展开、展开到哪一层、谁保持不动、跨屏线如何解释、运行状态显示在哪里”等产品规则。

## 1. 子流程边界：把“可复用结构”和“运行实例”分开

### 一手事实

**n8n 把子工作流作为可调用的独立工作流。** 官方文档将用途写成“Call workflows from other workflows, and split large workflows into smaller components”，并规定父工作流用 `Execute Sub-workflow`，子工作流用 `Execute Sub-workflow Trigger`。数据从父节点传入子触发器，子工作流的最后一个节点把数据传回父节点。[事实，n8n 官方文档](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts.md)：

> “You can call one workflow from another workflow.”  
> “The Execute Sub-workflow node passes the data to the Execute Sub-workflow Trigger node … The last node of Workflow B sends the data back to the Execute Sub-workflow node in Workflow A.”

n8n 还把同步关系做成显式选项，而不是隐含猜测：`Wait for Sub-Workflow Completion` 控制主工作流是等待子工作流结束，还是继续向后执行。[事实，n8n 官方节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md)：

> “This lets you control whether the main workflow should wait for the sub-workflow's completion before moving on to the next step (turned on) or whether the main workflow should continue without waiting (turned off).”

运行记录也保留双向入口。n8n 文档说明父工作流的 `Execute Sub-workflow` 节点有 `View sub-execution` 链接，子执行也有返回父执行的链接。[事实，n8n 官方节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md)：

> “You can follow the execution flow from the parent workflow to the sub-workflow … Likewise, the sub-workflow's execution contains a link back to the parent workflow's execution.”

n8n 的运行状态不是只画在节点颜色上。执行列表可按 `Failed`、`Running`、`Success`、`Waiting` 过滤；修改已经执行过的节点、连接器或子节点后，相关输出会被标为 dirty，表示旧结果可能失效。[事实，n8n 官方文档：[执行列表](https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow.md)、[dirty nodes](https://docs.n8n.io/build/understand-workflows/understand-executions/understand-dirty-nodes.md)]：

> “Status: choose from Failed, Running, Success, or Waiting.”  
> “A dirty node is a node that executed successfully in the past, but whose output n8n now considers stale or unreliable.”

**Node-RED 把 subflow 作为工作区中的折叠单节点，同时保留独立编辑 tab。** 官方文档定义：[事实，Node-RED 官方文档](https://nodered.org/docs/user-guide/editor/workspace/subflows)：

> “A subflow is a collection of nodes that are collapsed into a single node in the workspace.”  
> “The subflow is opened in the workspace as a new tab.”

Node-RED 明确禁止 subflow 直接或间接包含自身，避免层级展开形成递归循环；实例加入 palette 后可像普通节点一样反复放入工作区。[事实，同上文档]：

> “a subflow cannot contain an instance of itself - either directly or indirectly.”  
> “Individual instances of the subflow can then be added to the workspace just like any other node.”

运行状态有独立的 status output。Node-RED 文档说明 subflow 的 status 输出可以更新 subflow instance 节点的状态；状态对象由 `fill`、`shape`、`text` 组成，编辑器默认显示，也可以关闭。[事实，Node-RED 官方文档：[subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows)、[node status](https://nodered.org/docs/creating-nodes/status)]：

> “The toolbar provides an option to add a ‘status’ output to a subflow. This can be used to update the Status of subflow instance nodes.”  
> “A status object consists of three properties: fill, shape and text.”

Node-RED runtime 源码进一步证明这不是纯 UI 约定：每个实例会把 subflow definition 克隆并赋予唯一 ID，建立实例路径；status 会向父 flow 交接；没有本层 catch 时 error 会继续向父 flow 传播。[事实，Node-RED 官方源码](https://github.com/node-red/node-red/blob/main/packages/node_modules/@node-red/runtime/lib/flows/Subflow.js)：

> “creates a clone of the definition with unique ids applied”  
> `this.path = parent.path + "/" + (subflowInstance._alias || subflowInstance.id)`  
> `this.node.status = status => this.parent.handleStatus(this.node, status)`  
> “Pass up to the parent flow.”

### 对任务图谱的产品推断

这些产品都把“结构复用”和“运行实例”拆成两条关系：

- **结构边界**：父图中的 subflow 节点代表一个可复用定义或调用点；内部节点不默认铺开到父图。
- **运行谱系**：一次具体运行有 `parentExecutionId`、`childExecutionId`、状态、输入/输出和等待关系；这条关系允许用户在父任务与子任务间往返，而不要求两张图永远同时可见。
- **状态传播**：状态应先归属于运行实例，再投影到父层代理节点。`success/running/waiting/failed/dirty` 不应靠布局位置猜测。

这直接防止多级展开混乱：同一时间只需在一个层级读流程，用户用面包屑、`View sub-execution` 或“进入子流程”打开下一层；返回时保留父层相机和选中节点。

### 技术支持与产品责任

| 能力 | 技术支持 | 仍需产品自己定义 |
|---|---|---|
| 子图复用 | Node-RED 的 subflow definition clone；n8n 的 workflow ID/trigger | 代理节点如何命名、入口/出口如何解释、是否允许递归、最大展开深度 |
| 运行状态 | n8n execution status；Node-RED status node/runtime bubble | 状态颜色、等待/失败/脏数据的优先级、父节点如何聚合多个子状态 |
| 父子导航 | n8n 双向 execution link；Node-RED 新 tab | 面包屑、返回原位置、跨图定位、是否打开新画布/侧栏 |
| 数据契约 | n8n 输入字段/JSON example；Node-RED 输入/输出节点 | 端口语义、必填/可选字段、版本兼容与错误展示 |

## 2. 复合层级与折叠：布局的是“当前投影”，不是永远完整图

### 一手事实

React Flow 的 subflow 文档区分了父子坐标和真正的 DOM 层级。设置 `parentId` 后，子节点位置相对父节点；`extent: 'parent'` 才会限制子节点不出父边界。文档明确说，`parentId` 只做相对定位，子节点并不因此成为父节点的 markup 子节点；没有 extent 时仍可能拖出父边界。[事实，React Flow 官方文档](https://reactflow.dev/learn/layouting/sub-flows)：

> “Once we do that, the child node is positioned relative to its parent.”  
> “The child node is not really a child markup-wise.”  
> “you can drag or position the child outside of its parent (when the extent: 'parent' option is not set)”

它还说明了跨层 edge 的渲染层级：连接到有父节点的节点的 edge 默认会渲染在节点上方，并可用 `zIndex` 调整。[事实，同上文档]：

> “Edges connected to a node with a parent are rendered above nodes.”

React Flow 官方类型源码把这些能力直接写进数据结构：`parentId` 用于 sub-flow，`extent` 是移动边界，`expandParent` 允许子节点拖到边缘时自动扩展父节点；`measured` 记录内部测量尺寸。[事实，React Flow 官方源码](https://github.com/xyflow/xyflow/blob/main/packages/system/src/types/nodes.ts)：

> `/** Parent node id, used for creating sub-flows. */ parentId?: string;`  
> `/** Boundary a node can be moved in. */ extent?: 'parent' | CoordinateExtent | null;`  
> `/** When true, the parent node will automatically expand … */ expandParent?: boolean;`  
> `measured?: { width?: number; height?: number }`

ELK Layered 明确支持 compound graph 和跨 hierarchy edge。其官方参考说明：算法把节点放入有方向的层，再按减少 crossing 的目标重排，并计算节点坐标和 edge bend points；compound graph 的跨层级 edge 需要在顶层打开相应选项。[事实，Eclipse Layout Kernel 官方参考](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)：

> “full layout of compound graphs with cross-hierarchy edges is supported when the respective option is activated on the top level.”  
> “The nodes are arranged in layers … reordered such that the number of edge crossings is minimized. Afterwards, concrete coordinates are computed for the nodes and edge bend points.”

ELK 还把层级计算策略显式化：`INCLUDE_CHILDREN` 可以让一个 compound node 与后代在同一 layout run 中计算，`SEPARATE_CHILDREN` 会为该节点触发新的 layout run；官方说明把多个层级放进同一 run 可能有助于正确处理跨层 edge。[事实，ELK 官方参考](https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html)：

> “INCLUDE_CHILDREN will lay out that node and all of its descendants in a single layout run.”  
> “SEPARATE_CHILDREN will ensure that a new layout run is triggered for a node with that setting.”  
> “Including multiple levels of hierarchy in a single layout run may allow cross-hierarchical edges to be laid out properly.”

yFiles 的 hierarchical nesting demo 把折叠看作清晰度机制：折叠 group 后只显示部分结构；每次展开/折叠运行 `from sketch mode`，让当前可见部分仍然有组织并尽量接近上一次安排。[事实，yWorks 官方 demo 源码仓库](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/hierarchical-nesting/README.md)：

> “Folding ('collapsed groups') can help to keep complex hierarchically organized diagrams clear and straightforward by showing only parts of the entire structure.”  
> “Each user action triggers a run of the from sketch mode … remains still similar to the previous arrangement.”

yFiles 还明确记录了递归 edge 的产品/路由难题：如果 edge 从 group 内部离开 group 到外部节点，经过 group 侧边时，展开/折叠后可能丢失维持稳定所需的信息；该 demo 采用让 edge 从 group 顶部进入、底部离开的 routing style 保留信息。[事实，同上 demo README]：

> “information to keep the layout stable after expanding/collapsing the group node may be lost.”  
> “This routing style forces all edges to enter groups at the top and leave them at the bottom.”

### 对任务图谱的产品推断

复合布局应采用“两层对象”而不是把全部内容当作同一平面：

1. **完整图模型**：实体、父子关系、调用关系和运行实例始终存在。
2. **当前可见投影**：根据 `scope/depth/density/disclosure` 选择可见节点和可见关系，再为这批可见对象布局。
3. **折叠代理**：被折叠的子图由一个 proxy/container 表示，proxy 持有子图摘要、状态汇总和入口/出口端口。
4. **展开返回**：展开只改变投影范围和布局输入，不重新生成实体 ID，也不把内部边复制成新的父层边。

若把所有层级一次性 flatten，ELK 或 yFiles 能算出几何，但用户仍会看到跨屏长线、重复标题和无法判断的层级。若只依赖 React Flow `parentId`，子节点可以只是相对定位对象；是否真正被裁剪、折叠时显示什么、父容器高度怎样更新，仍需产品层定义。

## 3. 真实节点尺寸与父容器 bounds：先测量，再排布

### 一手事实

React Flow 官方 Node 文档把 `width`/`height` 标为内部计算值，建议通过 style/className 控制尺寸，而不是直接改内部尺寸；Node 类型也暴露 `measured` 宽高。官方文档写得很明确：[事实，React Flow 官方 API](https://reactflow.dev/api-reference/types/node)：

> “width and height should be considered read-only.”  
> “It is calculated internally by React Flow and used when rendering the node in the viewport.”  
> “To control a node’s size you should use the style or className props.”

布局应等待所有可见节点完成测量。`useNodesInitialized()` 的官方 API 说明，在新节点加入后先返回 `false`，全部节点得到 width/height 后再返回 `true`，示例在这个时点调用 layout function。[事实，React Flow 官方 API](https://reactflow.dev/api-reference/hooks/use-nodes-initialized)：

> “This hook tells you whether all the nodes in a flow have been measured and given a width and height.”  
> “When you add a node to the flow, this hook will return false and then true again once the node has been measured.”

React Flow 的 layout 选择页明确把动态尺寸与 sub-flow layout 分开列出。它指出 ELK 同时支持 dynamic node sizes、sub-flow layout 和 edge routing；同时也提醒 React Flow 自己没有实现布局方案，需要异步接入外部库。[事实，React Flow 官方 layout 指南](https://reactflow.dev/learn/layouting/layouting)：

> “We have not implemented our own layouting solution yet, but will present some viable external libraries.”  
> 在能力比较表中，ELK 的三项为 `Yes / Yes / Yes`：dynamic node sizes、sub-flow layouting、edge routing。

ELK Layered 的参考页把节点尺寸、最小尺寸、padding、层间间距和节点间距都列为独立布局输入；例如 `nodeNodeBetweenLayers` 的定义是相邻层任意节点对之间应保留的间距，层内节点则使用另一个 `nodeNode` 间距。[事实，ELK 官方参考](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-spacing-nodeNodeBetweenLayers.html)：

> “The spacing to be preserved between any pair of nodes of two adjacent layers.”  
> “‘spacing.nodeNode’ is used for the spacing between nodes within the layer itself.”

yFiles 官方 interactive graph restructuring demo 在拖动子树时把节点当前 layout 的 top-left 和 `layout.toSize()` 记录进 `GivenCoordinatesLayoutData`；这是把实际图节点 bounds 作为布局数据保存的直接源码证据。[事实，yWorks 官方 demo 源码](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/input/interactivegraphrestructuring/RelocateSubtreeLayoutHelper.ts)：

> `layoutData.nodeLocations.mapper.set(node, layout.topLeft)`  
> `layoutData.nodeSizes.mapper.set(node, layout.toSize())`

### 对任务图谱的产品推断

任务图谱不能用一个固定 card size 代替内容边界，尤其是节点展开、运行状态、错误详情和关系标签会改变高度。可行的布局输入契约应至少包含：

- 节点的 **source geometry** 与当前可见投影的 **measured geometry**；
- 节点 padding、标题/正文/状态徽章/端口/关系标签占用的真实 bbox；
- 父容器 bounds：`union(children bounds + padding + header + port margin)`；
- 旋转、固定/pinned 状态、不可重排障碍和 viewport anchor；
- 布局版本与 measurement version，避免旧测量覆盖新展开状态。

展开流程应是：渲染当前投影 → 等待可见节点测量 → 计算父容器 bounds → 只对受影响子树和邻接关系生成候选布局。临时阅读 reflow 可以直接在当前视图预览并应用，不要求二次确认，也不能把临时阅读高度无条件写回源数据；只有显式跨组/整图重排候选才需要用户检查并应用，确认后再持久化位置。收起时可以保留上次子图布局缓存。

### 技术支持与产品责任

| 问题 | 技术支持 | 产品必须决定 |
|---|---|---|
| 尺寸 | React Flow `measured` / `useNodesInitialized`；ELK dynamic sizes；yFiles layout bounds | 何时认为测量完成、字体/异步内容变化时是否重新排布 |
| 父容器 | React Flow `parentId`/`extent`；ELK compound graph；yFiles group layout | 子节点、header、端口和状态徽章如何共同决定父 bounds |
| 碰撞 | ELK spacing、布局引擎的坐标与路由；yFiles clear-area 等布局 | pinned 是否为障碍、碰撞 margin、局部移动范围、预览/提交边界 |
| 视觉详略 | React Flow `hidden` / collapse 由应用实现 | 当前层显示摘要还是完整正文，跨层关系显示多少 |

## 4. 增量/稳定布局：变化局部化，旧关系可读性优先

### 一手事实

yFiles 官方 incremental hierarchical demo 对“局部加入现有图”的定义非常明确：预先标记一部分 incremental nodes/edges，打开 `fromSketchMode`，让这些新增对象融入已有 drawing；已有元素可以移动，但相对顺序保持。[事实，yWorks 官方 demo README](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout-features/hierarchical-incremental/README.md)：

> “a predefined subset of nodes … is integrated into an existing drawing.”  
> “While the existing elements may change their positions, their relative order is maintained.”  
> “The algorithm has to be told to work in incremental layout mode … `fromSketchMode` … `incrementalNodes` and `incrementalEdges`.”

官方 TypeScript demo 把这两个约束落实为代码：`new HierarchicalLayout({ fromSketchMode: true })`，并以 `HierarchicalLayoutData({ incrementalNodes: ... })` 指定子集。[事实，yWorks 官方源码](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout-features/hierarchical-incremental/HierarchicalIncrementalDemo.ts)：

> `incrementalNodes: (node) => node.tag?.includeInLayout`  
> `const hierarchicalLayout = new HierarchicalLayout({ fromSketchMode: true })`

在 nested graph 中，yFiles 对首次展开还采用“按需取子节点 + 增量标记”的流程。官方 README 说，展开 folded group 时检索 child nodes，再把它们标为 `HierarchicalLayoutData.incrementalNodes`；`from-sketch mode` 让当前可见图保持良好组织，同时接近之前的 arrangement。[事实，yWorks 官方 demo](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/hierarchical-nesting-incremental/README.md)：

> “Each time a folded group is expanded for the first time, all of its child nodes are retrieved and then marked as incremental.”  
> “the currently visible part of the graph is well-organized while remaining similar to the previous arrangement.”

yFiles interactive hierarchical demo 进一步把节点、边、移动和创建都纳入同一增量节奏：移动/resize 后更新布局，创建新节点时把它放到创建位置附近，创建 edge 时只把新 edge 加入 incrementalEdges，再计算布局。[事实，yWorks 官方 demo](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/interactive-hierarchical/README.md)：

> “Move and resize nodes and watch the layout update.”  
> “Create new nodes and observe how they are inserted into the drawing near the place they have been created.”  
> “Create edges and see the routes being recalculated immediately.”

yFiles 的交互重构源码还处理了并发布局：正在运行时不重复进入，而是设置 `layoutPending`，当前计算结束后再跑一次；拖动子树期间，其他 sibling subtree 被记录为不应修改的组件，取消时用保存的原坐标恢复。[事实，yWorks 官方源码](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/input/interactivegraphrestructuring/RelocateSubtreeLayoutHelper.ts)：

> “if another layout is running: request a new layout and exit”  
> `this.layoutPending = true`  
> “Sibling subtrees that should not be modified by the layout.”  
> “reset to original graph layout”

**边的增量路由也应独立于节点布局。** yFiles incremental edge router demo 只对 `EdgeRouterData.scope` 选中的边运行 router，而不是全图重算。[事实，yWorks 官方 demo](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout-features/edge-router-incremental/README.md)：

> “This demo shows how to run the edge router algorithm on a predefined subset of edges in a graph.”  
> “the algorithm works on the subset of orange edges only.”

需要明确的边界：本次 ELK 官方参考核验到的是 compound、cross-hierarchy、层级/间距/crossing/routing 选项；没有据此声称 ELK Layered 自动提供 yFiles `fromSketchMode` 一样的增量稳定语义。React Flow 官方页面也把 ELK 描述为外部、异步、配置复杂的布局引擎；稳定增量仍需选用有该语义的算法或由应用维护固定/锚定对象。[事实 + 边界，React Flow layout 指南](https://reactflow.dev/learn/layouting/layouting)、[ELK Layered 参考](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)。

### 对任务图谱的产品推断

把每次布局请求拆成四类变化，比“layout all”更适合任务图谱：

- **新增节点/首次展开**：只把新节点、其父容器和相邻边标为 incremental；保留远处任务的相对顺序和相机位置。
- **内容变高/状态更新**：先更新真实 bbox，再只推动与其相交的邻居和祖先 bounds；不因一张卡展开就重排整张图。
- **用户拖动/pinned**：用户移动的对象和明确 pinned 对象作为 fixed/obstacle；重排候选只在局部 corridor 中移动。
- **边变化**：新增或受影响的边单独路由；不让一条新跨层边触发整图节点重新分层。

布局应返回 `previewId`、`baseRevision`、受影响对象、移动距离/跨屏风险和可取消状态。布局中途的新操作使旧 preview 失效；这与 yFiles `layoutPending`/取消恢复所体现的产品需求一致。

## 5. 跨层连接：引擎能路由，产品要定义“这条线代表什么”

### 一手事实

ELK Layered 支持 compound graph 的跨 hierarchy edge、ports、edge labels 和多种 routing styles；官方算法页还说明正交 routing 可以尊重任意 port constraints。[事实，ELK 官方算法参考](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)：

> “This implementation supports different routing styles (straight, orthogonal, splines).”  
> “if orthogonal routing is selected, arbitrary port constraints are respected”  
> “Compound … Edges that connect nodes from different hierarchy levels and are incident to compound nodes.”

ELK 的 crossing minimization 是布局算法的一项可配置目标，官方选项提供 `LAYER_SWEEP`、`MEDIAN_LAYER_SWEEP`、`INTERACTIVE`、`NONE` 等策略。[事实，ELK 官方选项](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-strategy.html)：

> “Strategy for crossing minimization.”  
> Possible values include `LAYER_SWEEP`, `MEDIAN_LAYER_SWEEP`, `INTERACTIVE`, and `NONE`.

React Flow 的 subflow 示例允许“组内节点 → 组外节点”的 edge；但文档只说明 edge 的渲染层级和 `zIndex`，不会为跨层 edge 赋予业务意义。[事实，React Flow 官方 subflow 文档](https://reactflow.dev/learn/layouting/sub-flows)：

> “you can connect nodes within a group and create connections that go from a sub flow to an outer node”  
> “If you want to customize the z-index of edges, you can use the `zIndex` option.”

Node-RED 的 subflow 采用明确的输入/输出节点；其 status output 也可以作为另一种运行状态出口，而不是把内部所有 wires 都暴露给父层。[事实，Node-RED subflow 文档](https://nodered.org/docs/user-guide/editor/workspace/subflows)：

> “The inputs and outputs of the subflow are represented by the grey square nodes that can be wired into the flow as normal.”  
> “The toolbar provides an option to add a ‘status’ output to a subflow.”

yFiles hierarchical nesting demo 说明跨 group 的 recursive edge 可能破坏展开/折叠后的稳定性，因此用统一边界方向保存入口/出口信息；这说明跨层 edge 的几何路线本身也是层级交互协议的一部分。[事实，yWorks 官方 demo](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/hierarchical-nesting/README.md)。

原始层次布局论文是 Sugiyama、Tagawa、Toda 的 **Methods for Visual Understanding of Hierarchical System Structures**，IEEE Transactions on Systems, Man, and Cybernetics，1981，DOI：[10.1109/TSMC.1981.4308636](https://doi.org/10.1109/TSMC.1981.4308636)。ELK 官方算法页明确把其层次方法谱系追溯到该论文，并概括为先分层、再减少 crossing、最后计算节点与 bend points。[事实，ELK 官方算法参考 + 原论文 DOI](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)。

### 对任务图谱的产品推断

跨层关系至少要分成三类，否则所有线都会变成“跨屏长线”：

1. **数据/控制流**：从父层出口到子层入口，或从子层出口返回父层；默认只画 boundary edge，进入子图后才显示内部细节。
2. **运行状态**：子任务状态向父代理节点聚合，使用 badge/status edge/状态时间线表示，不与数据流共用同一种箭头。
3. **引用/依赖关系**：可以在当前层显示为 portal/link badge，点击后打开目标节点所在层级并保存返回点；不强迫当前 viewport 同时容纳两端完整内容。

跨层边的产品规则应包括：

- 每条跨层 edge 有 `sourceBoundary`、`targetBoundary` 或稳定端口，不直接穿越任意子卡片；
- 折叠时边接到 proxy 的语义端口，展开时可重新投影到内部端口，但保持同一 relation ID；
- 多条同方向跨层边可聚合，标签显示数量/状态，点击才展开成员；
- 边的点击目标与节点导航共用 lineage，避免用户只能看见线却无法找到另一端；
- 若目标在屏幕外，提供 portal/mini-map/定位动作，而不是把相机强行缩到全图不可读。

这些是产品协议。ELK 的 cross-hierarchy edge、React Flow 的 group edge、yFiles 的 recursive-edge routing 只能提供几何和渲染支撑，不能替产品决定“是否显示、显示成什么、点击后去哪”。

## 3–5 个机制的产品落地顺序

如果只能先做一轮，优先顺序应是：

1. **先建立运行与结构边界**：每个可展开任务有稳定 ID、父子 lineage、输入/输出/状态端口；父图默认只放代理节点。
2. **再建立投影状态机**：把 scope、depth、density、disclosure、运行状态拆成可记录状态；折叠/展开只更新当前投影，不改源图身份。
3. **再接真实测量布局**：只对当前可见对象测量，父 bounds 向上传播，pinned/固定对象进入障碍，输出临时 preview。
4. **再做增量稳定**：新增节点、展开子图和新增边分别进入 incremental scope；远处布局保持相对顺序，旧 preview 在 revision 变化后失效。
5. **最后统一跨层关系**：数据流、状态流、引用关系采用不同视觉语言；跨层线连接到稳定 boundary port，并能从线回到另一层。

## 事实、推断与边界汇总

| 结论 | 证据性质 | 已确认内容 | 尚需产品定义 |
|---|---|---|---|
| 子流程不应默认 flatten | 产品事实 + 推断 | n8n 用独立 workflow/child execution；Node-RED 用折叠单节点和新 tab | 最大展开深度、面包屑、父相机恢复 |
| 父子层级需要独立 layout scope | 技术事实 + 推断 | React Flow `parentId`/extent；ELK hierarchy handling；yFiles folding | scope/density/disclosure 的状态模型 |
| 真实尺寸必须进入 layout | 技术事实 | React Flow measured/useNodesInitialized；ELK spacing/size；yFiles `layout.toSize()` | measurement 完成条件、bbox 传播和临时几何提交策略 |
| 增量布局保留稳定性 | yFiles 事实 | `fromSketchMode` + incremental nodes/edges；展开时按需加载并标记增量 | 哪些对象固定、移动预算、取消/冲突策略 |
| 跨层关系不能只靠引擎 | 技术事实 + 产品推断 | ELK compound/cross-hierarchy；React Flow group edge；yFiles recursive-edge route | 关系语义、boundary ports、聚合、portal 和导航 |
| ELK 等于稳定增量布局 | **本轮未证实，不能作为能力承诺** | 本次官方资料确认 ELK 的 compound/cross-hierarchy、层级、间距、crossing 和 routing 选项；未确认 ELK 具备 yFiles `fromSketchMode` + incremental nodes/edges 的对应语义 | 若需要稳定增量，需另选明确支持该语义的算法，或由应用维护增量/固定规则 |

## 来源与核验说明

本次资料均来自官方文档、官方仓库源码/示例或原论文 DOI，检索时间为 2026-10-04（Asia/Shanghai）。关键来源如下：

- n8n：[Break workflows into smaller parts](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts.md)、[Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md)、[View executions](https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow.md)、[Dirty nodes](https://docs.n8n.io/build/understand-workflows/understand-executions/understand-dirty-nodes.md)。
- Node-RED：[Subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows)、[Node status](https://nodered.org/docs/creating-nodes/status)、[runtime Subflow.js](https://github.com/node-red/node-red/blob/main/packages/node_modules/@node-red/runtime/lib/flows/Subflow.js)。
- React Flow：[Sub Flows](https://reactflow.dev/learn/layouting/sub-flows)、[Layouting](https://reactflow.dev/learn/layouting/layouting)、[Node type](https://reactflow.dev/api-reference/types/node)、[useNodesInitialized](https://reactflow.dev/api-reference/hooks/use-nodes-initialized)、[NodeBase source](https://github.com/xyflow/xyflow/blob/main/packages/system/src/types/nodes.ts)。
- ELK：[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)、[Hierarchy Handling](https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html)、[Crossing Minimization Strategy](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-strategy.html)、[Node spacing between layers](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-spacing-nodeNodeBetweenLayers.html)。
- yFiles：[Hierarchical nesting](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/hierarchical-nesting/README.md)、[Hierarchical nesting incremental](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/hierarchical-nesting-incremental/README.md)、[Hierarchical incremental](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout-features/hierarchical-incremental/README.md)、[Interactive hierarchical](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout/interactive-hierarchical/README.md)、[Recursive group layout](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout-features/recursive-group-layout/README.md)、[Incremental edge router](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/layout-features/edge-router-incremental/README.md)、[Interactive graph restructuring source](https://github.com/yWorks/yfiles-for-html-demos/blob/master/demos/input/interactivegraphrestructuring/RelocateSubtreeLayoutHelper.ts)。
- 原论文：[Sugiyama, Tagawa, Toda, 1981, DOI 10.1109/TSMC.1981.4308636](https://doi.org/10.1109/TSMC.1981.4308636)。

本次没有修改源码、live project、配置或旧文档；只新增本研究文档。
