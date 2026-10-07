# ForecastCompass 知识概念图读者审计（2026-10-03）

## 审计范围与事实边界

本审计直接读取：

- `plugins/agent-visual-canvas/docs/examples/forecastcompass/knowledge-structure-pilot-data.mjs`
- `plugins/agent-visual-canvas/docs/evidence/knowledge-structure-source-audit-20261003.md`
- `plugins/agent-visual-canvas/docs/evidence/reading-flow-source-review-20261003.md`

当前数据包含 29 个 atoms、55 条 edges、8 个 localMaps 和 1 个 overview，共 9 张图。下面的“中心、分支、交叉边、时间边界”是可视化建议，不是已完成的 UI 行为；没有做浏览器验收、真人阅读或论文实验。

论文事实沿用来源审计的边界：FoCo 按层级分类把问题路由到子类别，子类别状态包含 F/R；预测轨迹来自结果揭晓前，复盘轨迹使用结果后的信息且不可直接部署；差异经诊断、聚合和修订后服务未来问题；Brier/ECE、Table 1、Table 3、BASE、Static 和 F/R 消融的口径来自指定 PDF。选举、70%/30% 和 `.18` 仍只是讲解例，不能画成实验结果。

## 所有图都需要的视觉契约

1. **图例必须把关系分层。** `semanticType: input` 用约束/输入样式，`output` 用产物箭头，`evidence` 用证据支撑线，`index` 用检索键或定位标记，`contains` 用容器/成员关系，`trigger` 用事件触发样式，`compare` 用对照括号或双端标记，`update` 用回写箭头，`evaluate` 用评价镜头或指标标记。不能让这些关系全部变成同一种普通父子箭头。
2. **讲解顺序单独画。** `teachingLinks` 是步骤之间的 `teaching_order`，应使用页面顶部的阅读路线或细线；不要把它混进算法主图，否则读者会把“下一步讲解”误读成“运行时下一步”。
3. **时间边界应成为背景带。** 至少划出 `预测时点（结果揭晓前）`、`结果揭晓`、`结果后复盘/学习`、`未来问题使用修订记忆` 四个区域。预测轨迹 `z` 只能在第一带生成；复盘轨迹 `z_retro` 只能在第三带生成；修订后的 memory 只能回到未来问题，不能回箭头改写当前预测。
4. **对照不是流程。** `retrospective → trajectory` 的方向表示复盘拿结果后信息对照原预测，不能渲染成“复盘产生预测轨迹”；`static → base` 以及 Table 1/Table 3 对 comparison 的关系也应显示为并列比较，而不是父子流水线。
5. **证据图要标范围。** Table 1 是跨评估周、四种模型—数据集设置的平均主结果；Table 3 固定 FutureX/GPT-5-mini，给出 BASE、去 F、去 R 和完整 FoCo 的逐周及平均对照。图中应在证据节点上写范围标签，不能用一条“实验结果”边合并两张表。

## 九张图的具体建议

### 1. `overview`：ForecastCompass 预测—记忆闭环

- **中心概念与布局：** 以 `memory` 作为状态中心，`foco` 作为外层方法边界；主环按 `memory → agent → trajectory → retrospective → revision → memory` 排成环，`comparison` 放在 `trajectory` 旁作为评价侧枝。`foco → memory` 应画成“方法管理状态”的容器/管理边，而不是普通时间箭头。
- **必须保留的交叉边：** `retrospective → trajectory` 必须是带“对照原预测”标签的 compare 桥；`revision → memory` 必须是回写箭头；`trajectory → comparison` 必须是评价分叉。全局还有 `comparison → foco` 的评价关系，当前 overview 未列出；若不显示该边，comparison 应明确标为闭环的结果读出，而不能暗示它已经回馈方法。
- **时间边界：** 环左半或上半标为结果前预测，`retrospective` 置于结果揭晓之后，`revision` 跨过未来边界回到下一轮 memory；comparison 置于评估带，不能与复盘混成同一阶段。
- **树状误读：** 单根树会把 revision 当作终点，把 memory 当作只读父节点；也会把 compare 线误读为 trajectory 的下游处理。这里必须使用环、回写箭头和侧向评价支路。

### 2. `map-probability`：从问题到概率答案

