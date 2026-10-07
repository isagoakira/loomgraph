# 关系展示重设计调研：从线块交叠到可读的流程关系层

日期：2026-10-06  
范围：Agent Visual Canvas 的关系路径、边标签、交互与流程图展示。  
本报告只做产品调研和实现建议，不修改源代码、正式画布、MCP 配置或生产计费数据。

## 结论先行

当前问题不是单纯的颜色、线宽或箭头样式问题，而是“关系路由、关系标签、交互层”没有形成一个闭环：

1. 关系默认使用 cubic 曲线，流程图没有默认的正交通道，也没有基于障碍物的全局路径规划。
2. maintainer 虽然计算了 `start → middle → end` 和标签避让位置，但渲染器在接收维护结果时只使用首尾点重新生成 cubic 曲线，实际的 `middle` 路由点被丢弃。这会直接造成“看起来已经规划过，画面却仍穿过卡片”的错觉。
3. 标签只作为同一 SVG 中的 `<text>` 绘制；当前浅色描边只能遮住一小段线，不能解决标签之间、标签与路径之间的占位关系。标签宽度也是按字符数估算，未使用真实字体测量。
4. 现有维护 pass 的标签候选只在 midpoint 的上下方向搜索，且只检查标签矩形与节点/已放置标签的碰撞，不检查标签与边路径、组边界、箭头和其他路由通道的碰撞。

因此，重做目标应当是：**先把关系当作带语义的可路由对象，再把路径、标签和交互分别投影到不同层；自动路由解决线穿块，标签求解器解决文字碰撞，交互层负责选择与手工修正。**

## 同行实现提炼

这里选择四个官方文档入口，分别覆盖自动路由、交叉表达、障碍物与标签联合布局、以及可交互的边标签。

### 1. draw.io：自动路由 + 线跳是两种互补机制