- **中心概念与布局：** `agent` 是执行中心；`forecast-question` 是目标输入，`protocol` 是覆盖输入和时间约束，`probability` 是结果输出。建议用左右输入汇入 Agent、再向右输出的三段布局。
- **必须保留的交叉边：** `protocol → forecast-question` 表示限定问题的可用信息时点，`forecast-question → agent` 表示任务输入，`agent → probability` 表示产生概率。协议不要只作为 question 的父卡；应以横跨输入区的约束带显示。
- **时间边界：** 整张图位于结果揭晓前；概率是可部署的当前答案。结果后材料不应在图中出现，也不能从 probability 反向连回 protocol。
- **树状误读：** 普通树会把 protocol→question 看成“协议生成问题”，把 probability 看成 Agent 的静态子节点。输入、约束、输出三种线型必须不同。

### 3. `map-signal-confidence`：信号、信心与校准

- **中心概念与布局：** 用两条并行分支汇入 `calibration`：`probability → confidence` 是概率摘要分支，`protocol → signal` 是受时间约束的证据分支；`calibration` 是集合级评价汇合点，不是一次预测的下一步动作。
- **必须保留的交叉边：** `confidence → calibration` 不能省略，否则 ECE 的输入来源消失；`protocol → signal` 不能画成普通数据父子边，而要标“只允许结果前信号”。`signal → calibration` 的标签应说明信号影响校准判断的依据，不应写成信号直接产出正确率。
- **时间边界：** probability/confidence/signal 属于预测阶段；calibration 针对一组预测，可在结果已知后统计，但其定义不能被画成结果后复盘。
- **树状误读：** 若画成 `probability → confidence → calibration` 单链，读者会漏掉 signal；若画成 `signal → calibration` 单链，读者会把 calibration 当作单次信号结论。两条入边及“集合级”图例必须可见。

### 4. `map-memory-problem`：从一次记录到可复用原则

- **中心概念与布局：** `lesson` 是中心汇合卡；`signal` 与 `calibration` 是两类经验来源，`protocol` 是横跨两者的时间过滤带，`foco` 是把 lesson 组织成预测方法的出口。建议使用“两个来源分支 + 一条边界带 → lesson → FoCo”。
- **必须保留的交叉边：** 当前局部图没有列出但在全局边中存在的 `protocol → signal` 与 `signal → calibration`，若图要解释“为什么这些经验可复用”，应以细约束线补回或在 protocol/lesson 之间放明确注释。`signal → lesson` 和 `calibration → lesson` 是两条不同证据来源，不能合并为一条“经验输入”。
- **时间边界：** lesson 从已揭晓记录中抽象，但用途是未来问题；protocol 同时约束提炼时不能回填原预测、使用时只能服务未来。FoCo 的方法卡应放在“未来使用”一侧，不放在结果事件之前的流水线里。
- **树状误读：** 如果 protocol 作为 lesson 的普通父节点，读者会以为协议生成经验；如果 signal 和 calibration 只画成 lesson 的同色子节点，会丢失“看什么/信多少”的双来源差异。

### 5. `map-two-memories`：分类索引下的双记忆

- **中心概念与布局：** 使用 `memory` 作为分叉中心：上游为 `foco → taxonomy → subcategory`，下游为并列的 `factor F` 与 `reasoning R`。F/R 必须是左右对称的兄弟分支，不能上下排列成先 F 后 R 的顺序。
- **必须保留的交叉边：** `subcategory → memory` 必须标为 `index`（检索定位），`memory → factor/reasoning` 才是 `contains`（组成状态）。全局的 `foco → memory` 与 `taxonomy → memory` 关系当前未列入局部图；若只展示主链，至少要用容器边界或旁注表达 FoCo 管理状态、taxonomy 通过子类别定位状态。不能把 `taxonomy → subcategory` 的层级关系和 `subcategory → memory` 的检索关系画成同一种树边。
- **时间边界：** 这是结构图，不是事件时间线；它描述预测前如何取回状态，并预留结果后局部更新的出口。F/R 是语言化指导，不是固定数值权重，也不是两个可相加的模型模块。
- **树状误读：** 纯树会把 taxonomy 当作 memory 的唯一父对象，掩盖 FoCo 的方法管理作用；会把 F/R 当成连续步骤或把二者误画成互相依赖。应在 memory 卡上画“同一子类别状态”容器，并给 F/R 使用相同的成员样式。

### 6. `map-inference`：记忆如何进入一次新预测

- **中心概念与布局：** 视觉执行中心应是“Agent 使用 memory 的一次预测”；当前 `nodeIds` 没有 `agent`，因此可以把 Agent 作为带角色图标的中心锚点/跨图引用，或把 `memory + F/R` 画成 Agent 周围的输入簇。左侧是 question/protocol，中央是 memory→F/R guidance，右侧是 trajectory→probability。
- **必须保留的交叉边：** 当前局部已有 `memory → factor/reasoning`、`factor → trajectory`、`reasoning → probability`、`trajectory → probability`，但缺少全局 `memory → agent` 和 Agent 节点；若不提供中心 Agent，读者会误以为 memory 直接生成 trajectory/probability。`protocol → question` 也被当前局部省略，应以时间约束带连接 question 与 trajectory。F→trajectory 和 R→probability 是指导输入，不应画成两个独立输出。
- **时间边界：** question、protocol、memory、F/R、trajectory、probability 全属于结果揭晓前；trajectory 一旦生成就作为冻结的原预测记录，不能接受 retrospective 或 outcome 的回流。
- **树状误读：** 单链会把 F 误认为只影响轨迹、R 误认为直接生成概率，或者把 probability 当成 trajectory 的后处理。建议使用 Agent 中心、两条 guidance 虚线和一条 trajectory→probability 实线。

### 7. `map-update`：结果后的诊断—聚合—修订

- **中心概念与布局：** 以 `diagnosis → aggregation → revision` 为结果后处理主链；`outcome` 作为时间闸门，`trajectory`（结果前）与 `retrospective`（结果后）并列进入 diagnosis。`memory` 放在未来状态一侧，接收 revision 回写。
- **必须保留的交叉边：** `retrospective → trajectory` 是 compare 桥，必须让读者看到两条轨迹的对照；`trajectory → diagnosis` 与 `retrospective → diagnosis` 是两个不同信息条件的输入，不能合并。当前 `retrospective → revision` 的全局 trigger 边未列入局部图；不建议画成普通直达箭头，以免跳过诊断/聚合，但可画成“经中间阶段驱动修订”的虚线括号。revision→memory 必须是未来写回而非当前预测回写。
- **时间边界：** 在 outcome 处画粗竖线；左侧 trajectory/z 只含揭晓前信息，右侧 retrospective/z_retro 可用结果后信息；diagnosis/aggregation/revision 位于右侧，修订记忆跨到未来问题区域。复盘不可部署。
- **树状误读：** 树会把 retrospective 误画成 trajectory 的子节点或新预测，或者让两个输入被迫排成先后顺序；这里必须使用并列双输入、compare 横线和明确的 outcome 闸门。

### 8. `map-evidence`：指标、主结果与消融证据

- **中心概念与布局：** 不要画成 Brier→ECE→comparison 的流水树。建议用二维矩阵：纵轴是评价维度（Brier→概率距离、ECE→信心/校准），横轴是证据范围（Table 1 总体均值、Table 3 固定 FutureX/GPT-5-mini 的 F/R 消融）；`comparison` 是矩阵外框或中心索引，两个表是证据列。
- **必须保留的交叉边：** `brier → probability` 与 `ece → confidence` 是“指标评价对象”关系，不是数据生产顺序；`brier/ece → comparison` 是统一口径；`table1-result/table3-ablation → comparison` 是证据支撑。当前局部省略了 `probability → confidence`，但若 confidence 节点可见，建议以派生标记补回“confidence = max probability”，否则 ECE 分支显得无来源。
- **时间边界：** 指标需要一组预测及已实现结果，位于评估阶段；Table 1 的跨周平均与 Table 3 的逐周/平均范围必须分别标注。指标评价不等于结果后复盘，也不自动触发 memory revision。
- **树状误读：** 树会把 ECE 看成 Brier 的后续步骤，把 Table 3 看成 Table 1 的子结果，或把“去 F/R 的性能差异”画成独立因果收益。矩阵轴、范围徽章和 compare/evidence 图例是必要的。

### 9. `map-reproduction`：配置约束下的复现入口

- **中心概念与布局：** `config` 是包住 `protocol` 与 `comparison` 的约束框，`comparison` 是中心参照，`base`、`static`、`ablation` 是并列版本卡。完整 FoCo 当前不在 `nodeIds` 中，建议在 comparison 卡内固定显示“完整 FoCo 参照”或从 overview 以稳定引用接入，避免只看见三个对照版本。
- **必须保留的交叉边：** `config → protocol` 是共同时间/配置边，`config → comparison` 是比较范围边；`comparison → base/static/ablation` 是版本归属而不是因果生成；`static → base` 必须画成横向 compare，不要画成 Static 包含 BASE。协议与配置应是背景约束，不能成为某个 baseline 的父节点。
- **时间边界：** 配置卡应画出 Week 0 development/Week 1 held-out 的选参角色与后续评估窗口，并注明 FoCo revision epochs 只适用于动态记忆修订；BASE 无外部记忆、Static 保留初始 F/R 但不周更、F/R 消融在固定 FutureX/GPT-5-mini 条件下比较。原文未核实项应显示待核实标记。
- **树状误读：** 普通树会让读者以为 BASE→Static→ablation 是升级链，或把 comparison 误看成产生这些方法；应使用同一 comparison 框内的 sibling cards、协议边界和横向 compare 标记。