[Route connectors around shapes automatically](https://www.drawio.com/docs/manual/connectors/connectors-auto-route/) 将自动路由定义为带直角弯的路径，要求连接线不穿过其他形状；形状移动、缩放或进入路径时自动重新计算。它还把“一次性正交整理”和“持续自动路由”分开：前者是布局动作，后者是连接线的持续行为。

[Style connectors](https://www.drawio.com/docs/manual/styles/connector-styles/) 将连接线的 waypoint 样式、正交/曲线/自动绕形状，以及重叠线的 `arc`、`gap`、`sharp` line jump 明确拆开。含义是：先尽量改变路径消除交叠；无法消除时，再用线跳把“谁在上面”表达出来。线跳不是路由算法的替代品。

对本项目的直接启示：

- 流程图默认走正交自动路由，节点移动时只重算受影响的边。
- 用户拖动某段边后，边进入 `manual` 状态，保存 waypoint；“恢复自动整理”才重新交给路由器。
- 多条边无法完全分离时，给共享段使用总线/汇合点，再在最后一段分叉；仅对不可避免的交叉启用 line jump。
- 思维导图常需要关系相对节点保持稳定，可提供 follow-terminals 类行为；流程图的绕障关系则应保留绕过障碍物的绝对路径策略。

### 2. yFiles：把节点、边、标签放进同一个约束系统

[Orthogonal Layout](https://docs.yworks.com/yfiles-html/dguide/orthogonal_layout/) 的 integrated labeling 会在计算节点位置和边路径时同时考虑边标签；文档明确指出，标签不会与其他图元素重叠。其正交布局还追求紧凑、少交叉、少弯折，并支持分组图。

同一文档还区分了“集成式标签布局”和“布局后的通用标签布局”：前者可以为了标签调整路径；后者在固定节点和路径上寻找标签位置，无法保证所有冲突都能消除。这正好对应当前 Canvas 的两种工况：

- 自动维护状态：可以移动路由通道，使用集成式求解。
- 用户固定/手绘状态：不擅自改变路径，只做候选位置、避让或降级显示，并报告无法消除的冲突。

对本项目的直接启示：

- 路由障碍不只包括卡片矩形，还要包括组边界、节点标题区、已固定的标签和高优先级边。
- 边标签不应固定在全局 midpoint；应绑定到某一段 route segment，并有多个候选位置和相对边的偏移方向。
- 关系优先级要进入求解器。流程主干、分支条件、回流、参考关系的取舍顺序不同，不能只靠绘制顺序决定谁覆盖谁。
- 不能避让时必须返回可见诊断，而不是静默把标签放回 midpoint。

### 3. React Flow：关系路径与标签/控件分层

[Edge Labels](https://reactflow.dev/learn/customization/edge-labels) 允许把标签渲染为任意 React 组件，并在边上放置删除、编辑等控件；其 `EdgeLabelRenderer` 将这些内容放在 SVG 之外的 portal 中。边本身仍负责路径和命中区域，标签层负责 HTML 的可读性与交互。

对本项目的直接启示：

- SVG 只负责路径、箭头和线跳；标签改为 HTML overlay 或等价的可测量层，才能使用真实宽高、背景、文本截断、按钮和无障碍属性。
- 边的命中区可以保持宽于视觉线，但必须与卡片拖动区分；标签只在点击/选中态接收 pointer events。
- 标签在低缩放下可以降级为编号/小徽标，点击或选中后再显示完整说明，不强行把长文本塞进整图。

## 本地实现审计

以下是对当前实现的静态核对，未改变代码。

### 路由与渲染不一致

- [`relation-geometry.ts:307-318`](../../src/canvas/relation-geometry.ts) 对普通关系使用 `boundaryPoint` + `cubicPath`；只有 relation metadata 中存在 `route` 时才生成折线。
- [`notebook-maintainer.ts:836-859`](../../src/layout/notebook-maintainer.ts) 生成 `start, middle, end`，并在节点矩形与已放置标签之间做局部检查。
- 但 [`NotebookRelations.tsx:67-89`](../../src/ui/NotebookRelations.tsx) 的 `maintainedGeometry()` 读取维护结果后只取 `route.points[0]` 和最后一点，再按首尾方向重新生成 cubic 控制点；中间路由点没有进入 path。维护器给出的绕行通道因此不会真实出现在画布上。

这也是现有计费流程示例中最容易暴露问题的地方：`build-flow-demo.mjs` 为 gate graph 的回流关系提供了上、下、左侧 waypoint（约第 126–128 行），但展示层仍会以首尾点生成曲线，造成回流线挤入主干或穿过卡片。

### 标签碰撞约束不足

- [`notebook-maintainer.ts:338-353`](../../src/layout/notebook-maintainer.ts) 的 `routeLabelPosition()` 只从 midpoint 开始按垂直方向上下搜索，未把边路径本身作为障碍。
- [`notebook-maintainer-adapter.ts:96-99`](../../src/layout/notebook-maintainer-adapter.ts) 用 `label.length * 7 + 16` 估算宽度；这不能正确处理中文字体、混排、换行、缩放和实际 padding。
- [`NotebookRelations.tsx:202-211`](../../src/ui/NotebookRelations.tsx) 将标签作为 SVG `<text>` 直接绘制，没有背景矩形、实际测量、最大宽度、折行或冲突降级机制。
- [`notebook-relations.css`](../../src/ui/notebook-relations.css) 的 `paint-order: stroke fill` 和浅色描边只能改善单条线穿过短文字的观感，不能表达标签与标签之间的占位关系，也不能阻断边路径穿过标签。

当前定向回归测试仍然通过：`relation-geometry.test.ts` 5 个测试、`notebook-relations-render.test.ts` 1 个测试，共 6 个测试通过。测试覆盖了端点解析、显式 route 的静态输出和维护端点渲染，但没有覆盖“路径不得穿过节点”“标签不得与边重叠”“不可避免交叉显示 line jump”等产品验收条件。

## 建议采用的关系展示模型

关系对象应拆成四层，业务关系不再直接决定绘制路径：

```text
SemanticEdge
  from / to / kind / label / priority / visibility
       ↓
RoutePlan
  mode: auto | manual | bundled
  ports / orthogonal segments / waypoints / crossing policy
       ↓
LabelPlan
  segment / offset / measured box / visibility / fallback badge
       ↓
InteractionProjection
  hit path / selection / handles / edit controls / focus state
```

建议的持久化表达（字段名可按现有 contract 调整）：

```json
{
  "presentation": {
    "notation": "flow",
    "routing": "auto",
    "waypoints": [],
    "priority": "main",
    "label": {
      "mode": "inline",
      "segment": 1,
      "side": "right",
      "offset": 12
    },
    "crossing": "jump-if-needed"
  }
}
```

`auto` 路由是临时投影；`manual` waypoint 才写入稳定表示。这样自动维护不会覆盖用户手工整理，用户也能显式恢复自动排版。

### 路由规则

1. **普通流程**：默认正交路线。根据源/目标相对位置选择上下左右 port，给卡片和组边界加 16–24 px clearance，优先少弯、少交叉、短路径。
2. **主干与分支**：先规划主干，再为同一父节点的分支分配平行通道；分支在一个明确的 fork/junction 处展开，避免每条边从卡片边缘各自发散。
3. **回流/反馈**：固定使用外围 lane，优先从图的上侧或下侧绕回入口；反馈线使用虚线和低饱和色，但仍要经过障碍物路由，不允许以“大弧线”穿越主图。
4. **参考关系**：在 overview 隐藏低优先级标签，关系可保留为细虚线；聚焦或选中时显示完整标签和解释。
5. **同一对节点的多条关系**：用平行 offset 或共享总线表达，不让多条线重合成一条不可区分的粗线。
6. **交叉不可避免时**：先改端口和通道；仍有交叉时，仅给低优先级边使用 `arc`/`gap` line jump，并让跳跃方向与箭头方向不冲突。交叉样式是最后的表达手段。
7. **跨分组关系**：折叠状态只连到组边界的 portal/badge；展开后才显示成员边，避免一条关系跨越几十个屏幕单位。

### 标签规则

1. 标签先测量真实 DOM/Canvas 文本宽高，再参与路由或至少参与固定路径上的候选搜索；不用字符数乘常数作为最终尺寸。
2. 标签绑定到具体 route segment，而不是绑定到全局 midpoint。候选位置至少包括该段中心、靠近源/目标的两处，以及路径两侧带 clearance 的位置。
3. 候选必须避开节点、组边界、所有可见边的 stroke corridor、箭头和已放置标签。标签放不下时返回 `hidden`/`badge` 状态和 warning，不回退到必然碰撞的 midpoint。
4. 默认标签保持水平，采用不透明的浅色背景和有限宽度；长标签显示一行截断，选中或聚焦时显示完整说明卡。
5. overview 只显示主干与决策分支标签；缩放低于阈值时用短标签或编号徽标，选中边时再展开完整文字。标签可读性优先于“所有文字永远常驻”。

### 交互规则

- 点击边或标签选中关系；相邻端点和同一关系的解释卡同步高亮。
- hover 只做预览，不激活拖动；拖动边段才进入 waypoint 编辑，卡片拖动不因经过关系线而中断。
- 选中边显示少量 waypoint handles 和“恢复自动整理”；不选中时不显示控制点。
- 标签上的编辑/删除控件只在选中态接收 pointer events，避免标签层阻挡节点操作。
- 提供“整理本组关系”和“显示冲突”两个低频入口：前者生成可撤销 preview，后者标出路径/标签冲突及降级原因。

## 分阶段实施建议

### P0：先修复展示事实

- 让 renderer 真实消费 `route.points`，保留每个折点，至少支持 polyline/orthogonal path。
- 先把 `route.points`、`label`、`geometry.path` 的坐标系契约固定下来，补一条回归：中间 waypoint 必须出现在最终 SVG path 中。
- 为标签增加背景 box 和基础的 `hidden/badge` 状态；先分离 SVG path 层与 HTML/SVG label 层。

### P1：自动流程路由

- 加入带 clearance 的矩形障碍路由，优先正交、少弯、少交叉。
- 对同源分支分配平行 lane，对反馈关系使用外围 lane。
- 将边路径 corridor、组边界和已固定标签纳入障碍物集合。

### P2：标签求解和交叉表达

- 真实测量标签，按 segment 生成候选位置并做全局/局部冲突求解。
- 为不可避免的交叉增加 line jump；对主干、分支、反馈、参考关系设置明确优先级。
- 对密集图支持总线/汇合点、低缩放标签降级与聚焦展开。

### P3：手工修正和持久化

- 拖动边段创建手工 waypoint；自动/手工模式可切换。
- 路径变更局部化，移动一个节点只重算相邻关系；保留撤销和 preview/cancel。
- 保存手工 route 和标签偏移，自动 route 保持可重算的临时投影。

## 可验收标准

建议用现有 `timem-cloud-billing` 六图作为回归样本，重点检查 `timem-cloud-billing-flow` 和回流较多的 `timem-cloud-billing-gates`。

| 类别 | 验收条件 |
| --- | --- |
| 线-块关系 | 除了端点连接区域，任一可见边 path 的 stroke corridor 不与卡片/组边界相交；若无法满足，画面显示冲突状态，不静默穿块。 |
| 边标签 | 标签真实矩形不与卡片、组边界、边路径、箭头或其他标签相交；无可用位置时降级为短徽标/选中展开，并产生可读 warning。 |
| 路由兑现 | maintainer 返回的每一个 waypoint 都出现在最终 path；移动/缩放节点后，auto 边实时重算，manual 边保留用户路径。 |
| 多边关系 | 同源分支有可识别的 fork/平行通道；同一对节点多关系不重合成一条线。 |
| 反馈关系 | 反馈边走外围 lane；主干和反馈不会在卡片内部或标签下方穿行。 |
| 交叉表达 | 自动调整端口和通道后仍无法消除的交叉，使用明确的 arc/gap line jump；交叉边的优先级可从视觉上判断。 |
| 缩放阅读 | overview 隐藏低优先级长标签；聚焦/选中可恢复完整标签，且不会遮挡节点拖动。 |
| 交互 | 点击边选中关系；拖动边段才创建 waypoint；标签控件不抢占未选中节点的拖动和框选。 |
| 稳定性 | 无关节点移动不导致全图跳变；同一输入重复计算的 route/label 结果稳定。 |
| 性能 | 以几十个节点、约 60 条关系的图为验收规模，局部移动只重算邻接关系；开发机上局部重算 p95 目标不超过 100 ms。 |

验收证据应至少包含：最终 SVG/HTML 的 path 与 label 快照、节点/标签/路径相交检测结果、gate graph 的回流截图、自动/手工 route 切换录像或事件日志，以及 P0–P3 对应的回归测试结果。

## 边界与取舍

- draw.io 和 yFiles 的能力是成熟产品的参考，不等于本地轻量插件可以无成本复刻全部算法；P0 先兑现已有 route，再逐步增加正交绕障和标签求解。
- “完全没有交叉”并不总是可读性最优。对语义明确、低优先级的关系，短线跳或折叠为 portal 比把画布拉得极宽更易读。
- 标签永远完整显示会破坏大图的层级阅读；应保留完整内容在选中/聚焦层，overview 只保留能维持结构识别的短标签。
- 本次报告没有改动正式画布或服务；当前定向关系测试通过不代表上述产品验收已经满足，尤其不代表现有维护路由已经真实渲染。