## 最低可视化验收条件

1. 九张图都有可见图例，至少能区分输入、产物、证据、索引/包含、触发、比较、更新和评价；教学顺序单独显示。
2. `map-two-memories` 明确画出 subcategory 的检索作用和 memory 下 F/R 的对称双分枝；不得用单一树边替代两种关系。
3. `map-inference` 显示 Agent 作为执行者，即便使用稳定跨图引用或角色锚点，也不能让 memory 看起来直接生成预测。
4. `map-update` 显示 outcome 闸门、两条信息条件不同的轨迹、compare 桥、diagnosis→aggregation→revision 链和未来 memory 回写。
5. `map-evidence` 使用“指标维度 × 证据表/比较范围”二维表达，Table 1 与 Table 3 不能合并成一条证据链。
6. 所有图都保留结果前/结果后边界；任何树状布局若会把复盘写回当前预测、把比较画成因果或把教学顺序画成算法步骤，都应判为结构误导。

## 待审阅模块

`plugins/agent-visual-canvas/scripts/knowledge-concept-figures.mjs` 在本次写入时尚未提供，因此尚未对 `knowledge_atoms_content` 的事实、符号、部件语义做检查。模块出现后将在本报告追加独立小节，只核对其与上述 atoms/edges/source audit 及指定论文的对应关系，不把假想图例、视觉建议或本地实现行为写成论文结果。

## `knowledge-concept-figures.mjs` 模块复核（2026-10-03）

模块现已提供。本次直接读取并导入 `plugins/agent-visual-canvas/scripts/knowledge-concept-figures.mjs`，再与 `knowledge-structure-pilot-data.mjs`、来源审计和指定 PDF 的已核验口径对照；没有打开浏览器，也没有做真人测试。

### 直接检查通过的部分

- 模块为 8 个教学步骤各导出 1 张 figure，`figureByStepId` 覆盖 8/8 个 step；当前没有 overview figure，因而 overview 仍由前一节的 topology/关系建议覆盖。
- 8 张图共 53 个 figure parts。所有 `part.atomId` 和 `part.edgeIds` 都能解析到 canonical atoms/edges，part 的 `source` 与 `sourceKind` 与对应 atom 一致。
- `renderFigure(stepId)` 对 8 个步骤均能生成 SVG/figure 字符串；这只证明源模块可以生成字符串，不代表浏览器布局、交互或可读性已经验收。
- F/R 的含义保持一致：F 是“看什么/查哪些信号”，R 是“信多少/证据强弱如何改变信心”；两处 annotation 都明确说这不是可独立相加的因果模块。文件夹只是 `two-memories` 的讲解类比，并明确写成“不是论文 UI”。
- `figure-probability` 明确标出 70%/30% 是讲解例；`figure-update` 明确画出结果揭晓边界、复盘不可部署、诊断→聚合→修订→未来 memory 的方向，未把结果后信息写回当前预测。
- 证据数字的源数组没有被重写。静态读取得到 Table 1 选取的 `gpt-futurex` 三行：BASE `(0.241, 0.263)`、FoCo (Static) `(0.203, 0.219)`、FoCo `(0.187, 0.195)`；Table 3 均值为 BASE `(0.241, 0.263)`、去 F `(0.207, 0.209)`、去 R `(0.205, 0.220)`、FoCo `(0.187, 0.195)`，与来源审计一致。

### 事实、符号和部件语义风险

1. **SVG connector 没有绑定 canonical edge，可能把教学排布读成新事实。** `renderSignalConfidence` 在 `knowledge-concept-figures.mjs:600-603` 直接画出 `signal → confidence` 的“进入判断”箭头，但 canonical 数据没有这条边；该图应显示 `probability → confidence` 的派生关系和 `signal → calibration` 的支撑关系，或把这条线标成明确的 `illustrates` 教学组合。`renderMemoryProblem:620-621` 把 `retrospective` 直接连到 signal/calibration，`renderInference:672-674` 把 signal/reasoning 直接连到 Agent；这些是可解释的教学编排，却不是当前 canonical edges。若下游只依据箭头方向或 part 的 `edgeIds`，会误以为它们是论文算法关系。
2. **证据图有多处方向与 canonical 关系相反。** `renderEvidence:772-777` 画的是 `probability → brier`、`confidence → ece`、`comparison → table1/table3`，而 canonical edge 分别是指标评价对象 `brier → probability`、`ece → confidence`，以及证据支撑 `table1-result/table3-ablation → comparison`。若要保留阅读上的“数据流”方向，应使用无方向的 measurement/support 连接或增加明确的 visualRole；不能让箭头同时承担 canonical 关系方向。
3. **part 的 edgeIds 含有图外关系，语义上应标 cross-figure。** 目前发现：probability 图的 protocol 引用 `e-protocol-trajectory` 但没有 trajectory part；signal-confidence 图的 confidence 引用 `e-probability-confidence` 但没有 probability part；memory-problem 图的 record 引用 outcome/diagnosis、FoCo 引用 taxonomy；inference 图的 signal 引用 calibration；evidence 图的 ablation 引用 factor/reasoning。它们可以作为邻域导航，但不应在当前图例中看成当前局部的可见边。
4. **信号/信心图的 70% 缺少“讲解例”标记。** `renderSignalConfidence:592-596` 用 70% 画 gauge，而该 figure 的 caption 没有像 probability figure 那样声明这不是论文实验值。读者可能把它看成观测结果；应在图内加“示意”或在 caption 中重复例子边界。
5. **Table 1 的范围标签不完整。** `table1FutureX` 在 `:721-725` 只读取 `configId: "gpt-futurex"` 的 BASE、Static、FoCo 三行；这三个数值本身正确，但渲染时只写“FutureX”（`:787`），没有写 `GPT-5-mini / FutureX`，也没有说明省略了 `BASE (Retro)` 和其它 Table 1 方法。应把它标成“Table 1 选取：GPT-5-mini / FutureX”并说明 BASE (Retro) 为不可部署诊断参考，避免被读成完整 Table 1。
6. **证据表的 `B`/`E` 缩写没有图内图例。** `renderEvidence:765-767` 输出 `B 0.xxx`、`E 0.xxx`，虽然上游卡片写了 Brier/ECE，单独激活图形部件时仍可能把 `E` 读成实验臂或其它字段。表头应直接写 `Brier`、`ECE`，或提供可访问的图例。
7. **完整 FoCo 在复现图中只有文字语义，没有独立部件。** `figure-reproduction` 展示 BASE、Static、F/R 消融三个独立比较臂，comparison 的 meaning 提到完整 FoCo，但图上没有完整 FoCo part；若要读懂“与完整方法比较”，应加稳定引用/参考标记，或在 comparison 卡内明确标出完整 FoCo 是参照版本。`static → base` 的 compare 关系也没有在该图显式绘出，不能让三条臂看起来是升级顺序。
8. **模块只提供 8 张 step figure。** 数据层有 9 张图（含 overview），模块没有 overview figure；这不是论文事实错误，但若产品目标是“9 图都有图解”，需要明确 overview 仍由结构图渲染，避免把 8/8 step 覆盖误报为 9/9 图覆盖。

### 模块复核结论

模块的 atom 身份、来源继承、F/R 术语、时间边界、更新链和证据数字均有可靠来源或明确讲解边界；没有发现把 70%/30% 讲解例直接标成论文实验值、把 F/R 写成独立因果收益或把复盘写成可部署预测的事实性错误。当前主要风险在可视化语义层：部分 connector 是未登记的教学组合，证据图的箭头方向与 canonical edge 方向相反，若没有 `illustrates`/`measurement`/`support` 等 visualRole 图例，读者会把排布方向误读为算法或证据方向。Table 1 子集标签、信心 70% 示意标记、B/E 图例和 overview 覆盖范围也应在接入时保留。

## 定稿模块复核（2026-10-03，第二次）

本次复核直接读取当前 `knowledge-concept-figures.mjs`，并运行只读 Node 导入与字符串渲染检查；没有打开浏览器，没有调用 MCP，没有做真人阅读或 UI 验收，也没有修改模块、数据或其他 worker 文件。

### 已关闭的实现问题

- **部件内部图形已补齐。** `memory-problem` 的记录卡现在显示“看到的信号 / 实际结果”，信号卡显示“覆盖与时间 / 定义与适用”，校准卡显示“弱证据 / 冲突 / 缺失”，原则卡显示“检查什么 / 控制信心”；`two-memories` 以文件夹和目录树解释 taxonomy/subcategory，并在 memory 内部并列显示 F/R；F 卡显示信号、证据、误用检查清单，R 卡显示证据强弱、冲突/缺失和信心区间。它们都是图内讲解，不被当作论文新增实体。
- **`memory-problem` 的记录卡已降为支撑例。** 当前 `record` 使用 `atomId: "lesson"`、`visualRole: "supporting_example"`、`sourceKind: "example"`，`edgeIds` 为空；它只用已揭晓个例帮助解释原则抽象，不把 `retrospective` 误画成当前概念，也没有提前引入完整复盘轨迹。
- **SVG 可识别性与命名空间已关闭。** 每张图的根 SVG 使用 `role="group"` 和标题/描述关联；8 个 figure 的 marker id 均按 figure id 命名且互不重复，渲染后不残留 `url(#figure-arrow)`。
- **连接线的事实边界已关闭。** `arrow`、`connector` 和 `relationLine` 生成的关系元素都带 `data-figure-relation="illustrative"`。证据图使用无箭头的 `relationLine`，因此不再把评价对象、指标、比较和表格的排布方向伪装成 canonical edge 方向。
- **证据图的范围和指标表头已关闭。** Table 1 面板明确写出 `GPT-5-mini`、`FutureX`，并展示所选的 BASE、Static、FoCo 三行；Table 3 面板明确写出同一模型/数据集范围并展示 BASE、去 F、去 R、FoCo 四行。两张表均直接写 `Brier`、`ECE`，不再依赖 `B`/`E` 缩写。数字仍从既有 `results`/`ablation` 数组取值，没有在图形模块中重写。
- **教学数字的标记已关闭。** probability 图把 `70% / 30%` 明确写成“讲解例，非论文值”；signal-confidence 图把 `7/10 命中 ≈ 70%` 明确写成“讲解示意”。这两个数字不再具有论文实验结果的视觉外观。

### 复现实验臂的来源边界

复现图当前把三个 sibling arm 画成：BASE 为 `F/R 关`、`更新 关`；FoCo (Static) 为 `F/R 初始`、`更新 关`；F/R 消融为 `F 或 R 去掉`、`更新 开`。前两组与来源审计中“无外部记忆”和“保留初始化记忆但不周更”的定义直接一致；第三组与 Table 3 的动态 FoCo 去 F/去 R 对照相容。`更新 开` 是把“保留 FoCo 更新流程、只移除对应 F 或 R”压缩成视觉开关的教学编码，不是论文单独报告的字段。图的 caption 和 annotation 已把这些 arm 标为比较设计/讲解示意，不能据此声称已经执行复现或把开关文字当作额外实验事实。

### 只读结构与渲染证据

当前模块导出 8 张 step figure，覆盖 canonical steps 的 8/8；overview 仍由数据层的总体中心/分支结构承载，产品采用“8 张 step 图 + overview 总体结构”，因此没有把 overview SVG 缺失判为实现缺陷。8 张图共 53 个 parts；所有 `atomId`、`edgeIds`、`source` 和 `sourceKind` 均可解析。`renderFigure()` 对 8 个 step 均成功生成字符串；每张图都有根 `role="group"`、唯一 figure marker 和 illustrative relation。证据字符串包含 `GPT-5-mini`、`FutureX`、`Brier`、`ECE`，且没有带箭头的证据 relation；概率/信心示意、复现 pills 和 `memory-problem` supporting example 检查均通过。

### 仍需保留的阅读边界

- 这些 SVG connector 是布局和讲解关系，即使它们旁边显示了 canonical part 的 `edgeIds`，也不能把每一条视觉线理解为论文新增算法边；当前通过 `data-figure-relation="illustrative"` 和图注保留该边界。
- 证据图展示的是 Table 1 的 GPT-5-mini/FutureX 选取子集与 Table 3 的固定条件消融，不冒充完整 Table 1 全部方法和四种设置；完整数字 provenance 仍由来源数据和来源审计负责。
- 本次检查证明源模块的结构、字符串生成和标记边界；浏览器布局、键盘交互、屏幕阅读器体验、真人理解和真实复现实验仍需由根代理分别验收，不能从本报告的静态通过项推出。
